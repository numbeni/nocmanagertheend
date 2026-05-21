/**
 * Nextcloud Talk alert service — important company-level alerts only.
 *
 * Uses the real Nextcloud Talk OCS API:
 *   POST {NEXTCLOUD_TALK_URL}/ocs/v2.php/apps/spreed/api/v1/chat/{room}
 *   Auth: Basic (NEXTCLOUD_TALK_USER:NEXTCLOUD_TALK_PASSWORD)
 *   Headers: OCS-APIRequest: true
 *
 * Environment variables:
 *   NEXTCLOUD_TALK_URL       Base URL, e.g. https://next.vibrence.shop
 *   NEXTCLOUD_TALK_USER      Bot username
 *   NEXTCLOUD_TALK_PASSWORD  Bot password
 *   NEXTCLOUD_TALK_ROOMS     Comma-separated room tokens (preferred)
 *   NEXTCLOUD_TALK_ROOM      Single room token (fallback)
 *
 * Only serious/critical alerts are sent — NOT every check.
 * Deduplication / cooldown is enforced via a fingerprint stored in PostgreSQL.
 */

import * as https from "node:https";
import * as http from "node:http";
import { URL } from "node:url";
import {
  db,
  importantAlertsTable,
  type InsertImportantAlert,
  type Site,
} from "@workspace/db";
import { and, desc, eq, gte } from "drizzle-orm";
import { logger } from "../lib/logger";
import { logEvent } from "../monitoring/logger";
import { getCachedSettings } from "./settings";
import { emitConsoleEvent } from "../monitoring/console-events";

const NEXTCLOUD_OCS_PATH = "/ocs/v2.php/apps/spreed/api/v1/chat";
const MAX_MESSAGE_LENGTH = 32_000; // Nextcloud Talk hard limit is ~32 KB
const DEFAULT_COOLDOWN_MINUTES = 30;
const SEND_TIMEOUT_MS = 30_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertType =
  | "site_down"
  | "site_recovered"
  | "ssl_expiring"
  | "ssl_expired"
  | "dns_failure"
  | "http_5xx"
  | "tcp_unreachable"
  | "incident_critical"
  | "incident_resolved"
  | "gateway_down"
  | "gateway_recovered"
  | "test";

export type Severity = "info" | "warning" | "critical";

export interface BilingualMessage {
  english: string;
  persian: string;
}

export interface AlertPayload {
  siteId: number;
  alertType: AlertType;
  severity: Severity;
  /** Stable identifier for the underlying root cause, e.g. "dns", "http_500". */
  rootCause: string;
  message: BilingualMessage;
  /** Override default cooldown for this alert type (minutes). */
  cooldownMinutes?: number;
}

// ─── Config helpers ───────────────────────────────────────────────────────────

function getBaseUrl(): string | undefined {
  return process.env["NEXTCLOUD_TALK_URL"]?.replace(/\/+$/, "");
}

function getUser(): string | undefined {
  return process.env["NEXTCLOUD_TALK_USER"];
}

function getPassword(): string | undefined {
  return process.env["NEXTCLOUD_TALK_PASSWORD"];
}

function getRooms(): string[] {
  const multi = process.env["NEXTCLOUD_TALK_ROOMS"];
  if (multi) {
    return multi
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
  }
  const single = process.env["NEXTCLOUD_TALK_ROOM"]?.trim();
  return single ? [single] : [];
}

export function isNextcloudTalkConfigured(): boolean {
  return Boolean(getBaseUrl() && getUser() && getPassword() && getRooms().length > 0);
}

export function getNextcloudTalkConfigStatus(): {
  configured: boolean;
  hasUrl: boolean;
  hasUser: boolean;
  hasPassword: boolean;
  roomCount: number;
} {
  return {
    configured: isNextcloudTalkConfigured(),
    hasUrl: Boolean(getBaseUrl()),
    hasUser: Boolean(getUser()),
    hasPassword: Boolean(getPassword()),
    roomCount: getRooms().length,
  };
}

// ─── Fingerprint / cooldown ───────────────────────────────────────────────────

export function buildFingerprint(payload: {
  siteId: number;
  alertType: AlertType;
  rootCause: string;
  severity: Severity;
}): string {
  return `${payload.siteId}:${payload.alertType}:${payload.rootCause}:${payload.severity}`;
}

