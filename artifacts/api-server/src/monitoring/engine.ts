import {
  db,
  sitesTable,
  serversTable,
  checksTable,
  dnsResolverTestsTable,
  sslTargetsTable,
  type Site,
  type Check,
  type InsertCheck,
} from "@workspace/db";
import { runCurlCheck } from "./curl-check";
import { and, asc, desc, eq, isNull, inArray, isNotNull, lt } from "drizzle-orm";
import { logger } from "../lib/logger";
import { logEvent } from "./logger";
import { checkHttp } from "./http";
import { checkTcpPort } from "./tcp";
import { checkSsl } from "./ssl";
import { quickDnsCheck } from "./dns";
import { detectBlockedStatus } from "./blocked";
import { processCheckResult } from "./incidents";
import { maybeAlertOnCheck } from "./alerts";
import { getCachedSettings } from "../services/settings";
import { isNextcloudTalkConfigured, sendImportantAlert } from "../services/important-alerts";
import { isInternetOffline, triggerEmergencyConnectivityCheck, runConnectivityCheckAfterSweep, runPreSweepConnectivityCheck, runConnectivityCheck, getConnectivityState } from "../services/connectivity";
import {
  isMonitoringPaused,
  isSweepCancelRequested,
  clearSweepCancel,
  markSweepStarted,
  markSweepCompleted,
  setCurrentTarget,
  clearCurrentTarget,
  setMonitoringSweepInFlight,
  isMonitoringSweepInFlight,
  isSslScanInFlight,
  markSslScanStarted,
  markSslScanWaiting,
  markSslScanProgress,
  markSslScanCompleted,
  setSslScanNextAt,
  setCurrentServer,
  clearCurrentServer,
  setCurrentPhase,
  setCurrentPhaseProgress,
  updateConfirmedDownSiteIds,
  setCooldownEndsAt,
  setMonitorIntervalMs,
} from "./monitor-state";
import { emitConsoleEvent } from "./console-events";
import { broadcastSse } from "../services/sse-broadcast";

export type OverallStatus =
  | "up"
  | "slow"
  | "down"
  | "degraded"
  | "blocked"
  | "unknown";

export interface FullCheckResult {
  overallStatus: OverallStatus;
  httpStatus: number | null;
  responseTimeMs: number | null;
  dnsStatus: string | null;
  dnsResolveMs: number | null;
  resolvedIp: string | null;
  resolverUsed: string | null;
  resolverAddress: string | null;
  tcp80Open: boolean | null;
  tcp443Open: boolean | null;
  sslStatus: string | null;
  sslDaysRemaining: number | null;
  sslIssuer: string | null;
  errorType: string | null;
  errorMessage: string | null;
  blockedReason: string | null;
}

export function deriveHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Run a full check for a site. SSL checks are now managed separately
 * by the SSL Certificates module and are NOT run here during the main
 * monitoring sweep. This prevents duplicate SSL logic and unnecessary load.
 * Manual single-site checks (from site-detail or operator actions) still
 * run at high priority and are not affected by this.
 */
