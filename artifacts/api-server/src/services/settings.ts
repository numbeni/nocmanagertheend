/**
 * App-wide runtime settings.
 *
 * Storage: `app_settings` (key/value table). Rows override env defaults.
 * Cache : in-memory; refreshed on every PUT and on scheduler restarts.
 */

import { db, appSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";

export type AlertLanguage = "fa" | "en";
export type ThemeMode = "dark" | "light";
export type DashboardView = "list" | "grid";
export type DateFormat = "iso" | "relative" | "local";
export type AlertSeverity = "info" | "warning" | "critical";
export type AlertType =
  | "site_down"
  | "site_recovered"
  | "ssl_expiring"
  | "dns_failure"
  | "http_5xx"
  | "tcp_unreachable"
  | "incident_critical"
  | "incident_resolved";

const ALL_ALERT_TYPES: AlertType[] = [
  "site_down",
  "site_recovered",
  "ssl_expiring",
  "dns_failure",
  "http_5xx",
  "tcp_unreachable",
  "incident_critical",
  "incident_resolved",
];

export interface AppSettings {
  // Alerts
  nextcloudAlertsEnabled: boolean;
  alertLanguage: AlertLanguage;
  suppressResolvedAlerts: boolean;
  alertCooldownSec: number;
  alertSeverities: AlertSeverity[];
  alertTypes: AlertType[];
  sslExpiryAlertDays: number;
  alertPersistentDown: boolean;

  // Monitoring
  monitorIntervalMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
  requestTimeoutMs: number;
  slowResponseMs: number;

  // Display
  themeMode: ThemeMode;
  autoRefreshSec: number;
  dateFormat: DateFormat;
  defaultDashboardView: DashboardView;

  // Network Connectivity
  connectivityAutoChecksEnabled: boolean;
  connectivityOfflineRetryMs: number;
  connectivityPingTimeoutMs: number;
  connectivityPingAttempts: number;
  connectivityPauseWhileOffline: boolean;
  connectivityOfflinePopupEnabled: boolean;
  connectivityNotificationsEnabled: boolean;
  connectivityCheckAfterSweep: boolean;
  connectivityEmergencyCheckEnabled: boolean;
  connectivityEmergencyDownThreshold: number;
}

export const MIN_MONITOR_INTERVAL_MS = 30_000;
export const DEFAULT_MONITOR_INTERVAL_MS = 120_000;

const KNOWN_KEYS = [
  "nextcloudAlertsEnabled",
  "alertLanguage",
  "monitorIntervalMs",
  "suppressResolvedAlerts",
  "alertCooldownSec",
  "alertSeverities",
  "alertTypes",
  "sslExpiryAlertDays",
  "alertPersistentDown",
  "failureThreshold",
  "recoveryThreshold",
  "requestTimeoutMs",
  "slowResponseMs",
  "themeMode",
  "autoRefreshSec",
  "dateFormat",
  "defaultDashboardView",
  "connectivityAutoChecksEnabled",
  "connectivityOfflineRetryMs",
  "connectivityPingTimeoutMs",
  "connectivityPingAttempts",
  "connectivityPauseWhileOffline",
  "connectivityOfflinePopupEnabled",
  "connectivityNotificationsEnabled",
  "connectivityCheckAfterSweep",
  "connectivityEmergencyCheckEnabled",
  "connectivityEmergencyDownThreshold",
] as const;
type SettingKey = (typeof KNOWN_KEYS)[number];

let cache: AppSettings | null = null;

function envMonitorIntervalMs(): number {
  const rawMs = process.env["MONITOR_INTERVAL_MS"];
  const rawSec = process.env["MONITOR_INTERVAL_SECONDS"];
  if (rawMs !== undefined) {
    const n = Number(rawMs);
    if (Number.isFinite(n) && n > 0) {
      return Math.max(MIN_MONITOR_INTERVAL_MS, n);
    }
  }
  if (rawSec !== undefined) {
    const n = Number(rawSec);
    if (Number.isFinite(n) && n > 0) {
      return Math.max(MIN_MONITOR_INTERVAL_MS, n * 1000);
    }
  }
  return DEFAULT_MONITOR_INTERVAL_MS;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

function parseLang(value: string | undefined, fallback: AlertLanguage): AlertLanguage {
  if (value === "en" || value === "fa") return value;
  return fallback;
}

function parseTheme(value: string | undefined, fallback: ThemeMode): ThemeMode {
  if (value === "dark" || value === "light") return value;
  return fallback;
}

function parseDateFormat(value: string | undefined, fallback: DateFormat): DateFormat {
  if (value === "iso" || value === "relative" || value === "local") return value;
  return fallback;
}

function parseDashboardView(value: string | undefined, fallback: DashboardView): DashboardView {
  if (value === "list" || value === "grid") return value;
  return fallback;
}

function parseInt(value: string | undefined, fallback: number, min?: number, max?: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  let out = Math.floor(n);
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return out;
}

function parseSeverities(value: string | undefined, fallback: AlertSeverity[]): AlertSeverity[] {
  if (value === undefined) return fallback;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return fallback;
    const allowed: AlertSeverity[] = ["info", "warning", "critical"];
    const out = parsed.filter((v): v is AlertSeverity => allowed.includes(v));
    return out.length > 0 ? out : fallback;
  } catch {
    return fallback;
  }
}

function parseAlertTypes(value: string | undefined, fallback: AlertType[]): AlertType[] {
  if (value === undefined) return fallback;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return fallback;
    const out = parsed.filter((v): v is AlertType => ALL_ALERT_TYPES.includes(v as AlertType));
    return out.length > 0 ? out : fallback;
  } catch {
    return fallback;
  }
}

