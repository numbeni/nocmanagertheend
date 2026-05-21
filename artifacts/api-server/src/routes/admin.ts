import { Router, type IRouter } from "express";
import { db, importantAlertsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import {
  getNextcloudTalkConfigStatus,
  isNextcloudTalkConfigured,
  sendImportantAlert,
} from "../services/important-alerts";
import { logEvent } from "../monitoring/logger";

const router: IRouter = Router();

router.get("/admin/nextcloud-talk-status", async (_req, res) => {
  const cfg = getNextcloudTalkConfigStatus();
  const lastSent = await db
    .select()
    .from(importantAlertsTable)
    .orderBy(desc(importantAlertsTable.sentAt))
    .limit(1);
  const last = lastSent[0] ?? null;
  res.json({
    configured: cfg.configured,
    hasUrl: cfg.hasUrl,
    hasUser: cfg.hasUser,
    hasPassword: cfg.hasPassword,
    roomCount: cfg.roomCount,
    lastAlertAt: last ? last.sentAt.toISOString() : null,
    lastAlertType: last?.alertType ?? null,
    lastAlertSuccess: last?.success ?? null,
    lastAlertError: last?.errorMessage ?? null,
  });
});

router.post("/admin/test-nextcloud-talk", async (_req, res) => {
  if (!isNextcloudTalkConfigured()) {
    res.status(400).json({
      ok: false,
      sent: false,
      reason: "nextcloud_talk_not_configured",
      message:
        "Set NEXTCLOUD_TALK_URL, NEXTCLOUD_TALK_USER, NEXTCLOUD_TALK_PASSWORD and NEXTCLOUD_TALK_ROOM (or NEXTCLOUD_TALK_ROOMS) environment variables.",
    });
    return;
  }
  const stamp = new Date().toISOString();
  const result = await sendImportantAlert({
    siteId: 0,
    alertType: "test",
    severity: "info",
    rootCause: `manual_${Date.now()}`,
    cooldownMinutes: 0,
    message: {
      english: [
        "🧪 This is a test alert from your NOC Monitor.",
        `🕒 At: ${stamp}`,
        "If you can read this, Nextcloud Talk notifications are working correctly.",
      ].join("\n"),
      persian: [
        "🧪 این یک پیام آزمایشی از سامانه پایش NOC شماست.",
        `🕒 زمان: ${stamp}`,
        "اگر این پیام را می‌بینید، اتصال Nextcloud Talk به‌درستی برقرار است.",
      ].join("\n"),
    },
  });
  logEvent(
    result.sent ? "info" : "warn",
    "system",
    `Manual Nextcloud Talk test: ${result.sent ? "sent" : `failed (${result.reason})`}`,
  );
  res.json({
    ok: true,
    sent: result.sent,
    reason: result.reason ?? null,
    sentAt: stamp,
  });
});

export default router;