export async function runFullCheck(site: Site): Promise<FullCheckResult> {
  const host = site.host;

  // DNS first — every check resolves DNS and stores the result.
  setCurrentTarget(site.id, site.name, "dns");
  const dns = await quickDnsCheck(host);
  emitConsoleEvent({
    type: "dns",
    level: dns.ok ? "info" : "warn",
    siteId: site.id,
    siteName: site.name,
    message: `dns ${dns.ok ? "ok" : "fail"} ${dns.resolveMs ? `(${dns.resolveMs}ms)` : ""} ${dns.addresses[0] ?? ""}`.trim(),
    details: { ok: dns.ok, status: dns.status, addresses: dns.addresses },
  });

  setCurrentTarget(site.id, site.name, "http+tcp");
  // Independent layers run in parallel — SSL is now managed by the SSL Certificates module
  const [http, tcp80, tcp443] = await Promise.all([
    checkHttp(site.url),
    checkTcpPort(host, 80),
    checkTcpPort(host, 443),
  ]);

  emitConsoleEvent({
    type: "http",
    level: http.status === "ok" ? "info" : http.status === "slow" ? "warn" : "error",
    siteId: site.id,
    siteName: site.name,
    message: `http ${http.status}${http.httpStatus ? ` ${http.httpStatus}` : ""}${http.responseTimeMs ? ` ${Math.round(http.responseTimeMs)}ms` : ""}`,
    details: { status: http.status, httpStatus: http.httpStatus, responseTimeMs: http.responseTimeMs },
  });
  emitConsoleEvent({
    type: "tcp",
    level: tcp80 || tcp443 ? "info" : "warn",
    siteId: site.id,
    siteName: site.name,
    message: `tcp 80=${tcp80 ? "open" : "closed"} 443=${tcp443 ? "open" : "closed"}`,
    details: { tcp80, tcp443 },
  });

  // Evidence-based blocked detection — never relies on hardcoded lists.
  const blocked = detectBlockedStatus({
    httpStatus: http.httpStatus,
    bodySample: http.bodySample,
    headers: http.headers,
  });

  let overallStatus: OverallStatus = "up";
  let errorType: string | null = null;
  let errorMessage: string | null = null;

  if (blocked.blocked) {
    overallStatus = "blocked";
    errorType = "blocked";
    errorMessage = blocked.reason;
  } else if (!dns.ok) {
    overallStatus = "down";
    errorType = "dns_failure";
    errorMessage = dns.error || "DNS resolution failed";
  } else if (http.status === "down" || http.status === "timeout") {
    overallStatus = "down";
    errorType = http.errorType;
    errorMessage = http.errorMessage;
  } else if (http.status === "server_error") {
    overallStatus = "down";
    errorType = "application_issue";
    errorMessage = http.errorMessage;
  } else if (http.status === "slow" || dns.status === "slow") {
    overallStatus = "slow";
    errorType = "latency_issue";
    errorMessage = http.errorMessage || `Slow DNS (${dns.resolveMs}ms)`;
  } else if (http.status === "client_error") {
    overallStatus = "degraded";
    errorType = "application_issue";
    errorMessage = http.errorMessage;
  }

  return {
    overallStatus,
    httpStatus: http.httpStatus,
    responseTimeMs: http.responseTimeMs,
    dnsStatus: dns.status,
    dnsResolveMs: dns.resolveMs,
    resolvedIp: dns.addresses.length > 0 ? dns.addresses.join(",") : null,
    resolverUsed: dns.resolverUsed,
    resolverAddress: dns.resolverAddress,
    tcp80Open: tcp80,
    tcp443Open: tcp443,
    // SSL is now managed by the SSL Certificates module — null here
    sslStatus: null,
    sslDaysRemaining: null,
    sslIssuer: null,
    errorType,
    errorMessage,
    blockedReason: blocked.reason,
  };
}

export async function runAndStoreCheck(site: Site) {
  // Capture the previous check BEFORE running the new one — used by the alert
  // engine to detect state transitions (UP→DOWN, DOWN→UP, etc.).
  let previousCheck: Check | null = null;
  try {
    const prevRows = await db
      .select()
      .from(checksTable)
      .where(eq(checksTable.siteId, site.id))
      .orderBy(desc(checksTable.timestamp))
      .limit(1);
    previousCheck = prevRows[0] ?? null;
  } catch (err) {
    logger.warn({ err, siteId: site.id }, "Failed to fetch previous check");
  }

  const result = await runFullCheck(site);
  const insert: InsertCheck = {
    siteId: site.id,
    overallStatus: result.overallStatus,
    httpStatus: result.httpStatus,
    responseTimeMs: result.responseTimeMs,
    dnsStatus: result.dnsStatus,
    dnsResolveMs: result.dnsResolveMs,
    tcp80Open: result.tcp80Open,
    tcp443Open: result.tcp443Open,
    sslStatus: result.sslStatus,
    sslDaysRemaining: result.sslDaysRemaining,
    sslIssuer: result.sslIssuer,
    errorType: result.errorType,
    errorMessage: result.errorMessage,
    blockedReason: result.blockedReason,
    resolvedIp: result.resolvedIp,
    resolverUsed: result.resolverUsed,
  };
  const [row] = await db.insert(checksTable).values(insert).returning();
  if (!row) throw new Error("Failed to insert check");

  // Save DNS resolver test result for performance analytics (fire-and-forget)
  if (result.resolverUsed && result.resolverAddress) {
    db.insert(dnsResolverTestsTable).values({
      resolverName: result.resolverUsed,
      resolverAddress: result.resolverAddress,
      domain: site.host,
      siteId: site.id,
      success: result.dnsStatus !== "failed",
      latencyMs: result.dnsResolveMs != null ? Math.round(result.dnsResolveMs) : null,
      resolvedIp: result.resolvedIp ? result.resolvedIp.split(",")[0] ?? null : null,
      errorMessage: result.dnsStatus === "failed" ? (result.errorMessage ?? null) : null,
      source: "auto",
    }).catch(() => {});
  }

  if (result.overallStatus === "up" || result.overallStatus === "slow") {
    if (!site.hasEverBeenUp) {
      await db
        .update(sitesTable)
        .set({ hasEverBeenUp: true, lastSuccessAt: row.timestamp })
        .where(eq(sitesTable.id, site.id));
    } else {
      await db
        .update(sitesTable)
        .set({ lastSuccessAt: row.timestamp })
        .where(eq(sitesTable.id, site.id));
    }
  }

  const level =
    result.overallStatus === "down"
      ? "error"
      : result.overallStatus === "degraded" ||
          result.overallStatus === "slow" ||
          result.overallStatus === "blocked"
        ? "warn"
        : "info";

  if (result.overallStatus === "blocked") {
    logEvent(
      "warn",
      "monitor",
      `[BLOCKED] ${site.host} — HTTP ${result.httpStatus ?? "—"} (${result.blockedReason ?? "unknown"})`,
      {
        siteId: site.id,
        details: {
          url: site.url,
          httpStatus: result.httpStatus,
          blockedReason: result.blockedReason,
        },
      },
    );
  }

  const detailParts: string[] = [];
  if (result.httpStatus) detailParts.push(`HTTP ${result.httpStatus}`);
  if (result.responseTimeMs != null)
    detailParts.push(`${Math.round(result.responseTimeMs)}ms`);
  if (result.resolvedIp) detailParts.push(`→ ${result.resolvedIp.split(",")[0]}`);
  if (result.errorMessage) detailParts.push(result.errorMessage);
  logEvent(
    level,
    "monitor",
    `${site.name} → ${result.overallStatus.toUpperCase()}${
      detailParts.length ? " (" + detailParts.join(", ") + ")" : ""
    }`,
    {
      siteId: site.id,
      details: {
        url: site.url,
        overallStatus: result.overallStatus,
        httpStatus: result.httpStatus,
        responseTimeMs: result.responseTimeMs,
        dnsStatus: result.dnsStatus,
        resolvedIp: result.resolvedIp,
        resolverUsed: result.resolverUsed,
        errorType: result.errorType,
        errorMessage: result.errorMessage,
        blockedReason: result.blockedReason,
      },
    },
  );

  await processCheckResult(site, row);
  await maybeAlertOnCheck(site, previousCheck, row);
  return row;
}

