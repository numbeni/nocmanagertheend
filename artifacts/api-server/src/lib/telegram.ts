import {
  db,
  telegramAlertsTable,
  type InsertTelegramAlert,
  type Site,
} from "@workspace/db";
import { and, desc, eq, gte } from "drizzle-orm";
import { logger } from "./logger";
import { logEvent } from "../monitoring/logger";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const MAX_TELEGRAM_MESSAGE_BYTES = 4000; // safe under 4096 hard limit
const DEFAULT_COOLDOWN_MINUTES = 30;

export type AlertType =
  | "site_down"
  | "site_recovered"
  | "ssl_expiring"
  | "dns_failure"
  | "http_5xx"
  | "tcp_unreachable"
  | "incident_critical"
  | "incident_resolved"
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
  /** Stable identifier for the underlying root cause (e.g. "dns", "http_500"). */
  rootCause: string;
  message: BilingualMessage;
  /** Override default cooldown for this alert type. */
  cooldownMinutes?: number;
}

export function isTelegramConfigured(): boolean {
  return Boolean(
    process.env["TELEGRAM_BOT_TOKEN"] && process.env["TELEGRAM_CHAT_ID"],
  );
}

export function getTelegramConfigStatus(): {
  configured: boolean;
  hasBotToken: boolean;
  hasChatId: boolean;
  chatIdMasked: string | null;
} {
  const hasBotToken = Boolean(process.env["TELEGRAM_BOT_TOKEN"]);
  const chatIdRaw = process.env["TELEGRAM_CHAT_ID"];
  const hasChatId = Boolean(chatIdRaw);
  let chatIdMasked: string | null = null;
  if (chatIdRaw) {
    if (chatIdRaw.startsWith("@")) {
      // public channel username — not sensitive
      chatIdMasked = chatIdRaw;
    } else {
      // numeric id — show last 4 only
      const tail = chatIdRaw.slice(-4);
      chatIdMasked = `…${tail}`;
    }
  }
  return {
    configured: hasBotToken && hasChatId,
    hasBotToken,
    hasChatId,
    chatIdMasked,
  };
}

export function buildFingerprint(payload: {
  siteId: number;
  alertType: AlertType;
  rootCause: string;
  severity: Severity;
}): string {
  return `${payload.siteId}:${payload.alertType}:${payload.rootCause}:${payload.severity}`;
}

