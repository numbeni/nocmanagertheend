import { Router, type IRouter } from "express";
import {
  getSettings,
  updateSettings,
  type AppSettings,
  type SettingsPatch,
} from "../services/settings";
import { restartMonitoringScheduler } from "../monitoring/engine";
import { applyConnectivitySettings } from "../services/connectivity";
import { logEvent } from "../monitoring/logger";
import { writeAudit } from "../services/audit";

const router: IRouter = Router();

router.get("/settings", async (_req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: "Failed to load settings" });
    void err;
  }
});

router.put("/settings", async (req, res) => {
  const body = (req.body ?? {}) as Partial<AppSettings>;
  const patch: SettingsPatch = {};

  // Booleans
  if (typeof body.nextcloudAlertsEnabled === "boolean") patch.nextcloudAlertsEnabled = body.nextcloudAlertsEnabled;
  if (typeof body.suppressResolvedAlerts === "boolean") patch.suppressResolvedAlerts = body.suppressResolvedAlerts;

  // Strings/enums
  if (body.alertLanguage === "fa" || body.alertLanguage === "en") patch.alertLanguage = body.alertLanguage;
  if (body.themeMode === "dark" || body.themeMode === "light") patch.themeMode = body.themeMode;
  if (body.dateFormat === "iso" || body.dateFormat === "relative" || body.dateFormat === "local") {
    patch.dateFormat = body.dateFormat;
  }
  if (body.defaultDashboardView === "list" || body.defaultDashboardView === "grid") {
    patch.defaultDashboardView = body.defaultDashboardView;
  }

  // Severities (array of enum)
  if (Array.isArray(body.alertSeverities)) {
    patch.alertSeverities = body.alertSeverities.filter((v) =>
      v === "info" || v === "warning" || v === "critical",
    ) as AppSettings["alertSeverities"];
  }

  // Alert types (array of enum)
  if (Array.isArray((body as any).alertTypes)) {
    const allowed = ["site_down", "site_recovered", "ssl_expiring", "dns_failure", "http_5xx", "tcp_unreachable", "incident_critical", "incident_resolved"];
    (patch as any).alertTypes = (body as any).alertTypes.filter((v: string) => allowed.includes(v));
  }
  if (typeof (body as any).alertPersistentDown === "boolean") {
    (patch as any).alertPersistentDown = (body as any).alertPersistentDown;
  }

  // Connectivity booleans
  if (typeof (body as any).connectivityAutoChecksEnabled === "boolean") (patch as any).connectivityAutoChecksEnabled = (body as any).connectivityAutoChecksEnabled;
  if (typeof (body as any).connectivityPauseWhileOffline === "boolean") (patch as any).connectivityPauseWhileOffline = (body as any).connectivityPauseWhileOffline;
  if (typeof (body as any).connectivityOfflinePopupEnabled === "boolean") (patch as any).connectivityOfflinePopupEnabled = (body as any).connectivityOfflinePopupEnabled;
  if (typeof (body as any).connectivityNotificationsEnabled === "boolean") (patch as any).connectivityNotificationsEnabled = (body as any).connectivityNotificationsEnabled;
  if (typeof (body as any).connectivityCheckAfterSweep === "boolean") (patch as any).connectivityCheckAfterSweep = (body as any).connectivityCheckAfterSweep;
  if (typeof (body as any).connectivityEmergencyCheckEnabled === "boolean") (patch as any).connectivityEmergencyCheckEnabled = (body as any).connectivityEmergencyCheckEnabled;

  // Numbers — clamp + validate
  const num = (key: keyof AppSettings, min: number, max: number) => {
    const v = body[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      if (v < min || v > max) {
        return { error: `${String(key)} must be between ${min} and ${max}` };
      }
      (patch as Record<string, unknown>)[String(key)] = Math.floor(v);
    }
    return null;
  };

  const numericChecks: { key: keyof AppSettings; min: number; max: number }[] = [
    { key: "monitorIntervalMs", min: 30_000, max: 24 * 60 * 60 * 1000 },
    { key: "failureThreshold", min: 1, max: 10 },
    { key: "recoveryThreshold", min: 1, max: 10 },
    { key: "requestTimeoutMs", min: 2_000, max: 60_000 },
    { key: "slowResponseMs", min: 200, max: 30_000 },
    { key: "alertCooldownSec", min: 30, max: 24 * 60 * 60 },
    { key: "autoRefreshSec", min: 5, max: 600 },
    { key: "sslExpiryAlertDays" as keyof AppSettings, min: 1, max: 90 },
    { key: "connectivityOfflineRetryMs", min: 2_000, max: 60_000 },
    { key: "connectivityPingTimeoutMs", min: 1_000, max: 10_000 },
    { key: "connectivityPingAttempts", min: 1, max: 5 },
    { key: "connectivityEmergencyDownThreshold", min: 1, max: 20 },
  ];
  for (const { key, min, max } of numericChecks) {
    const r = num(key, min, max);
    if (r?.error) {
      res.status(400).json({ error: r.error });
      return;
    }
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No valid settings supplied" });
    return;
  }

  try {
    const previous = await getSettings();
    const next = await updateSettings(patch);

    if (
      patch.monitorIntervalMs !== undefined &&
      patch.monitorIntervalMs !== previous.monitorIntervalMs
    ) {
      restartMonitoringScheduler(next.monitorIntervalMs);
    }

    const connKeys: (keyof typeof next)[] = [
      "connectivityAutoChecksEnabled",
      "connectivityOfflineRetryMs",
      "connectivityPingTimeoutMs",
      "connectivityPingAttempts",
      "connectivityPauseWhileOffline",
      "connectivityNotificationsEnabled",
    ];
    if (connKeys.some((k) => (patch as Record<string, unknown>)[k as string] !== undefined)) {
      applyConnectivitySettings(next);
    }

    logEvent("info", "system", "Settings updated", {
      details: { changed: Object.keys(patch) },
    });

    void writeAudit({
      actorId: (req as any).user?.id,
      actorUsername: (req as any).user?.username,
      actorRole: (req as any).user?.role,
      action: "update_settings",
      resource: "settings",
      details: { changed: Object.keys(patch) },
      req: req as any,
    });

    res.json(next);
  } catch (err) {
    res.status(500).json({ error: "Failed to update settings" });
    void err;
  }
});

export default router;