// ── Server-based 3-phase monitoring sweep ──────────────────────────────────────
// Configurable cooldown between servers (default 5 s, updated by settings API)
let _serverCooldownMs = 5_000;

export function setServerCooldownMs(ms: number): void {
  _serverCooldownMs = ms;
}

export function getServerCooldownMs(): number {
  return _serverCooldownMs;
}

let intervalHandle: NodeJS.Timeout | null = null;
let inFlight = false;

/**
 * Run a single site check with cancel-check support.
 * Returns the check row, or null if the sweep was cancelled.
 */
async function runSiteWithCancel(site: Site): Promise<{ row: Awaited<ReturnType<typeof runAndStoreCheck>>; cancelled: false } | { cancelled: true }> {
  if (isMonitoringPaused() || isSweepCancelRequested()) {
    return { cancelled: true };
  }
  emitConsoleEvent({
    type: "site",
    level: "info",
    siteId: site.id,
    siteName: site.name,
    message: `checking ${site.host}`,
  });
  const row = await runAndStoreCheck(site);
  return { row, cancelled: false };
}

/** Auto-expire currentlyFine sites whose set duration has elapsed */
async function cleanupExpiredCurrentlyFine() {
  try {
    const now = new Date();
    const expired = await db
      .select({ id: sitesTable.id, name: sitesTable.name })
      .from(sitesTable)
      .where(and(
        eq(sitesTable.currentlyFine, true),
        isNotNull(sitesTable.currentlyFineUntil),
        lt(sitesTable.currentlyFineUntil, now),
      ));
    if (expired.length > 0) {
      await db.update(sitesTable).set({
        currentlyFine: false,
        currentlyFineAt: null,
        currentlyFineBy: null,
        currentlyFineUntil: null,
      }).where(and(
        eq(sitesTable.currentlyFine, true),
        isNotNull(sitesTable.currentlyFineUntil),
        lt(sitesTable.currentlyFineUntil, now),
      ));
      for (const s of expired) {
        logEvent("info", "monitor", `Currently-fine auto-expired: ${s.name}`);
      }
    }
  } catch (err) {
    logger.warn("cleanupExpiredCurrentlyFine error:", err);
  }
}

/**
 * Server-aware 3-phase monitoring sweep:
 *
 * For each server (in displayOrder):
 *   Phase 1 — first pass:  check every site on that server sequentially
 *   Phase 2 — second pass: re-check any sites that came back "down"
 *   Cooldown:              configurable pause before moving to next server
 *
 * After all servers:
 *   Phase 3 — final recheck: check all sites still confirmed down globally
 *
 * Iranian network resilience: a site only enters the Critical banner after
 * failing BOTH the first and second passes (2 independent checks needed).
 */
