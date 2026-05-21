import * as net from "node:net";
import * as dnsP from "node:dns/promises";
import { logger } from "../lib/logger";
import { logEvent } from "../monitoring/logger";
import { broadcastSse } from "./sse-broadcast";
import { emitConsoleEvent } from "../monitoring/console-events";

export type ConnStatus = "online" | "offline" | "checking" | "unknown";

export interface TargetResult {
  id: number;
  name: string;
  host: string;
  lastStatus: "online" | "offline" | null;
  lastResponseTimeMs: number | null;
  lastError: string | null;
  lastCheckedAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailedAt: Date | null;
}

export interface ConnectivityState {
  status: ConnStatus;
  isChecking: boolean;
  currentlyCheckingTarget: string | null;
  results: TargetResult[];
  lastOnlineAt: Date | null;
  lastOfflineAt: Date | null;
  lastCheckedAt: Date | null;
  nextRetryAt: Date | null;
}

// ── Target config ─────────────────────────────────────────────────────────────
const DEFAULT_TARGETS = [
  { name: "Google",   host: "google.com"       },
  { name: "Soft98",   host: "soft98.ir"        },
  { name: "Varzesh3", host: "www.varzesh3.com" },
];

function normalizeHost(raw: string): string {
  const trimmed = raw.trim();
  try {
    const u = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    return u.hostname;
  } catch {
    return trimmed;
  }
}

function loadConnectivityTargets(): { id: number; name: string; host: string }[] {
  const raw = (process.env["CONNECTIVITY_TARGETS"] ?? "").trim();
  if (!raw) return DEFAULT_TARGETS.map((t, i) => ({ ...t, id: i + 1 }));

  const parsed = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const colonIdx = entry.indexOf(":");
      if (colonIdx < 0) return null;
      const name = entry.slice(0, colonIdx).trim();
      const host = normalizeHost(entry.slice(colonIdx + 1));
      if (!name || !host) return null;
      return { name, host };
    })
    .filter((t): t is { name: string; host: string } => t !== null);

  if (parsed.length === 0) return DEFAULT_TARGETS.map((t, i) => ({ ...t, id: i + 1 }));
  return parsed.map((t, i) => ({ ...t, id: i + 1 }));
}

const ACTIVE_TARGETS = loadConnectivityTargets();

// ── In-memory state ───────────────────────────────────────────────────────────
const resultsMap = new Map<number, TargetResult>(
  ACTIVE_TARGETS.map((t) => [
    t.id,
    {
      id: t.id,
      name: t.name,
      host: t.host,
      lastStatus: null,
      lastResponseTimeMs: null,
      lastError: null,
      lastCheckedAt: null,
      lastSuccessAt: null,
      lastFailedAt: null,
    },
  ]),
);

let globalStatus: ConnStatus = "unknown";
let _isChecking = false;
let _currentlyCheckingTarget: string | null = null;
let lastOnlineAt: Date | null = null;
let lastOfflineAt: Date | null = null;
let lastCheckedAt: Date | null = null;
let nextRetryAt: Date | null = null;
let offlineRetryHandle: ReturnType<typeof setTimeout> | null = null;
let offlineNotificationSent = false;

interface ConnRuntimeConfig {
  autoChecksEnabled: boolean;
  offlineRetryMs: number;
  pingTimeoutMs: number;
  pingAttempts: number;
  pauseWhileOffline: boolean;
  notificationsEnabled: boolean;
}

let runtimeConfig: ConnRuntimeConfig = {
  autoChecksEnabled: true,
  offlineRetryMs: 5_000,
  pingTimeoutMs: 3_000,
  pingAttempts: 4,
  pauseWhileOffline: true,
  notificationsEnabled: false,
};

// ── Public state accessor ─────────────────────────────────────────────────────
export function getConnectivityState(): ConnectivityState {
  return {
    status: globalStatus,
    isChecking: _isChecking,
    currentlyCheckingTarget: _currentlyCheckingTarget,
    results: Array.from(resultsMap.values()),
    lastOnlineAt,
    lastOfflineAt,
    lastCheckedAt,
    nextRetryAt,
  };
}

export function getHardcodedTargets() {
  return ACTIVE_TARGETS;
}

export function isInternetOffline(): boolean {
  return globalStatus === "offline";
}

export function isInternetOfflinePaused(): boolean {
  return runtimeConfig.pauseWhileOffline && globalStatus === "offline";
}