function defaultsFromEnv(): AppSettings {
  return {
    nextcloudAlertsEnabled: true,
    alertLanguage: "fa",
    suppressResolvedAlerts: false,
    alertCooldownSec: 1800, // 30 min
    alertSeverities: ["warning", "critical"],
    alertTypes: [...ALL_ALERT_TYPES],
    sslExpiryAlertDays: 30,
    alertPersistentDown: false,

    monitorIntervalMs: envMonitorIntervalMs(),
    failureThreshold: 2,
    recoveryThreshold: 2,
    requestTimeoutMs: 15_000,
    slowResponseMs: 3_000,

    themeMode: "light",
    autoRefreshSec: 30,
    dateFormat: "relative",
    defaultDashboardView: "list",

    connectivityAutoChecksEnabled: true,
    connectivityOfflineRetryMs: 5_000,
    connectivityPingTimeoutMs: 3_000,
    connectivityPingAttempts: 1,
    connectivityPauseWhileOffline: true,
    connectivityOfflinePopupEnabled: true,
    connectivityNotificationsEnabled: false,
    connectivityCheckAfterSweep: true,
    connectivityEmergencyCheckEnabled: true,
    connectivityEmergencyDownThreshold: 3,
  };
}

async function loadFromDb(): Promise<AppSettings> {
  const defaults = defaultsFromEnv();
  try {
    const rows = await db
      .select()
      .from(appSettingsTable)
      .where(inArray(appSettingsTable.key, KNOWN_KEYS as unknown as string[]));
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const intervalRaw = map.get("monitorIntervalMs");
    const intervalParsed = intervalRaw !== undefined ? Number(intervalRaw) : NaN;
    const intervalFromDb =
      Number.isFinite(intervalParsed) && intervalParsed > 0
        ? Math.max(MIN_MONITOR_INTERVAL_MS, intervalParsed)
        : null;

    return {
      nextcloudAlertsEnabled: parseBool(map.get("nextcloudAlertsEnabled"), defaults.nextcloudAlertsEnabled),
      alertLanguage: parseLang(map.get("alertLanguage"), defaults.alertLanguage),
      suppressResolvedAlerts: parseBool(map.get("suppressResolvedAlerts"), defaults.suppressResolvedAlerts),
      alertCooldownSec: parseInt(map.get("alertCooldownSec"), defaults.alertCooldownSec, 30, 24 * 60 * 60),
      alertSeverities: parseSeverities(map.get("alertSeverities"), defaults.alertSeverities),
      alertTypes: parseAlertTypes(map.get("alertTypes"), defaults.alertTypes),
      sslExpiryAlertDays: parseInt(map.get("sslExpiryAlertDays"), defaults.sslExpiryAlertDays, 1, 90),
      alertPersistentDown: parseBool(map.get("alertPersistentDown"), defaults.alertPersistentDown),

      monitorIntervalMs: intervalFromDb ?? defaults.monitorIntervalMs,
      failureThreshold: parseInt(map.get("failureThreshold"), defaults.failureThreshold, 1, 10),
      recoveryThreshold: parseInt(map.get("recoveryThreshold"), defaults.recoveryThreshold, 1, 10),
      requestTimeoutMs: parseInt(map.get("requestTimeoutMs"), defaults.requestTimeoutMs, 2_000, 60_000),
      slowResponseMs: parseInt(map.get("slowResponseMs"), defaults.slowResponseMs, 200, 30_000),

      themeMode: parseTheme(map.get("themeMode"), defaults.themeMode),
      autoRefreshSec: parseInt(map.get("autoRefreshSec"), defaults.autoRefreshSec, 5, 600),
      dateFormat: parseDateFormat(map.get("dateFormat"), defaults.dateFormat),
      defaultDashboardView: parseDashboardView(map.get("defaultDashboardView"), defaults.defaultDashboardView),

      connectivityAutoChecksEnabled: parseBool(map.get("connectivityAutoChecksEnabled"), defaults.connectivityAutoChecksEnabled),
      connectivityOfflineRetryMs: parseInt(map.get("connectivityOfflineRetryMs"), defaults.connectivityOfflineRetryMs, 2_000, 60_000),
      connectivityPingTimeoutMs: parseInt(map.get("connectivityPingTimeoutMs"), defaults.connectivityPingTimeoutMs, 1_000, 10_000),
      connectivityPingAttempts: parseInt(map.get("connectivityPingAttempts"), defaults.connectivityPingAttempts, 1, 5),
      connectivityPauseWhileOffline: parseBool(map.get("connectivityPauseWhileOffline"), defaults.connectivityPauseWhileOffline),
      connectivityOfflinePopupEnabled: parseBool(map.get("connectivityOfflinePopupEnabled"), defaults.connectivityOfflinePopupEnabled),
      connectivityNotificationsEnabled: parseBool(map.get("connectivityNotificationsEnabled"), defaults.connectivityNotificationsEnabled),
      connectivityCheckAfterSweep: parseBool(map.get("connectivityCheckAfterSweep"), defaults.connectivityCheckAfterSweep),
      connectivityEmergencyCheckEnabled: parseBool(map.get("connectivityEmergencyCheckEnabled"), defaults.connectivityEmergencyCheckEnabled),
      connectivityEmergencyDownThreshold: parseInt(map.get("connectivityEmergencyDownThreshold"), defaults.connectivityEmergencyDownThreshold, 1, 20),
    };
  } catch (err) {
    logger.warn({ err }, "Failed to load app_settings, using env defaults");
    return defaults;
  }
}