export async function runMonitoringSweep() {
  await cleanupExpiredCurrentlyFine();

  // Always run a fresh connectivity check before starting a sweep.
  // This prevents false DOWN alerts when the monitoring server has no internet.
  const canSweep = await runPreSweepConnectivityCheck();
  if (!canSweep) {
    logger.info("Monitoring sweep skipped — pre-sweep connectivity check failed (internet offline)");
    return;
  }

  // Also honour the cached offline state (in case the check above was racing)
  if (isInternetOffline()) {
    logger.info("Monitoring sweep skipped — internet connectivity is offline");
    return;
  }
  if (isMonitoringPaused()) {
    logger.info("Monitoring sweep skipped — monitoring is paused");
    return;
  }
  if (inFlight) {
    logger.warn("Monitoring sweep already in progress, skipping");
    return;
  }
  if (isSslScanInFlight()) {
    logger.info("Monitoring sweep deferred — SSL batch scan is in progress");
    emitConsoleEvent({ type: "cycle", level: "info", message: "monitoring sweep deferred — waiting for SSL scan" });
    return;
  }

  inFlight = true;
  setMonitoringSweepInFlight(true);
  clearSweepCancel();
  markSweepStarted();
  let checked = 0;
  let wasCancelled = false;

  try {
    // Fetch all enabled, non-paused, non-"currently-fine" sites
    const allSites = await db
      .select()
      .from(sitesTable)
      .where(and(eq(sitesTable.enabled, true), eq(sitesTable.monitoringPaused, false), eq(sitesTable.currentlyFine, false)));

    if (allSites.length === 0) {
      logEvent("info", "system", "Monitoring sweep skipped — no active sites");
      markSweepCompleted(0);
      return;
    }

    // Skip unassigned sites — they are excluded from sweeps until assigned to a server
    const unassigned = allSites.filter((s) => s.serverId === null || s.serverId === undefined);
    const assignedSites = allSites.filter((s) => s.serverId !== null && s.serverId !== undefined);

    if (unassigned.length > 0) {
      logEvent(
        "warn",
        "system",
        `Sweep: ${unassigned.length} site(s) skipped (no server assigned): ${unassigned.map((s) => s.name).join(", ")}`,
      );
      emitConsoleEvent({
        type: "cycle",
        level: "warn",
        message: `${unassigned.length} unassigned site(s) skipped`,
        details: { skipped: unassigned.map((s) => ({ id: s.id, name: s.name })) },
      });
    }

    if (assignedSites.length === 0) {
      logEvent("info", "system", "Monitoring sweep skipped — no assigned sites");
      markSweepCompleted(0);
      return;
    }

    // Fetch ordered server list
    const servers = await db
      .select()
      .from(serversTable)
      .orderBy(asc(serversTable.displayOrder), asc(serversTable.id));

    // Group assigned sites by serverId
    const sitesByServer = new Map<number, typeof assignedSites>();
    for (const site of assignedSites) {
      if (site.serverId != null) {
        const arr = sitesByServer.get(site.serverId) ?? [];
        arr.push(site);
        sitesByServer.set(site.serverId, arr);
      }
    }

    const activeServerCount = servers.filter((s) => (sitesByServer.get(s.id)?.length ?? 0) > 0).length;
    const skipNote = unassigned.length > 0 ? ` (${unassigned.length} unassigned skipped)` : "";
    logEvent("info", "system", `Server-based sweep started — ${assignedSites.length} sites across ${activeServerCount} server(s)${skipNote}`);
    emitConsoleEvent({
      type: "cycle",
      level: "info",
      message: `sweep started — ${assignedSites.length} site(s), ${activeServerCount} server(s)${skipNote}`,
    });
    broadcastSse({ type: "sweep_started", siteCount: assignedSites.length, timestamp: new Date().toISOString() });

    // All globally confirmed down site IDs (after 2 passes per server)
    const globalConfirmedDownIds: number[] = [];

    // ── Connectivity-loss tracking ───────────────────────────────────────────
    let consecutiveDownResults = 0;
    let connectivityLostAt: Date | null = null;

    /**
     * Tracks consecutive DOWN site results during a sweep.
     * When the configured threshold is hit, triggers an emergency connectivity
     * check and suspends the sweep at the current position until restored.
     * Returns true if wasCancelled (caller should break out of loop).
     */
    async function handleConnectivityCheck(siteDown: boolean, phaseName: string): Promise<boolean> {
      const sweepSettings = getCachedSettings();
      const emergencyEnabled = (sweepSettings as any).connectivityEmergencyCheckEnabled ?? true;
      const threshold = (sweepSettings as any).connectivityEmergencyDownThreshold ?? 3;

      if (siteDown) {
        consecutiveDownResults++;
      } else {
        consecutiveDownResults = 0;
        if (connectivityLostAt) {
          connectivityLostAt = null;
          setCurrentPhase(phaseName as Parameters<typeof setCurrentPhase>[0]);
        }
        return false;
      }

      if (!emergencyEnabled || consecutiveDownResults < threshold) return false;

      // Threshold reached — run emergency connectivity check
      const connStatus = await triggerEmergencyConnectivityCheck();
      consecutiveDownResults = 0;

      if (connStatus !== "offline") return false;

      // Internet is offline — suspend sweep in place
      if (!connectivityLostAt) {
        connectivityLostAt = new Date();
        logEvent("warn", "system", "Internet connectivity loss detected — sweep suspended at current position");
        emitConsoleEvent({ type: "cycle", level: "warn", message: "connectivity lost — sweep suspended" });
      }
      setCurrentPhase("blocked");

      // Poll every 3s until connectivity returns or operator cancels
      while (true) {
        await new Promise((r) => setTimeout(r, 3_000));
        if (isSweepCancelRequested()) return true; // operator cancelled
        if (!isInternetOffline()) {
          logEvent("info", "system", "Internet connectivity restored — resuming sweep");
          emitConsoleEvent({ type: "cycle", level: "info", message: "connectivity restored — resuming sweep" });
          connectivityLostAt = null;
          consecutiveDownResults = 0;
          setCurrentPhase(phaseName as Parameters<typeof setCurrentPhase>[0]);
          return false;
        }
      }
    }

    // ── Per-server sweep ────────────────────────────────────────────────────
    for (let si = 0; si < servers.length; si++) {
      if (isMonitoringPaused() || isSweepCancelRequested()) {
        wasCancelled = true;
        break;
      }

      const server = servers[si]!;
      const serverSites = sitesByServer.get(server.id) ?? [];
      if (serverSites.length === 0) continue;

      setCurrentServer(server.id, server.name);

      // ── Phase 1: First pass ─────────────────────────────────────────────
      setCurrentPhase("first_pass");
      setCurrentPhaseProgress(0, serverSites.length);
      emitConsoleEvent({
        type: "cycle",
        level: "info",
        message: `[${server.code}] first pass — ${serverSites.length} site(s)`,
      });

      const downAfterFirst: Site[] = [];
      let firstPassDone = 0;
      for (const site of serverSites) {
        const result = await runSiteWithCancel(site);
        if (result.cancelled) { wasCancelled = true; break; }
        checked++;
        firstPassDone++;
        setCurrentPhaseProgress(firstPassDone, serverSites.length);
        const siteDown = result.row.overallStatus === "down";
        const cancelled = await handleConnectivityCheck(siteDown, "first_pass");
        if (cancelled) { wasCancelled = true; break; }
        if (result.row.overallStatus === "down") {
          downAfterFirst.push(site);
        }
      }
      if (wasCancelled) break;

      // ── Phase 2: Second pass (re-check only down sites) ─────────────────
      const confirmedDownInServer: Site[] = [];
      if (downAfterFirst.length > 0) {
        setCurrentPhase("second_pass");
        setCurrentPhaseProgress(0, downAfterFirst.length);
        emitConsoleEvent({
          type: "cycle",
          level: "warn",
          message: `[${server.code}] second pass — ${downAfterFirst.length} down site(s)`,
        });

        let secondPassDone = 0;
        for (const site of downAfterFirst) {
          const result = await runSiteWithCancel(site);
          if (result.cancelled) { wasCancelled = true; break; }
          checked++;
          secondPassDone++;
          setCurrentPhaseProgress(secondPassDone, downAfterFirst.length);
          const siteDown = result.row.overallStatus === "down";
          const cancelled = await handleConnectivityCheck(siteDown, "second_pass");
          if (cancelled) { wasCancelled = true; break; }
          if (result.row.overallStatus === "down") {
            confirmedDownInServer.push(site);
          }
        }
        if (wasCancelled) break;

        if (confirmedDownInServer.length > 0) {
          emitConsoleEvent({
            type: "cycle",
            level: "error",
            message: `[${server.code}] ${confirmedDownInServer.length} confirmed down after 2 passes`,
          });
        }
      }

      // Accumulate confirmed down sites globally
      for (const s of confirmedDownInServer) {
        if (!globalConfirmedDownIds.includes(s.id)) globalConfirmedDownIds.push(s.id);
      }
      updateConfirmedDownSiteIds([...globalConfirmedDownIds]);
      broadcastSse({ type: "server_done", serverId: server.id, confirmedDownIds: globalConfirmedDownIds, timestamp: new Date().toISOString() });

      // ── Cooldown before next server ─────────────────────────────────────
      const isLastServer = si === servers.length - 1 || servers.slice(si + 1).every((s) => (sitesByServer.get(s.id)?.length ?? 0) === 0);
      if (!isLastServer && _serverCooldownMs > 0) {
        setCurrentPhase("cooldown");
        const endsAt = new Date(Date.now() + _serverCooldownMs);
        setCooldownEndsAt(endsAt);
        emitConsoleEvent({ type: "cycle", level: "info", message: `cooldown ${_serverCooldownMs}ms before next server` });

        await new Promise<void>((resolve) => {
          const endTime = Date.now() + _serverCooldownMs;
          const poll = setInterval(() => {
            if (isMonitoringPaused() || isSweepCancelRequested() || Date.now() >= endTime) {
              clearInterval(poll);
              resolve();
            }
          }, 250);
        });

        setCooldownEndsAt(null);
        if (isMonitoringPaused() || isSweepCancelRequested()) {
          wasCancelled = true;
          break;
        }
      }
    }

    clearCurrentServer();

    // ── Phase 3: Final global down recheck ──────────────────────────────────
    if (!wasCancelled && globalConfirmedDownIds.length > 0) {
      // Connectivity gate before final recheck — wait until online
      {
        emitConsoleEvent({ type: "cycle", level: "info", message: "connectivity check before final recheck..." });
        const connBefore = await runConnectivityCheck();
        if (connBefore === "offline" || connBefore === "checking") {
          // Wait until internet is back before proceeding with final recheck
          setCurrentPhase("blocked");
          emitConsoleEvent({ type: "cycle", level: "warn", message: "waiting for internet before final recheck..." });
          while (true) {
            await new Promise((r) => setTimeout(r, 3_000));
            if (isSweepCancelRequested()) { wasCancelled = true; break; }
            const st = getConnectivityState().status;
            if (st === "online") {
              emitConsoleEvent({ type: "cycle", level: "info", message: "internet confirmed online — starting final recheck" });
              break;
            }
          }
          if (wasCancelled) {
            // skip Phase 3 entirely
            globalConfirmedDownIds.length = 0;
          }
        }
      }

      setCurrentPhase("final_recheck");
      const recheckSites = allSites.filter((s) => globalConfirmedDownIds.includes(s.id));
      setCurrentPhaseProgress(0, recheckSites.length);
      emitConsoleEvent({
        type: "cycle",
        level: "warn",
        message: `final recheck — ${globalConfirmedDownIds.length} globally confirmed down site(s)`,
      });

      const stillDownIds: number[] = [];
      let recheckDone = 0;
      for (const site of recheckSites) {
        const result = await runSiteWithCancel(site);
        if (result.cancelled) { wasCancelled = true; break; }
        checked++;
        recheckDone++;
        setCurrentPhaseProgress(recheckDone, recheckSites.length);
        const siteDown = result.row.overallStatus === "down";
        const cancelled = await handleConnectivityCheck(siteDown, "final_recheck");
        if (cancelled) { wasCancelled = true; break; }
        if (result.row.overallStatus === "down") {
          stillDownIds.push(site.id);
        }
      }

      // Update final confirmed down set after global recheck
      updateConfirmedDownSiteIds(stillDownIds);
      if (stillDownIds.length > 0) {
        emitConsoleEvent({
          type: "cycle",
          level: "error",
          message: `${stillDownIds.length} site(s) remain down after final recheck`,
        });

        // Optional post-sweep persistent-down alert
        const sweepSettings = getCachedSettings();
        if (sweepSettings.alertPersistentDown && isNextcloudTalkConfigured()) {
          const persistentSites = allSites.filter((s) => stillDownIds.includes(s.id));
          if (persistentSites.length > 0) {
            const siteList = persistentSites.map((s) => `• ${s.name} (${s.host})`).join("\n");
            sendImportantAlert({
              siteId: persistentSites[0]!.id,
              alertType: "site_down",
              severity: "critical",
              rootCause: `persistent_sweep:${stillDownIds.sort().join(",")}`,
              cooldownMinutes: Math.max(1, Math.round(sweepSettings.monitorIntervalMs / 60_000)),
              message: {
                english: [`🛑 Sweep summary — ${persistentSites.length} site(s) still down:`, "", siteList].join("\n"),
                persian: [`🛑 خلاصه چرخه — ${persistentSites.length} سایت همچنان از دسترس خارج است:`, "", siteList].join("\n"),
              },
            }).catch(() => {});
          }
        }
      }
    } else if (!wasCancelled && globalConfirmedDownIds.length === 0) {
      // All clear — wipe confirmed down list
      updateConfirmedDownSiteIds([]);
    }

    broadcastSse({
      type: "sweep_completed",
      checked,
      siteCount: allSites.length,
      cancelled: wasCancelled,
      timestamp: new Date().toISOString(),
    });
    logEvent("info", "system", `Server-based sweep ${wasCancelled ? "cancelled" : "completed"} — ${checked} checks`);
    emitConsoleEvent({
      type: "cycle",
      level: "info",
      message: `sweep ${wasCancelled ? "cancelled" : "completed"} — ${checked} checks`,
    });
  } catch (err) {
    logger.error({ err }, "Server-based monitoring sweep failed");
  } finally {
    inFlight = false;
    setMonitoringSweepInFlight(false);
    clearCurrentTarget();
    clearCurrentServer();
    if (!wasCancelled) setCurrentPhase("idle");
    else setCurrentPhase("idle");
    clearSweepCancel();
    markSweepCompleted(checked);
    // Run a lightweight connectivity check after each sweep (if configured)
    const postSweepSettings = getCachedSettings();
    if ((postSweepSettings as any).connectivityCheckAfterSweep ?? true) {
      runConnectivityCheckAfterSweep();
    }
  }
}