// ── Apply settings ────────────────────────────────────────────────────────────
export function applyConnectivitySettings(settings: {
  connectivityAutoChecksEnabled: boolean;
  connectivityOfflineRetryMs: number;
  connectivityPingTimeoutMs: number;
  connectivityPingAttempts: number;
  connectivityPauseWhileOffline: boolean;
  connectivityNotificationsEnabled: boolean;
}): void {
  runtimeConfig = {
    autoChecksEnabled: settings.connectivityAutoChecksEnabled,
    offlineRetryMs: settings.connectivityOfflineRetryMs,
    pingTimeoutMs: settings.connectivityPingTimeoutMs,
    pingAttempts: settings.connectivityPingAttempts,
    pauseWhileOffline: settings.connectivityPauseWhileOffline,
    notificationsEnabled: settings.connectivityNotificationsEnabled,
  };
  if (!runtimeConfig.autoChecksEnabled) {
    clearOfflineRetry();
  } else if (globalStatus === "offline") {
    scheduleOfflineRetry();
  }
}

// ── Connectivity terminal event emitter ───────────────────────────────────────
function emitConn(
  level: "info" | "warn" | "error",
  message: string,
  details?: Record<string, unknown>,
) {
  emitConsoleEvent({ type: "connectivity", level, message, details });
}

// ── Single TCP probe (returns RTT in ms or null on timeout/error) ─────────────
function tcpProbe(host: string, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    let settled = false;
    const done = (ms: number | null) => {
      if (!settled) { settled = true; socket.destroy(); resolve(ms); }
    };
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.connect(80, host, () => done(Date.now() - start));
    socket.on("error", () => {
      // port 80 refused — try 443
      const s2 = new net.Socket();
      s2.setTimeout(timeoutMs);
      s2.connect(443, host, () => { s2.destroy(); done(Date.now() - start); });
      s2.on("timeout", () => { s2.destroy(); done(null); });
      s2.on("error", () => { s2.destroy(); done(null); });
    });
    socket.on("timeout", () => done(null));
  });
}

// ── Ping a host: DNS resolve → N sequential probes → CMD-style terminal output ─
async function pingHost(
  host: string,
  timeoutMs: number,
  attempts: number,
): Promise<{ ok: boolean; avgMs: number | null }> {
  // 1. DNS resolve (like real ping does)
  let ip: string | null = null;
  try {
    const r = await dnsP.lookup(host);
    ip = r.address;
    emitConn("info", `Pinging ${host} [${ip}] with 32 bytes of data:`);
  } catch {
    emitConn("error", `Ping request could not find host ${host}. Please check the name and try again.`);
    return { ok: false, avgMs: null };
  }

  // 2. Sequential probes
  const times: number[] = [];
  for (let i = 0; i < attempts; i++) {
    const ms = await tcpProbe(host, timeoutMs);
    if (ms !== null) {
      times.push(ms);
      emitConn("info", `Reply from ${ip}: bytes=32 time=${ms}ms`);
    } else {
      emitConn("warn", `Request timed out.`);
    }
  }

  // 3. Summary
  const sent = attempts;
  const received = times.length;
  const lost = sent - received;
  const lostPct = Math.round((lost / sent) * 100);
  emitConn("info", ``);
  emitConn("info", `Ping statistics for ${host}:`);
  emitConn("info", `\tPackets: Sent = ${sent}, Received = ${received}, Lost = ${lost} (${lostPct}% loss),`);
  if (times.length > 0) {
    const min = Math.min(...times);
    const max = Math.max(...times);
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    emitConn("info", `Approximate round trip times in milli-seconds:`);
    emitConn("info", `\tMinimum = ${min}ms, Maximum = ${max}ms, Average = ${avg}ms`);
  }
  emitConn("info", ``);

  const avgMs = times.length > 0
    ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
    : null;

  return { ok: received > 0, avgMs };
}

