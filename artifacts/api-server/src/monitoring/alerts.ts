import { type Site, type Check, type Incident } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  isNextcloudTalkConfigured,
  sendImportantAlert,
  type AlertPayload,
  siteContextLines,
  fmtTehranDateTime,
  fmtTehranDateTimeEn,
} from "../services/important-alerts";
import { getCachedSettings } from "../services/settings";

/**
 * Top-level helper that decides whether a check warrants an important alert and
 * dispatches it to the Nextcloud Talk / internal channel.
 * Must NEVER throw — monitoring loop must keep running.
 *
 * Only serious state transitions fire an alert. The cooldown machinery in the
 * important-alerts service prevents repeated messages for the same issue.
 */
export async function maybeAlertOnCheck(
  site: Site,
  prevCheck: Check | null,
  current: Check,
): Promise<void> {
  if (!isNextcloudTalkConfigured()) return;
  try {
    const ctx = siteContextLines(site);
    const tsEn = fmtTehranDateTimeEn(current.timestamp);
    const tsFa = fmtTehranDateTime(current.timestamp);

    // Site went DOWN — only alert after 2 consecutive down checks to avoid
    // single-blip noise. Specifically: alert when this is the SECOND
    // consecutive down (current down + previous also down). The first down
    // is silent; the third+ are silenced by sendImportantAlert's cooldown.
    if (
      current.overallStatus === "down" &&
      prevCheck &&
      prevCheck.overallStatus === "down"
    ) {
      const rootCause = current.errorType ?? "unknown";
      const payload: AlertPayload = {
        siteId: site.id,
        alertType: "site_down",
        severity: "critical",
        rootCause,
        message: {
          english: [
            ctx.english,
            "",
            "🛑 Status: DOWN",
            `❗ Reason: ${current.errorMessage ?? "Unknown error"}`,
            current.httpStatus ? `🌐 HTTP: ${current.httpStatus}` : null,
            current.dnsStatus ? `🧭 DNS: ${current.dnsStatus}` : null,
            `🕒 At: ${tsEn}`,
            "",
            "Action: Verify DNS records, server availability and nameservers.",
          ]
            .filter(Boolean)
            .join("\n"),
          persian: [
            ctx.persian,
            "",
            "🛑 وضعیت: از دسترس خارج",
            `❗ علت: ${current.errorMessage ?? "خطای نامشخص"}`,
            current.httpStatus ? `🌐 HTTP: ${current.httpStatus}` : null,
            current.dnsStatus ? `🧭 DNS: ${current.dnsStatus}` : null,
            `🕒 زمان: ${tsFa}`,
            "",
            "اقدام پیشنهادی: رکوردهای DNS، نیم‌سرورها و دسترس‌پذیری سرور بررسی شوند.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      };
      await sendImportantAlert(payload);
      return;
    }

    // Site recovered from down/degraded → up
    if (
      current.overallStatus === "up" &&
      prevCheck &&
      (prevCheck.overallStatus === "down" ||
        prevCheck.overallStatus === "degraded")
    ) {
      await sendImportantAlert({
        siteId: site.id,
        alertType: "site_recovered",
        severity: "info",
        rootCause: "recovery",
        cooldownMinutes: 5,
        message: {
          english: [
            ctx.english,
            "",
            "✅ Status: UP — Site is back online.",
            current.responseTimeMs
              ? `⏱ Response: ${current.responseTimeMs} ms`
              : null,
            `🕒 At: ${tsEn}`,
          ]
            .filter(Boolean)
            .join("\n"),
          persian: [
            ctx.persian,
            "",
            "✅ وضعیت: فعال — سایت دوباره در دسترس است.",
            current.responseTimeMs
              ? `⏱ زمان پاسخ: ${current.responseTimeMs} میلی‌ثانیه`
              : null,
            `🕒 زمان: ${tsFa}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      });
      return;
    }

    // SSL expiring within 3 days — critical; within sslExpiryAlertDays — warning
    const sslThreshold = getCachedSettings().sslExpiryAlertDays ?? 30;
    if (
      current.sslStatus === "expiring_soon" &&
      typeof current.sslDaysRemaining === "number" &&
      current.sslDaysRemaining <= sslThreshold
    ) {
      await sendImportantAlert({
        siteId: site.id,
        alertType: "ssl_expiring",
        severity: current.sslDaysRemaining <= 3 ? "critical" : "warning",
        rootCause: `ssl_${current.sslDaysRemaining}d`,
        cooldownMinutes: 60 * 12, // once per 12h while still expiring
        message: {
          english: [
            ctx.english,
            "",
            `🔐 SSL expires in ${current.sslDaysRemaining} day(s)`,
            current.sslIssuer ? `Issuer: ${current.sslIssuer}` : null,
            `🕒 At: ${tsEn}`,
            "",
            "Action: Renew SSL certificate before it expires.",
          ]
            .filter(Boolean)
            .join("\n"),
          persian: [
            ctx.persian,
            "",
            `🔐 گواهی SSL تا ${current.sslDaysRemaining} روز دیگر منقضی می‌شود`,
            current.sslIssuer ? `صادرکننده: ${current.sslIssuer}` : null,
            `🕒 زمان: ${tsFa}`,
            "",
            "اقدام پیشنهادی: گواهی SSL را قبل از انقضا تمدید کنید.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      });
    }

    // HTTP 5xx — only on transition into error
    if (
      current.httpStatus &&
      current.httpStatus >= 500 &&
      (!prevCheck || !prevCheck.httpStatus || prevCheck.httpStatus < 500)
    ) {
      await sendImportantAlert({
        siteId: site.id,
        alertType: "http_5xx",
        severity: "warning",
        rootCause: `http_${current.httpStatus}`,
        message: {
          english: [
            ctx.english,
            "",
            `⚠️ Server error HTTP ${current.httpStatus}`,
            current.errorMessage ? `Detail: ${current.errorMessage}` : null,
            `🕒 At: ${tsEn}`,
          ]
            .filter(Boolean)
            .join("\n"),
          persian: [
            ctx.persian,
            "",
            `⚠️ خطای سرور HTTP ${current.httpStatus}`,
            current.errorMessage ? `جزئیات: ${current.errorMessage}` : null,
            `🕒 زمان: ${tsFa}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      });
    }

    // Both TCP ports closed — possible total host outage
    if (
      current.tcp80Open === false &&
      current.tcp443Open === false &&
      (!prevCheck ||
        prevCheck.tcp80Open !== false ||
        prevCheck.tcp443Open !== false)
    ) {
      await sendImportantAlert({
        siteId: site.id,
        alertType: "tcp_unreachable",
        severity: "critical",
        rootCause: "tcp_all_closed",
        message: {
          english: [
            ctx.english,
            "",
            "🔌 Both TCP/80 and TCP/443 are unreachable.",
            `🕒 At: ${tsEn}`,
          ].join("\n"),
          persian: [
            ctx.persian,
            "",
            "🔌 پورت‌های TCP/80 و TCP/443 هر دو در دسترس نیستند.",
            `🕒 زمان: ${tsFa}`,
          ].join("\n"),
        },
      });
    }
  } catch (err) {
    logger.error({ err, siteId: site.id }, "maybeAlertOnCheck failed");
  }
}

/** Called when an incident reaches critical severity (first time). */
export async function alertIncidentOpened(
  site: Site,
  incident: Incident,
): Promise<void> {
  if (!isNextcloudTalkConfigured()) return;
  try {
    const ctx = siteContextLines(site);
    await sendImportantAlert({
      siteId: site.id,
      alertType: "incident_critical",
      severity: incident.severity === "critical" ? "critical" : "warning",
      rootCause: `${incident.incidentType}:${incident.id}`,
      message: {
        english: [
          ctx.english,
          "",
          `🚨 Incident: ${incident.title}`,
          `📈 Severity: ${incident.severity}`,
          `🔁 Failed checks: ${incident.failureCount}`,
          incident.description ? `Detail: ${incident.description}` : null,
          `🕒 Opened: ${fmtTehranDateTimeEn(incident.startedAt)}`,
        ]
          .filter(Boolean)
          .join("\n"),
        persian: [
          ctx.persian,
          "",
          `🚨 حادثه: ${incident.title}`,
          `📈 شدت: ${incident.severity}`,
          `🔁 تعداد بررسی‌های ناموفق: ${incident.failureCount}`,
          incident.description ? `جزئیات: ${incident.description}` : null,
          `🕒 زمان شروع: ${fmtTehranDateTime(incident.startedAt)}`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    });
  } catch (err) {
    logger.error({ err, incidentId: incident.id }, "alertIncidentOpened failed");
  }
}

export async function alertIncidentResolved(
  site: Site,
  incident: Incident,
): Promise<void> {
  if (!isNextcloudTalkConfigured()) return;
  try {
    const ctx = siteContextLines(site);
    await sendImportantAlert({
      siteId: site.id,
      alertType: "incident_resolved",
      severity: "info",
      rootCause: `${incident.incidentType}:${incident.id}`,
      cooldownMinutes: 1,
      message: {
        english: [
          ctx.english,
          "",
          `✅ Incident resolved: ${incident.title}`,
          incident.resolvedReason ? `📝 Reason: ${incident.resolvedReason}` : null,
          incident.resolvedBy ? `👤 Resolved by: ${incident.resolvedBy}` : null,
          `🕒 Resolved at: ${fmtTehranDateTimeEn(incident.resolvedAt ?? new Date())}`,
        ]
          .filter(Boolean)
          .join("\n"),
        persian: [
          ctx.persian,
          "",
          `✅ حادثه حل شد: ${incident.title}`,
          incident.resolvedReason ? `📝 دلیل: ${incident.resolvedReason}` : null,
          incident.resolvedBy
            ? `👤 حل‌کننده: ${incident.resolvedBy === "system" ? "سامانه" : "اپراتور"}`
            : null,
          `🕒 زمان حل: ${fmtTehranDateTime(incident.resolvedAt ?? new Date())}`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    });
  } catch (err) {
    logger.error(
      { err, incidentId: incident.id },
      "alertIncidentResolved failed",
    );
  }
}