let currentIntervalMs = 60_000;

export function getCurrentMonitorIntervalMs(): number {
  return currentIntervalMs;
}

export function startMonitoringScheduler(intervalMs = 60_000) {
  if (intervalHandle) return;
  currentIntervalMs = intervalMs;
  setMonitorIntervalMs(intervalMs);
  runMonitoringSweep().catch((err) =>
    logger.error({ err }, "Initial monitoring sweep failed"),
  );
  intervalHandle = setInterval(() => {
    runMonitoringSweep().catch((err) =>
      logger.error({ err }, "Monitoring sweep failed"),
    );
  }, intervalMs);
  logger.info({ intervalMs }, "Monitoring scheduler started");
  logEvent(
    "info",
    "system",
    `Monitoring scheduler started — interval ${intervalMs}ms (~${Math.round(intervalMs / 1000)}s)`,
  );
}

/**
 * Live-reschedule the monitoring loop without restarting the server.
 */
export function restartMonitoringScheduler(intervalMs: number) {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  setMonitorIntervalMs(intervalMs);
  startMonitoringScheduler(intervalMs);
  logEvent(
    "info",
    "system",
    `Monitoring scheduler re-scheduled — new interval ${intervalMs}ms (~${Math.round(intervalMs / 1000)}s)`,
  );
}