// ── Full connectivity check ────────────────────────────────────────────────────
export async function runConnectivityCheck(singleTargetId?: number): Promise<ConnStatus> {
  if (_isChecking && singleTargetId === undefined) return globalStatus;
  _isChecking = true;
  lastCheckedAt = new Date();

  try {
    const attempts = Math.max(1, Math.min(10, runtimeConfig.pingAttempts));
    const timeoutMs = runtimeConfig.pingTimeoutMs;

    // Single-target manual ping
    if (singleTargetId !== undefined) {
      const target = ACTIVE_TARGETS.find((t) => t.id === singleTargetId);
      if (target) {
        const { ok, avgMs } = await pingHost(target.host, timeoutMs, attempts);
        const now = new Date();
        const existing = resultsMap.get(target.id);
        resultsMap.set(target.id, {
          id: target.id,
          name: target.name,
          host: target.host,
          lastStatus: ok ? "online" : "offline",
          lastResponseTimeMs: avgMs,
          lastError: ok ? null : "all requests timed out",
          lastCheckedAt: now,
          lastSuccessAt: ok ? now : (existing?.lastSuccessAt ?? null),
          lastFailedAt: ok ? (existing?.lastFailedAt ?? null) : now,
        });
      }
      return globalStatus;
    }

    // Full sweep — set checking state immediately and broadcast
    const prevStatusForCheck = globalStatus;
    globalStatus = "checking";
    broadcastSse({
      type: "connectivity_status",
      status: "checking",
      isChecking: true,
      results: Array.from(resultsMap.values()),
      nextRetryAt: nextRetryAt?.toISOString() ?? null,
    });

    let anyOnline = false;
    const now = new Date();

    for (const target of ACTIVE_TARGETS) {
      _currentlyCheckingTarget = target.name;
      broadcastSse({
        type: "connectivity_status",
        status: "checking",
        isChecking: true,
        currentlyCheckingTarget: target.name,
        results: Array.from(resultsMap.values()),
        nextRetryAt: nextRetryAt?.toISOString() ?? null,
      });
      const { ok, avgMs } = await pingHost(target.host, timeoutMs, attempts);
      const existing = resultsMap.get(target.id);

      resultsMap.set(target.id, {
        id: target.id,
        name: target.name,
        host: target.host,
        lastStatus: ok ? "online" : "offline",
        lastResponseTimeMs: avgMs,
        lastError: ok ? null : "all requests timed out",
        lastCheckedAt: now,
        lastSuccessAt: ok ? now : (existing?.lastSuccessAt ?? null),
        lastFailedAt: ok ? (existing?.lastFailedAt ?? null) : now,
      });

      // High-level summary → main console + event log.
      // The detailed CMD-style ping output (emitConn) stays in the Connectivity Terminal only.
      const summaryMs = avgMs !== null ? ` (${avgMs}ms)` : "";
      emitConsoleEvent({
        type: "system",
        level: ok ? "info" : "warn",
        message: ok
          ? `🌐 Connectivity: ${target.name} → online${summaryMs}`
          : `🔴 Connectivity: ${target.name} (${target.host}) → offline`,
      });
      logEvent(
        ok ? "info" : "warn",
        "connectivity",
        ok
          ? `✅ Connectivity: ${target.name} → online${summaryMs}`
          : `❌ Connectivity: ${target.name} (${target.host}) → offline`,
      );

      if (ok) {
        anyOnline = true;
        // Fast-online: mark online immediately as soon as any target responds
        globalStatus = "online";
        lastOnlineAt = new Date();
        broadcastSse({
          type: "connectivity_status",
          status: "online",
          isChecking: true,
          results: Array.from(resultsMap.values()),
          nextRetryAt: null,
        });
        break;
      }
    }

    const prevStatus = prevStatusForCheck;
    if (!anyOnline) globalStatus = "offline";

    if (anyOnline) {
      lastOnlineAt = new Date();
      clearOfflineRetry();
      if (prevStatus === "offline") {
        offlineNotificationSent = false;
        emitConn("info", "--- Connectivity RESTORED — monitoring sweep will resume ---");
        logEvent("info", "monitor", "✅ Internet connectivity restored — monitoring will resume");
        broadcastSse({ type: "connectivity_restored", timestamp: new Date().toISOString() });
      }
    } else {
      lastOfflineAt = new Date();
      emitConn("error", "--- All targets unreachable — connectivity OFFLINE ---");
      if (!offlineNotificationSent) {
        offlineNotificationSent = true;
        logEvent("warn", "monitor", "⚠️ Internet connectivity OFFLINE — monitoring sweeps paused");
        broadcastSse({ type: "connectivity_lost", timestamp: new Date().toISOString() });
      }
      if (runtimeConfig.autoChecksEnabled) {
        scheduleOfflineRetry();
      }
    }

    broadcastSse({
      type: "connectivity_status",
      status: globalStatus,
      isChecking: false,
      currentlyCheckingTarget: null,
      results: Array.from(resultsMap.values()),
      nextRetryAt: nextRetryAt?.toISOString() ?? null,
    });

    return globalStatus;
  } catch (err) {
    logger.warn({ err }, "Connectivity check error");
    emitConn("error", `Connectivity check error: ${String(err)}`);
    return globalStatus;
  } finally {
    _isChecking = false;
    _currentlyCheckingTarget = null;
  }
}

