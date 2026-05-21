import { Router, type IRouter } from "express";
import {
  getMonitoringState,
  pauseMonitoring,
  resumeMonitoring,
  requestSweepCancel,
} from "../monitoring/monitor-state";
import { logEvent } from "../monitoring/logger";
import { runMonitoringSweep } from "../monitoring/engine";
import { logger } from "../lib/logger";
import {
  getConsoleEvents,
  type ConsoleEventType,
} from "../monitoring/console-events";
import {
  getQueueSnapshot,
  addManualSite,
  markChecking,
  markCompleted,
  markFailed,
  markQueueCompleted,
} from "../monitoring/queue-state";
import { runAndStoreCheck } from "../monitoring/engine";
import { db, sitesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const router: IRouter = Router();

router.get("/monitor/status", (_req, res) => {
  res.json(getMonitoringState());
});

router.get("/monitor/live-state", (_req, res) => {
  res.json(getMonitoringState());
});

// Live monitoring queue (sites waiting / being checked / done in the
// current sweep or manual run). Empty snapshot when the engine is idle.
router.get("/monitoring/queue", (_req, res) => {
  res.json(getQueueSnapshot());
});

// Manually add a single site to the queue
router.post("/monitoring/queue/sites", async (req, res) => {
  if (getMonitoringState().paused) {
    return res.status(409).json({
      error: "monitoring_paused",
      message: "Monitoring is paused. Cannot add sites to queue.",
    });
  }
  const { siteId } = req.body as { siteId?: unknown };
  if (typeof siteId !== "number" || !Number.isFinite(siteId)) {
    return res.status(400).json({ error: "invalid_site_id" });
  }
  const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, siteId)).limit(1);
  if (!site) return res.status(404).json({ error: "site_not_found" });
  if (!site.enabled) {
    return res.status(422).json({ error: "site_disabled", message: "Site is disabled." });
  }
  const result = addManualSite({ id: site.id, name: site.name, host: site.host, url: site.url });
  return res.json({ added: result.added, skipped: !result.added, reason: result.reason ?? null });
});

// Manually add multiple sites to the queue in bulk
router.post("/monitoring/queue/sites/bulk", async (req, res) => {
  if (getMonitoringState().paused) {
    return res.status(409).json({
      error: "monitoring_paused",
      message: "Monitoring is paused. Cannot add sites to queue.",
    });
  }
  const { siteIds } = req.body as { siteIds?: unknown };
  if (!Array.isArray(siteIds) || siteIds.length === 0) {
    return res.status(400).json({ error: "invalid_site_ids" });
  }
  const ids = siteIds.filter((id): id is number => typeof id === "number" && Number.isFinite(id));
  const sites = ids.length > 0 ? await db.select().from(sitesTable).where(inArray(sitesTable.id, ids)) : [];
  const results: { siteId: number; added: boolean; reason: string | null }[] = [];
  let addedCount = 0;
  let skippedCount = 0;
  for (const id of ids) {
    const site = sites.find((s) => s.id === id);
    if (!site) { results.push({ siteId: id, added: false, reason: "not_found" }); skippedCount++; continue; }
    if (!site.enabled) { results.push({ siteId: id, added: false, reason: "disabled" }); skippedCount++; continue; }
    const r = addManualSite({ id: site.id, name: site.name, host: site.host, url: site.url });
    results.push({ siteId: id, added: r.added, reason: r.reason ?? null });
    if (r.added) addedCount++; else skippedCount++;
  }
  return res.json({ addedCount, skippedCount, results });
});

// Run ONLY the sites that were manually added to the queue (source=manual, state=waiting).
// Does NOT trigger a full sweep — purely drains the manual entries.
router.post("/monitor/run-manual-queue", async (_req, res) => {
  if (getMonitoringState().paused) {
    return res.status(409).json({
      error: "monitoring_paused",
      message: "Monitoring is paused. Cannot run manual queue.",
    });
  }
  const snapshot = getQueueSnapshot();
  const manualWaiting = snapshot.items.filter(
    (it) => it.source === "manual" && it.state === "waiting",
  );
  if (manualWaiting.length === 0) {
    return res.json({ triggered: false, reason: "no_manual_items", count: 0 });
  }
  // Run each manual item sequentially without touching the sweep queue
  setImmediate(async () => {
    for (const item of manualWaiting) {
      if (getMonitoringState().paused) {
        markFailed(item.siteId, "Monitoring paused");
        continue;
      }
      try {
        markChecking(item.siteId);
        const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, item.siteId)).limit(1);
        if (!site) { markFailed(item.siteId, "Site not found"); continue; }
        await runAndStoreCheck(site);
        markCompleted(item.siteId);
      } catch (err) {
        markFailed(item.siteId, err instanceof Error ? err.message : String(err));
      }
    }
    markQueueCompleted();
  });
  return res.json({ triggered: true, count: manualWaiting.length });
});

router.post("/monitor/skip-sweep", (_req, res) => {
  const state = getMonitoringState();
  if (state.paused) {
    return res.status(409).json({ error: "monitoring_paused", message: "Monitoring is paused." });
  }
  const phase = state.currentPhase;
  const isActive = phase !== "idle" && phase !== "blocked";
  if (!isActive) {
    return res.status(409).json({ error: "no_sweep_running", message: "No sweep is currently running." });
  }
  requestSweepCancel();
  logEvent("warn", "system", "Sweep skipped by operator — cancellation requested");
  return res.json({ skipped: true });
});

router.post("/monitor/run-next-cycle", (_req, res) => {
  if (getMonitoringState().paused) {
    return res.status(409).json({
      error: "monitoring_paused",
      message: "Monitoring is paused. Cannot trigger a cycle.",
    });
  }
  setImmediate(() => {
    runMonitoringSweep().catch((err) =>
      logger.error({ err }, "Manual run-next-cycle sweep failed"),
    );
  });
  return res.json({ triggered: true });
});

router.post("/monitor/pause", (_req, res) => {
  pauseMonitoring();
  logEvent("warn", "system", "Monitoring paused by operator");
  res.json(getMonitoringState());
});

router.post("/monitor/resume", (_req, res) => {
  resumeMonitoring();
  logEvent("info", "system", "Monitoring resumed by operator");
  res.json(getMonitoringState());
  setImmediate(() => {
    runMonitoringSweep().catch((err) =>
      logger.error({ err }, "Immediate post-resume sweep failed"),
    );
  });
});

const ALLOWED_TYPES: ConsoleEventType[] = [
  "cycle",
  "site",
  "dns",
  "http",
  "ssl",
  "tcp",
  "incident",
  "alert",
  "system",
];

router.get("/monitor/console-events", (req, res) => {
  const sinceRaw = req.query["since"];
  const limitRaw = req.query["limit"];
  const typesRaw = req.query["types"];

  let since: number | undefined;
  if (typeof sinceRaw === "string" && sinceRaw.length > 0) {
    const n = Number(sinceRaw);
    if (Number.isFinite(n) && n >= 0) since = Math.floor(n);
  }
  let limit: number | undefined;
  if (typeof limitRaw === "string" && limitRaw.length > 0) {
    const n = Number(limitRaw);
    if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
  }
  let types: ConsoleEventType[] | undefined;
  if (typeof typesRaw === "string" && typesRaw.length > 0) {
    types = typesRaw
      .split(",")
      .map((t) => t.trim())
      .filter((t): t is ConsoleEventType => (ALLOWED_TYPES as string[]).includes(t));
    if (types.length === 0) types = undefined;
  }

  const result = getConsoleEvents({ since, limit, types });
  res.json(result);
});

export default router;