// ── 12-hour background curl sweeper ───────────────────────────────────────────

let curlSchedulerHandle: ReturnType<typeof setInterval> | null = null;

async function runCurlBatchForAllSites(): Promise<void> {
  if (inFlight) {
    setTimeout(() => runCurlBatchForAllSites().catch(() => {}), 60_000);
    return;
  }
  let done = 0;
  try {
    const sites = await db
      .select({ id: sitesTable.id, url: sitesTable.url })
      .from(sitesTable)
      .where(and(eq(sitesTable.enabled, true), eq(sitesTable.monitoringPaused, false)));

    logEvent("info", "system", `curl batch sweep started — ${sites.length} site(s)`);

    for (const site of sites) {
      try {
        const result = await runCurlCheck(site.url);
        await db
          .update(sitesTable)
          .set({
            latestCurlDiagnostic: JSON.stringify(result),
            latestCurlDiagnosticAt: new Date(),
          })
          .where(eq(sitesTable.id, site.id));
        done++;
      } catch {
        // Non-critical — skip this site and continue
      }
    }
    logEvent("info", "system", `curl batch sweep completed — ${done}/${sites.length} site(s)`);
  } catch (err) {
    logger.error({ err }, "curl batch sweep failed");
  }
}

export function startCurlScheduler(): void {
  if (curlSchedulerHandle) return;
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  curlSchedulerHandle = setInterval(() => {
    runCurlBatchForAllSites().catch((err) => logger.error({ err }, "Curl batch sweep error"));
  }, TWELVE_HOURS);
  logger.info({ intervalMs: TWELVE_HOURS }, "Curl background scheduler started — 12h interval");
  logEvent("info", "system", "Curl background scheduler started — 12h interval");
}