async function withinCooldown(
  fingerprint: string,
  cooldownMinutes: number,
): Promise<boolean> {
  if (cooldownMinutes <= 0) return false;
  const since = new Date(Date.now() - cooldownMinutes * 60 * 1000);
  const rows = await db
    .select({ id: importantAlertsTable.id })
    .from(importantAlertsTable)
    .where(
      and(
        eq(importantAlertsTable.fingerprint, fingerprint),
        eq(importantAlertsTable.success, true),
        gte(importantAlertsTable.sentAt, since),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// ─── Tehran timezone helper ───────────────────────────────────────────────────

/**
 * Format a Date (or now) as a human-readable Tehran (Asia/Tehran) date+time string.
 * Returns both the Persian calendar string and an ISO-style string for logging.
 */
export function fmtTehranDateTime(date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      timeZone: "Asia/Tehran",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    // Fallback: UTC ISO with offset note
    return date.toISOString() + " (UTC)";
  }
}

/** Same but returns the Gregorian time in Tehran timezone (for English messages). */
export function fmtTehranDateTimeEn(date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tehran",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date) + " (Tehran)";
  } catch {
    return date.toISOString() + " (UTC)";
  }
}

// ─── Message formatting ───────────────────────────────────────────────────────

function severityEmoji(severity: Severity, alertType: AlertType): string {
  if (alertType === "site_recovered" || alertType === "incident_resolved") return "✅";
  if (alertType === "test") return "🧪";
  if (severity === "critical") return "🚨";
  if (severity === "warning") return "⚠️";
  return "ℹ️";
}

function alertHeaderEnglish(type: AlertType, sev: Severity): string {
  switch (type) {
    case "site_down":        return "Critical Hosting Alert";
    case "site_recovered":   return "Site Recovered";
    case "ssl_expiring":     return "SSL Expiring Soon";
    case "ssl_expired":      return "SSL Certificate Expired";
    case "dns_failure":      return "DNS Failure";
    case "http_5xx":         return "Server Errors (5xx)";
    case "tcp_unreachable":  return "TCP Port Unreachable";
    case "incident_critical":return "Critical Incident";
    case "incident_resolved":return "Incident Resolved";
    case "gateway_down":     return "Payment Gateway Down";
    case "gateway_recovered":return "Payment Gateway Recovered";
    case "test":             return "Nextcloud Talk — Test Alert";
    default: return sev === "critical" ? "Critical Alert" : "Hosting Alert";
  }
}

function alertHeaderPersian(type: AlertType): string {
  switch (type) {
    case "site_down":        return "هشدار مهم هاستینگ";
    case "site_recovered":   return "بازیابی سایت";
    case "ssl_expiring":     return "انقضای نزدیک گواهی SSL";
    case "ssl_expired":      return "گواهی SSL منقضی شد";
    case "dns_failure":      return "خطای DNS";
    case "http_5xx":         return "خطای سرور (5xx)";
    case "tcp_unreachable":  return "عدم دسترسی به پورت TCP";
    case "incident_critical":return "حادثه بحرانی";
    case "incident_resolved":return "حل شدن حادثه";
    case "gateway_down":     return "درگاه پرداخت از دسترس خارج شد";
    case "gateway_recovered":return "درگاه پرداخت بازیابی شد";
    case "test":             return "Nextcloud Talk — پیام آزمایشی";
    default: return "هشدار هاستینگ";
  }
}

/**
 * Build the plain-text message body for the configured alert language.
 * Nextcloud Talk uses plain text (no HTML).
 *
 * `language` controls which side of the bilingual payload is emitted:
 *   - "en" → English only
 *   - "fa" → Persian only (default — operators here are Persian)
 */
export function formatBilingualMessage(opts: {
  emoji: string;
  englishHeader: string;
  persianHeader: string;
  english: string;
  persian: string;
  language?: "fa" | "en";
}): string {
  const language = opts.language ?? "fa";
  if (language === "en") {
    return [`${opts.emoji} ${opts.englishHeader}`, "", opts.english].join("\n");
  }
  return [`${opts.emoji} ${opts.persianHeader}`, "", opts.persian].join("\n");
}

/** Split on newline boundaries so each chunk stays under the Nextcloud size limit. */
export function splitMessage(text: string, max = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  const lines = text.split("\n");
  let current = "";
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > max) {
      if (current) { out.push(current); current = line; }
      else {
        for (let i = 0; i < line.length; i += max) out.push(line.slice(i, i + max));
        current = "";
      }
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out;
}

// ─── Low-level HTTP send (one room) ──────────────────────────────────────────

interface SendResult {
  ok: boolean;
  error?: string;
}

/**
 * Send one message chunk to a Nextcloud Talk room.
 * Uses node:https directly (mirrors Python requests behaviour):
 *  - Basic Auth header built manually
 *  - OCS-APIRequest: true
 *  - JSON body
 *  - 30-second timeout
 *  - rejectUnauthorized: false — allows internal/self-signed certs
 *    (matches Python requests default when verify is not enforced)
 */
function sendToRoom(
  baseUrl: string,
  user: string,
  password: string,
  room: string,
  message: string,
): Promise<SendResult> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: SendResult) => {
      if (!settled) { settled = true; resolve(result); }
    };

    try {
      const endpoint = new URL(`${baseUrl}${NEXTCLOUD_OCS_PATH}/${room}`);
      const body = JSON.stringify({ message });
      const basicAuth = Buffer.from(`${user}:${password}`).toString("base64");

      const options: https.RequestOptions = {
        hostname: endpoint.hostname,
        port: endpoint.port || (endpoint.protocol === "https:" ? 443 : 80),
        path: endpoint.pathname + endpoint.search,
        method: "POST",
        headers: {
          "OCS-APIRequest": "true",
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Basic ${basicAuth}`,
          "Content-Length": Buffer.byteLength(body),
        },
        rejectUnauthorized: false, // allow internal/company Nextcloud certs
        timeout: SEND_TIMEOUT_MS,
      };

      const transport = endpoint.protocol === "https:" ? https : http;
      const req = (transport as typeof https).request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            done({ ok: true });
          } else {
            done({
              ok: false,
              error: `Nextcloud API ${status}: ${responseBody.slice(0, 300)}`,
            });
          }
        });
      });

      req.on("timeout", () => {
        req.destroy();
        done({ ok: false, error: `Request timed out after ${SEND_TIMEOUT_MS}ms` });
      });

      req.on("error", (err: Error) => {
        done({ ok: false, error: `Network error: ${err.message}` });
      });

      req.write(body);
      req.end();
    } catch (err) {
      done({
        ok: false,
        error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });
}

// ─── Main send function ───────────────────────────────────────────────────────

/**
 * Send an important alert to all configured Nextcloud Talk rooms.
 * Uses deduplication / cooldown. NEVER throws — monitoring loop must keep running.
 */
export async function sendImportantAlert(payload: AlertPayload): Promise<{
  sent: boolean;
  reason?: string;
}> {
  const emitDecision = (reason: string, level: "debug" | "info" | "warn" = "info") => {
    emitConsoleEvent({
      type: "alert",
      level,
      siteId: payload.siteId,
      message: `alert ${payload.alertType} suppressed — ${reason}`,
      details: { alertType: payload.alertType, severity: payload.severity, rootCause: payload.rootCause },
    });
  };

  if (!isNextcloudTalkConfigured()) {
    emitDecision("nextcloud_talk_not_configured", "debug");
    return { sent: false, reason: "nextcloud_talk_not_configured" };
  }

  const settings = getCachedSettings();

  // Operator master-switch (Settings page → "Send Nextcloud alerts").
  // The "test" alertType always goes through so the Test button stays useful.
  if (!settings.nextcloudAlertsEnabled && payload.alertType !== "test") {
    emitDecision("alerts_disabled_in_settings");
    return { sent: false, reason: "alerts_disabled_in_settings" };
  }

  // Optional: suppress recovery / incident-resolved noise.
  if (
    settings.suppressResolvedAlerts &&
    (payload.alertType === "site_recovered" ||
      payload.alertType === "incident_resolved")
  ) {
    emitDecision("resolved_alerts_suppressed");
    return { sent: false, reason: "resolved_alerts_suppressed" };
  }

  // Severity gating — operator may opt out of info-only or warning alerts.
  // The "test" type and recovery messages are always allowed through (they're
  // already governed by the dedicated suppress switch above).
  if (
    payload.alertType !== "test" &&
    payload.alertType !== "site_recovered" &&
    payload.alertType !== "incident_resolved" &&
    Array.isArray(settings.alertSeverities) &&
    settings.alertSeverities.length > 0 &&
    !settings.alertSeverities.includes(payload.severity)
  ) {
    emitDecision("severity_filtered");
    return { sent: false, reason: "severity_filtered" };
  }

  // Alert-type filter — operator may disable specific alert categories.
  if (
    payload.alertType !== "test" &&
    Array.isArray(settings.alertTypes) &&
    settings.alertTypes.length > 0 &&
    !(settings.alertTypes as string[]).includes(payload.alertType)
  ) {
    emitDecision("alert_type_filtered");
    return { sent: false, reason: "alert_type_filtered" };
  }

  const fingerprint = buildFingerprint(payload);
  // Operator-controlled cooldown wins over per-call default. Convert seconds
  // → minutes for the existing fingerprint deduplication machinery.
  const operatorCooldownMin = Math.max(
    1,
    Math.round((settings.alertCooldownSec ?? 0) / 60),
  );
  const cooldown =
    payload.cooldownMinutes ??
    (settings.alertCooldownSec ? operatorCooldownMin : DEFAULT_COOLDOWN_MINUTES);

  try {
    if (await withinCooldown(fingerprint, cooldown)) {
      emitDecision(`cooldown_${cooldown}m`, "debug");
      return { sent: false, reason: "cooldown" };
    }
  } catch (err) {
    logger.warn({ err }, "Nextcloud Talk cooldown check failed; proceeding to send");
  }

  const composed = formatBilingualMessage({
    emoji: severityEmoji(payload.severity, payload.alertType),
    englishHeader: alertHeaderEnglish(payload.alertType, payload.severity),
    persianHeader: alertHeaderPersian(payload.alertType),
    english: payload.message.english,
    persian: payload.message.persian,
    language: settings.alertLanguage,
  });

  const chunks = splitMessage(composed);
  const baseUrl = getBaseUrl()!;
  const user = getUser()!;
  const password = getPassword()!;
  const rooms = getRooms();

  let allOk = true;
  let lastError: string | undefined;

  outer: for (const room of rooms) {
    for (const chunk of chunks) {
      const result = await sendToRoom(baseUrl, user, password, room, chunk);
      if (!result.ok) {
        allOk = false;
        lastError = result.error;
        logger.error({ err: result.error, room }, "Nextcloud Talk send failed");
        logEvent(
          "error",
          "system",
          `Nextcloud Talk send failed (room ${room}): ${result.error}`,
          {
            siteId: payload.siteId,
            details: { alertType: payload.alertType, fingerprint },
          },
        );
        break outer;
      }
    }
  }

  const insert: InsertImportantAlert = {
    siteId: payload.siteId,
    alertType: payload.alertType,
    fingerprint,
    severity: payload.severity,
    success: allOk,
    errorMessage: allOk ? null : (lastError ?? "unknown error"),
  };
  try {
    await db.insert(importantAlertsTable).values(insert);
  } catch (err) {
    logger.error({ err }, "Failed to persist Nextcloud Talk alert history");
  }

  if (allOk) {
    logEvent(
      payload.severity === "critical" ? "warn" : "info",
      "system",
      `Nextcloud Talk alert sent: ${payload.alertType} (${payload.rootCause}) → ${rooms.length} room(s)`,
      {
        siteId: payload.siteId,
        details: { fingerprint, severity: payload.severity },
      },
    );
    emitConsoleEvent({
      type: "alert",
      level: payload.severity === "critical" ? "warn" : "info",
      siteId: payload.siteId,
      message: `alert sent ${payload.alertType} (${payload.severity}) → ${rooms.length} room(s)`,
      details: { alertType: payload.alertType, severity: payload.severity, rootCause: payload.rootCause },
    });
  } else {
    emitConsoleEvent({
      type: "alert",
      level: "error",
      siteId: payload.siteId,
      message: `alert send failed ${payload.alertType} — ${lastError ?? "unknown"}`,
      details: { alertType: payload.alertType, error: lastError },
    });
  }

  return { sent: allOk, reason: allOk ? undefined : lastError };
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

export async function getLastImportantAlertForSite(siteId: number) {
  const rows = await db
    .select()
    .from(importantAlertsTable)
    .where(eq(importantAlertsTable.siteId, siteId))
    .orderBy(desc(importantAlertsTable.sentAt))
    .limit(1);
  return rows[0] ?? null;
}

export function siteContextLines(site: Site): BilingualMessage {
  return {
    english: [`🌐 Site: ${site.name}`, `🔗 URL: ${site.url}`].join("\n"),
    persian: [`🌐 سایت: ${site.name}`, `🔗 آدرس: ${site.url}`].join("\n"),
  };
}