/** Split a message safely on newline boundaries so each chunk fits under the Telegram limit. */
export function splitMessage(text: string, max = MAX_TELEGRAM_MESSAGE_BYTES): string[] {
  const out: string[] = [];
  if (Buffer.byteLength(text, "utf8") <= max) return [text];
  const lines = text.split("\n");
  let current = "";
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (Buffer.byteLength(candidate, "utf8") > max) {
      if (current) {
        out.push(current);
        current = line;
      } else {
        // single line bigger than limit — hard slice by characters
        for (let i = 0; i < line.length; i += max) {
          out.push(line.slice(i, i + max));
        }
        current = "";
      }
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out;
}

interface TelegramSendResult {
  ok: boolean;
  error?: string;
}

async function callTelegramApi(text: string): Promise<TelegramSendResult> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token || !chatId) {
    return { ok: false, error: "Telegram not configured" };
  }
  const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: ac.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Telegram API ${res.status}: ${body.slice(0, 300)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatBilingualAlert(opts: {
  emoji: string;
  englishHeader: string;
  persianHeader: string;
  english: string;
  persian: string;
}): string {
  return [
    `${opts.emoji} <b>${escapeHtml(opts.englishHeader)}</b>`,
    "",
    opts.english,
    "",
    "————",
    "",
    `${opts.emoji} <b>${escapeHtml(opts.persianHeader)}</b>`,
    "",
    opts.persian,
  ].join("\n");
}

async function withinCooldown(
  fingerprint: string,
  cooldownMinutes: number,
): Promise<boolean> {
  const since = new Date(Date.now() - cooldownMinutes * 60 * 1000);
  const rows = await db
    .select({ id: telegramAlertsTable.id })
    .from(telegramAlertsTable)
    .where(
      and(
        eq(telegramAlertsTable.fingerprint, fingerprint),
        eq(telegramAlertsTable.success, true),
        gte(telegramAlertsTable.sentAt, since),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Send an alert to Telegram with built-in deduplication and cooldown.
 * Returns whether the message was actually transmitted.
 *
 * Critical: must NEVER throw — the monitoring loop must keep running even if
 * Telegram is down or misconfigured.
 */
export async function sendAlert(payload: AlertPayload): Promise<{
  sent: boolean;
  reason?: string;
}> {
  if (!isTelegramConfigured()) {
    return { sent: false, reason: "telegram_not_configured" };
  }

  const fingerprint = buildFingerprint(payload);
  const cooldown = payload.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES;

  try {
    if (await withinCooldown(fingerprint, cooldown)) {
      return { sent: false, reason: "cooldown" };
    }
  } catch (err) {
    logger.warn({ err }, "Telegram cooldown check failed; proceeding to send");
  }

  const composed = formatBilingualAlert({
    emoji: severityEmoji(payload.severity, payload.alertType),
    englishHeader: alertHeaderEnglish(payload.alertType, payload.severity),
    persianHeader: alertHeaderPersian(payload.alertType, payload.severity),
    english: payload.message.english,
    persian: payload.message.persian,
  });

  const chunks = splitMessage(composed);
  let allOk = true;
  let lastError: string | undefined;
  for (const chunk of chunks) {
    const result = await callTelegramApi(chunk);
    if (!result.ok) {
      allOk = false;
      lastError = result.error;
      logger.error({ err: result.error }, "Telegram send failed");
      logEvent("error", "system", `Telegram send failed: ${result.error}`, {
        siteId: payload.siteId,
        details: { alertType: payload.alertType, fingerprint },
      });
      break;
    }
  }

  const insert: InsertTelegramAlert = {
    siteId: payload.siteId,
    alertType: payload.alertType,
    fingerprint,
    severity: payload.severity,
    success: allOk,
    errorMessage: allOk ? null : lastError ?? "unknown error",
  };
  try {
    await db.insert(telegramAlertsTable).values(insert);
  } catch (err) {
    logger.error({ err }, "Failed to persist telegram alert history");
  }

  if (allOk) {
    logEvent(
      payload.severity === "critical" ? "warn" : "info",
      "system",
      `Telegram alert sent: ${payload.alertType} (${payload.rootCause})`,
      {
        siteId: payload.siteId,
        details: { fingerprint, severity: payload.severity },
      },
    );
  }
  return { sent: allOk, reason: allOk ? undefined : lastError };
}

function severityEmoji(severity: Severity, alertType: AlertType): string {
  if (alertType === "site_recovered" || alertType === "incident_resolved")
    return "✅";
  if (alertType === "test") return "🧪";
  if (severity === "critical") return "🚨";
  if (severity === "warning") return "⚠️";
  return "ℹ️";
}

function alertHeaderEnglish(type: AlertType, sev: Severity): string {
  switch (type) {
    case "site_down":
      return "Critical Hosting Alert";
    case "site_recovered":
      return "Site Recovered";
    case "ssl_expiring":
      return "SSL Expiring Soon";
    case "dns_failure":
      return "DNS Failure";
    case "http_5xx":
      return "Server Errors (5xx)";
    case "tcp_unreachable":
      return "TCP Port Unreachable";
    case "incident_critical":
      return "Critical Incident";
    case "incident_resolved":
      return "Incident Resolved";
    case "test":
      return "Telegram Test Alert";
    default:
      return sev === "critical" ? "Critical Alert" : "Hosting Alert";
  }
}

function alertHeaderPersian(type: AlertType, _sev: Severity): string {
  switch (type) {
    case "site_down":
      return "هشدار مهم هاستینگ";
    case "site_recovered":
      return "بازیابی سایت";
    case "ssl_expiring":
      return "انقضای نزدیک گواهی SSL";
    case "dns_failure":
      return "خطای DNS";
    case "http_5xx":
      return "خطای سرور (5xx)";
    case "tcp_unreachable":
      return "عدم دسترسی به پورت TCP";
    case "incident_critical":
      return "حادثه بحرانی";
    case "incident_resolved":
      return "حل شدن حادثه";
    case "test":
      return "آزمایش پیام تلگرام";
    default:
      return "هشدار هاستینگ";
  }
}

/** Last alert (any type) for a site, useful for the UI. */
export async function getLastAlertForSite(siteId: number) {
  const rows = await db
    .select()
    .from(telegramAlertsTable)
    .where(eq(telegramAlertsTable.siteId, siteId))
    .orderBy(desc(telegramAlertsTable.sentAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Build a "site context line" that gets prepended to all per-site alert bodies. */
export function siteContextLines(site: Site): BilingualMessage {
  return {
    english: [
      `🌐 Site: ${site.name}`,
      `🔗 URL: ${site.url}`,
    ].join("\n"),
    persian: [
      `🌐 سایت: ${site.name}`,
      `🔗 آدرس: ${site.url}`,
    ].join("\n"),
  };
}