export async function getSettings(force = false): Promise<AppSettings> {
  if (!cache || force) {
    cache = await loadFromDb();
  }
  return cache;
}

/** Synchronous accessor — falls back to env defaults until first load. */
export function getCachedSettings(): AppSettings {
  return cache ?? defaultsFromEnv();
}

export async function refreshSettingsCache(): Promise<AppSettings> {
  cache = await loadFromDb();
  return cache;
}

export type SettingsPatch = Partial<AppSettings>;

export async function updateSettings(patch: SettingsPatch): Promise<AppSettings> {
  const writes: { key: SettingKey; value: string }[] = [];

  const pushBool = (key: SettingKey, v: unknown) => {
    if (typeof v === "boolean") writes.push({ key, value: v ? "true" : "false" });
  };
  const pushStr = (key: SettingKey, v: unknown) => {
    if (typeof v === "string") writes.push({ key, value: v });
  };
  const pushIntClamped = (key: SettingKey, v: unknown, min: number, max?: number) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      let n = Math.floor(v);
      n = Math.max(min, n);
      if (max !== undefined) n = Math.min(max, n);
      writes.push({ key, value: String(n) });
    }
  };

  pushBool("nextcloudAlertsEnabled", patch.nextcloudAlertsEnabled);
  pushBool("suppressResolvedAlerts", patch.suppressResolvedAlerts);
  if (patch.alertLanguage === "fa" || patch.alertLanguage === "en") {
    pushStr("alertLanguage", patch.alertLanguage);
  }
  pushIntClamped("alertCooldownSec", patch.alertCooldownSec, 30, 24 * 60 * 60);
  if (Array.isArray(patch.alertSeverities)) {
    const allowed: AlertSeverity[] = ["info", "warning", "critical"];
    const filtered = patch.alertSeverities.filter((v) => allowed.includes(v as AlertSeverity));
    if (filtered.length > 0) writes.push({ key: "alertSeverities", value: JSON.stringify(filtered) });
  }
  if (Array.isArray(patch.alertTypes)) {
    const filtered = patch.alertTypes.filter((v) => ALL_ALERT_TYPES.includes(v as AlertType));
    writes.push({ key: "alertTypes", value: JSON.stringify(filtered) });
  }
  pushBool("alertPersistentDown", patch.alertPersistentDown);
  pushIntClamped("sslExpiryAlertDays", patch.sslExpiryAlertDays, 1, 90);

  pushIntClamped("monitorIntervalMs", patch.monitorIntervalMs, MIN_MONITOR_INTERVAL_MS);
  pushIntClamped("failureThreshold", patch.failureThreshold, 1, 10);
  pushIntClamped("recoveryThreshold", patch.recoveryThreshold, 1, 10);
  pushIntClamped("requestTimeoutMs", patch.requestTimeoutMs, 2_000, 60_000);
  pushIntClamped("slowResponseMs", patch.slowResponseMs, 200, 30_000);

  if (patch.themeMode === "dark" || patch.themeMode === "light") {
    pushStr("themeMode", patch.themeMode);
  }
  pushIntClamped("autoRefreshSec", patch.autoRefreshSec, 5, 600);
  if (patch.dateFormat === "iso" || patch.dateFormat === "relative" || patch.dateFormat === "local") {
    pushStr("dateFormat", patch.dateFormat);
  }
  if (patch.defaultDashboardView === "list" || patch.defaultDashboardView === "grid") {
    pushStr("defaultDashboardView", patch.defaultDashboardView);
  }

  pushBool("connectivityAutoChecksEnabled", patch.connectivityAutoChecksEnabled);
  pushBool("connectivityPauseWhileOffline", patch.connectivityPauseWhileOffline);
  pushBool("connectivityOfflinePopupEnabled", patch.connectivityOfflinePopupEnabled);
  pushBool("connectivityNotificationsEnabled", patch.connectivityNotificationsEnabled);
  pushBool("connectivityCheckAfterSweep", patch.connectivityCheckAfterSweep);
  pushBool("connectivityEmergencyCheckEnabled", patch.connectivityEmergencyCheckEnabled);
  pushIntClamped("connectivityOfflineRetryMs", patch.connectivityOfflineRetryMs, 2_000, 60_000);
  pushIntClamped("connectivityPingTimeoutMs", patch.connectivityPingTimeoutMs, 1_000, 10_000);
  pushIntClamped("connectivityPingAttempts", patch.connectivityPingAttempts, 1, 5);
  pushIntClamped("connectivityEmergencyDownThreshold", patch.connectivityEmergencyDownThreshold, 1, 20);

  for (const { key, value } of writes) {
    const existing = await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, key))
      .limit(1);
    if (existing.length > 0) {
      await db
        .update(appSettingsTable)
        .set({ value, updatedAt: new Date() })
        .where(eq(appSettingsTable.key, key));
    } else {
      await db.insert(appSettingsTable).values({ key, value });
    }
  }

  return refreshSettingsCache();
}