// ── SSL certificate 24-hour scheduler ────────────────────────────────────────

let sslSchedulerHandle: ReturnType<typeof setInterval> | null = null;
const SSL_INTER_SITE_DELAY_MS = 800;
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

export async function runSslBatchForAllTargets(): Promise<void> {
  if (isSslScanInFlight()) {
    logger.warn("SSL batch scan already in progress, skipping");
    return;
  }

  if (inFlight) {
    markSslScanWaiting();
    logger.info("SSL batch scan waiting — monitoring sweep in progress");
    emitConsoleEvent({ type: "cycle", level: "info", message: "SSL scan waiting for monitoring sweep to finish" });
    const maxWaitMs = 10 * 60 * 1000;
    const pollMs = 5_000;
    const startWait = Date.now();
    while (inFlight) {
      await new Promise((r) => setTimeout(r, pollMs));
      if (Date.now() - startWait > maxWaitMs) {
        logger.warn("SSL batch scan gave up waiting — monitoring sweep too long");
        markSslScanCompleted();
        return;
      }
    }
  }

  let done = 0;
  try {
    const targets = await db
      .select({ id: sslTargetsTable.id, host: sslTargetsTable.host, port: sslTargetsTable.port })
      .from(sslTargetsTable);

    markSslScanStarted(targets.length);
    logEvent("info", "system", `SSL batch sweep started — ${targets.length} target(s)`);
    emitConsoleEvent({ type: "cycle", level: "info", message: `SSL batch scan started — ${targets.length} target(s)` });

    for (const target of targets) {
      if (inFlight) await new Promise((r) => setTimeout(r, 2_000));
      try {
        const result = await checkSsl(target.host, target.port);
        // Fetch previous status for change detection
        const [prevRow] = await db.select({ lastStatus: sslTargetsTable.lastStatus, lastDaysRemaining: sslTargetsTable.lastDaysRemaining })
          .from(sslTargetsTable).where(eq(sslTargetsTable.id, target.id)).limit(1);
        await db
          .update(sslTargetsTable)
          .set({
            lastCheckedAt: new Date(),
            lastStatus: result.status,
            lastDaysRemaining: result.daysRemaining,
            lastIssuer: result.issuer,
            lastSubject: result.subject,
            lastValidFrom: result.validFrom,
            lastValidTo: result.validTo,
            lastProtocol: result.protocol,
            lastError: result.error,
          })
          .where(eq(sslTargetsTable.id, target.id));
        // Fire Nextcloud alerts on SSL state changes
        if (isNextcloudTalkConfigured()) {
          const prevStatus = prevRow?.lastStatus ?? null;
          if (result.status === "expired" && prevStatus !== "expired") {
            sendImportantAlert({
              type: "ssl_expired",
              severity: "critical",
              siteName: target.host,
              details: { host: target.host, daysRemaining: result.daysRemaining },
            }).catch(() => {});
          } else if (result.status === "expiring_soon" && prevStatus !== "expiring_soon" && prevStatus !== "expired") {
            sendImportantAlert({
              type: "ssl_expiring",
              severity: (result.daysRemaining ?? 30) <= 7 ? "critical" : "warning",
              siteName: target.host,
              details: { host: target.host, daysRemaining: result.daysRemaining },
            }).catch(() => {});
          }
        }
        done++;
        markSslScanProgress(done);
      } catch {
        // Non-critical — skip this target
      }
      await new Promise((r) => setTimeout(r, SSL_INTER_SITE_DELAY_MS));
    }
    logEvent("info", "system", `SSL batch sweep completed — ${done}/${targets.length} target(s)`);
    emitConsoleEvent({ type: "cycle", level: "info", message: `SSL batch scan completed — ${done}/${targets.length} target(s)` });
  } catch (err) {
    logger.error({ err }, "SSL batch sweep failed");
  } finally {
    markSslScanCompleted();
  }
}

export function startSslScheduler(): void {
  if (sslSchedulerHandle) return;
  const initialDelay = 5 * 60 * 1000;
  setSslScanNextAt(new Date(Date.now() + initialDelay));
  setTimeout(() => {
    runSslBatchForAllTargets().catch((err) => logger.error({ err }, "SSL initial sweep error"));
    setSslScanNextAt(new Date(Date.now() + TWENTY_FOUR_HOURS));
  }, initialDelay);
  sslSchedulerHandle = setInterval(() => {
    runSslBatchForAllTargets().catch((err) => logger.error({ err }, "SSL batch sweep error"));
    setSslScanNextAt(new Date(Date.now() + TWENTY_FOUR_HOURS));
  }, TWENTY_FOUR_HOURS);
  logger.info({ intervalMs: TWENTY_FOUR_HOURS }, "SSL certificate scheduler started — 24h interval");
  logEvent("info", "system", "SSL certificate scheduler started — 24h interval");
}