// ── Post-sweep connectivity check (non-blocking, 5-minute delayed) ───────────
let sweepCheckPending = false;
let sweepCheckTimer: ReturnType<typeof setTimeout> | null = null;
export function runConnectivityCheckAfterSweep(): void {
  if (sweepCheckPending) return;
  sweepCheckPending = true;
  if (sweepCheckTimer) { clearTimeout(sweepCheckTimer); sweepCheckTimer = null; }
  sweepCheckTimer = setTimeout(async () => {
    sweepCheckTimer = null;
    sweepCheckPending = false;
    try {
      if (_isChecking) return;
      emitConn("info", "=== Post-sweep connectivity check (5 min after sweep) ===");
      await runConnectivityCheck();
    } catch {}
  }, 5 * 60 * 1000);
}

// ── Emergency connectivity check (during consecutive DOWN spike) ──────────────
let emergencyCheckPending = false;
export async function triggerEmergencyConnectivityCheck(): Promise<ConnStatus> {
  if (emergencyCheckPending) return globalStatus;
  emergencyCheckPending = true;
  try {
    emitConn("warn", "=== Emergency connectivity check (multiple DOWN results) ===");
    logEvent("warn", "monitor", "🔍 Emergency connectivity check triggered — multiple consecutive DOWN results");
    return await runConnectivityCheck();
  } finally {
    emergencyCheckPending = false;
  }
}

// ── Offline retry scheduler ───────────────────────────────────────────────────
function scheduleOfflineRetry(): void {
  if (offlineRetryHandle !== null) return;
  if (!runtimeConfig.autoChecksEnabled) return;

  const retryMs = runtimeConfig.offlineRetryMs;
  nextRetryAt = new Date(Date.now() + retryMs);

  emitConn("warn", `Retrying in ${Math.round(retryMs / 1000)}s...`);

  broadcastSse({
    type: "connectivity_retry_scheduled",
    nextRetryAt: nextRetryAt.toISOString(),
  });

  offlineRetryHandle = setTimeout(async () => {
    offlineRetryHandle = null;
    nextRetryAt = null;
    if (globalStatus === "offline") {
      emitConn("info", "=== Retry connectivity check ===");
      await runConnectivityCheck();
    }
  }, retryMs);
}

function clearOfflineRetry(): void {
  if (offlineRetryHandle !== null) {
    clearTimeout(offlineRetryHandle);
    offlineRetryHandle = null;
  }
  nextRetryAt = null;
}

// ── Pre-sweep connectivity gate ────────────────────────────────────────────────
export async function runPreSweepConnectivityCheck(): Promise<boolean> {
  emitConn("info", "=== Pre-sweep connectivity check ===");
  const status = await runConnectivityCheck();
  if (status === "offline") {
    emitConn("error", "Pre-sweep check FAILED — sweep will not start until connectivity is restored");
    logEvent("warn", "monitor", "Monitoring sweep skipped — pre-sweep connectivity check failed");
    return false;
  }
  emitConn("info", "Pre-sweep check OK — starting monitoring sweep");
  return true;
}

// ── Startup ───────────────────────────────────────────────────────────────────
export async function startConnectivityScheduler(): Promise<void> {
  try {
    const { getSettings } = await import("./settings");
    const settings = await getSettings();
    runtimeConfig = {
      autoChecksEnabled: settings.connectivityAutoChecksEnabled,
      offlineRetryMs: settings.connectivityOfflineRetryMs,
      pingTimeoutMs: settings.connectivityPingTimeoutMs,
      pingAttempts: settings.connectivityPingAttempts,
      pauseWhileOffline: settings.connectivityPauseWhileOffline,
      notificationsEnabled: settings.connectivityNotificationsEnabled,
    };

    const targetList = ACTIVE_TARGETS.map((t) => `${t.name}:${t.host}`).join(", ");
    emitConn("info", `=== Connectivity scheduler started — targets: ${targetList} ===`);
    logger.info({ targets: ACTIVE_TARGETS }, "Connectivity scheduler started");

    await runConnectivityCheck();
  } catch (err) {
    logger.warn({ err }, "Connectivity scheduler startup error");
  }
}
