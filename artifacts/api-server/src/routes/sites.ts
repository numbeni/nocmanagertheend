import { Router, type IRouter } from "express";
import {
  db,
  sitesTable,
  serversTable,
  checksTable,
  incidentsTable,
  sslTargetsTable,
  type Check,
  type Site,
} from "@workspace/db";
import { and, asc, desc, eq, gte, ilike, inArray, sql } from "drizzle-orm";
import { CreateSiteBody, UpdateSiteBody } from "@workspace/api-zod";
import { deriveHost, runAndStoreCheck } from "../monitoring/engine";
import { getOpenIncidentForSite } from "../monitoring/incidents";
import { logEvent } from "../monitoring/logger";
import { getAdvancedDnsReport } from "../monitoring/dns-advanced";
import { runHttpDiagnostic } from "../monitoring/http-diagnostic";
import { runProductCheck, type ProductCheckResult } from "../monitoring/product-check";
import { runCurlCheck, type CurlCheckResult } from "../monitoring/curl-check";
import { runStaggered } from "../monitoring/check-queue";
import { checkSsl } from "../monitoring/ssl";
import { isMonitoringPaused, isSweepCancelRequested } from "../monitoring/monitor-state";
import {
  setQueue,
  markChecking,
  markCompleted,
  markFailed,
  markSkipped,
  clearQueue,
} from "../monitoring/queue-state";
import { auditFromRequest } from "../services/audit";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

// "Down" once we've seen this many consecutive failures on a site that has
// previously been reachable. Below this threshold, we report the milder
// "not_stable" state.
const NOT_STABLE_FAIL_LIMIT = 2;

function normalizeUrl(input: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(normalizeUrl(value));
    return !!u.hostname && u.hostname.includes(".");
  } catch {
    return false;
  }
}

type RawStatus = "up" | "slow" | "down" | "degraded" | "blocked" | "unknown";
type DisplayStatus = RawStatus | "not_stable";

/**
 * Final status logic per the product spec:
 *  • A site that has NEVER been successfully reached → `down` on failure.
 *  • A site that WAS reachable but is failing intermittently:
 *      1–2 consecutive failures → `not_stable`
 *      3+                       → `down`
 *  • Successful checks reset the streak (handled in monitoring engine).
 *  • `blocked` and `slow` and `up` pass through unchanged.
 */
function deriveDisplayStatus(
  raw: RawStatus,
  consecutiveFailures: number,
  hasEverBeenUp: boolean,
): DisplayStatus {
  // Only "down" can escalate to not_stable / down. "degraded" passes through
  // (site is reachable but has a quality issue such as SSL expiring soon).
  if (raw !== "down") return raw;
  if (!hasEverBeenUp) return "down";
  if (consecutiveFailures <= NOT_STABLE_FAIL_LIMIT) return "not_stable";
  return "down";
}

function siteStatusFromLatest(latest: Check | undefined) {
  if (!latest) {
    return {
      overallStatus: "unknown" as const,
      httpStatus: null,
      responseTimeMs: null,
      dnsStatus: null,
      dnsResolveMs: null,
      resolvedIp: null,
      resolverUsed: null,
      sslStatus: null,
      sslDaysRemaining: null,
      lastCheckedAt: null,
      blockedReason: null,
      errorType: null,
      errorMessage: null,
      consecutiveFailures: 0,
    };
  }
  return {
    overallStatus: latest.overallStatus as RawStatus,
    httpStatus: latest.httpStatus,
    responseTimeMs: latest.responseTimeMs,
    dnsStatus: latest.dnsStatus,
    dnsResolveMs: latest.dnsResolveMs,
    resolvedIp: latest.resolvedIp,
    resolverUsed: latest.resolverUsed,
    sslStatus: latest.sslStatus,
    sslDaysRemaining: latest.sslDaysRemaining,
    lastCheckedAt: latest.timestamp.toISOString(),
    blockedReason: latest.blockedReason,
    errorType: latest.errorType,
    errorMessage: latest.errorMessage,
    consecutiveFailures: 0,
  };
}

async function buildSiteStatus(site: Site, serverMap?: Map<number, { id: number; code: string; name: string; color: string }>) {
  const latestRows = await db
    .select()
    .from(checksTable)
    .where(eq(checksTable.siteId, site.id))
    .orderBy(desc(checksTable.timestamp))
    .limit(20);
  const latest = latestRows[0];

  // Consecutive failures from the most recent run backwards. Only "down"
  // counts — "degraded" / "slow" mean the site IS reachable.
  let consecutiveFailures = 0;
  for (const c of latestRows) {
    if (c.overallStatus === "down") {
      consecutiveFailures++;
    } else {
      break;
    }
  }

  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const uptimeRows = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      up: sql<number>`COUNT(*) FILTER (WHERE ${checksTable.overallStatus} IN ('up', 'slow'))::int`,
    })
    .from(checksTable)
    .where(and(eq(checksTable.siteId, site.id), gte(checksTable.timestamp, since)));
  const u = uptimeRows[0];
  const uptime24h = u && u.total > 0 ? (u.up / u.total) * 100 : 100;

  const openIncident = await getOpenIncidentForSite(site.id);
  const base = siteStatusFromLatest(latest);

  // If the latest check has no SSL data (common during server-based sweeps),
  // fall back to the ssl_targets table which is updated by the SSL batch scanner.
  let sslStatus = base.sslStatus;
  let sslDaysRemaining = base.sslDaysRemaining;
  if (sslStatus === null) {
    const [sslRow] = await db
      .select({
        sslStatus: sslTargetsTable.lastStatus,
        sslDaysRemaining: sslTargetsTable.lastDaysRemaining,
      })
      .from(sslTargetsTable)
      .where(eq(sslTargetsTable.siteId, site.id))
      .limit(1);
    if (sslRow) {
      sslStatus = sslRow.sslStatus;
      sslDaysRemaining = sslRow.sslDaysRemaining;
    }
  }

  const displayStatus = deriveDisplayStatus(
    base.overallStatus,
    consecutiveFailures,
    site.hasEverBeenUp,
  );

  return {
    id: site.id,
    name: site.name,
    url: site.url,
    host: site.host,
    enabled: site.enabled,
    region: site.region,
    hasEverBeenUp: site.hasEverBeenUp,
    lastSuccessAt: site.lastSuccessAt
      ? site.lastSuccessAt.toISOString()
      : null,
    monitoringPaused: site.monitoringPaused,
    monitoringPausedAt: site.monitoringPausedAt ? site.monitoringPausedAt.toISOString() : null,
    monitoringPausedBy: site.monitoringPausedBy ?? null,
    currentlyFine: site.currentlyFine,
    currentlyFineAt: site.currentlyFineAt ? site.currentlyFineAt.toISOString() : null,
    currentlyFineBy: site.currentlyFineBy ?? null,
    ...base,
    sslStatus,
    sslDaysRemaining,
    overallStatus: displayStatus,
    consecutiveFailures,
    uptime24h: Math.round(uptime24h * 100) / 100,
    openIncidentId: openIncident?.id ?? null,
    serverId: site.serverId ?? null,
    serverCode: serverMap?.get(site.serverId ?? -1)?.code ?? null,
    serverName: serverMap?.get(site.serverId ?? -1)?.name ?? null,
    serverColor: serverMap?.get(site.serverId ?? -1)?.color ?? null,
  };
}

router.get("/sites", async (_req, res) => {
  const [sites, servers] = await Promise.all([
    db.select().from(sitesTable).orderBy(sitesTable.id),
    db.select({ id: serversTable.id, code: serversTable.code, name: serversTable.name, color: serversTable.color }).from(serversTable),
  ]);
  const serverMap = new Map(servers.map((s) => [s.id, s]));
  const result = await Promise.all(sites.map((s) => buildSiteStatus(s, serverMap)));
  res.json(result);
});

router.post("/sites", async (req, res) => {
  const parsed = CreateSiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const normalizedUrl = normalizeUrl(parsed.data.url);
  if (!isValidUrl(normalizedUrl)) {
    res.status(400).json({ error: "Invalid URL", details: parsed.data.url });
    return;
  }
  const host = deriveHost(normalizedUrl);
  const existing = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.url, normalizedUrl))
    .limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "Site with this URL already exists" });
    return;
  }
  const serverId =
    typeof (req.body as { serverId?: unknown })?.serverId === "number"
      ? ((req.body as { serverId: number }).serverId)
      : null;
  const [row] = await db
    .insert(sitesTable)
    .values({
      name: parsed.data.name,
      url: normalizedUrl,
      host,
      enabled: true,
      region: parsed.data.region ?? null,
      serverId,
    })
    .returning();
  if (!row) {
    res.status(500).json({ error: "Failed to create site" });
    return;
  }
  // No auto-check on add — site will be picked up during the next scheduled sweep.
  void auditFromRequest(req, {
    action: "create_site",
    resource: "site",
    resourceId: String(row.id),
    entityName: row.name,
    siteId: row.id,
    details: { name: row.name, url: row.url },
  });
  res.status(201).json({
    id: row.id,
    name: row.name,
    url: row.url,
    host: row.host,
    enabled: row.enabled,
    region: row.region,
    createdAt: row.createdAt.toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Bulk add: textarea or .txt file. Each line is one site.
// Supported formats per line:
//   google.com
//   https://openai.com
//   Google | google.com
//   MySite, mysite.com
// ---------------------------------------------------------------------------
interface ParsedEntry {
  rawLine: string;
  lineNumber: number;
  name: string;
  url: string;
}

function parseBulkLine(raw: string, lineNumber: number): ParsedEntry | null {
  const line = raw.trim();
  if (!line || line.startsWith("#")) return null;

  let name: string | null = null;
  let urlPart: string;

  if (line.includes("|")) {
    const idx = line.indexOf("|");
    name = line.slice(0, idx).trim();
    urlPart = line.slice(idx + 1).trim();
  } else if (line.includes(",")) {
    const idx = line.indexOf(",");
    name = line.slice(0, idx).trim();
    urlPart = line.slice(idx + 1).trim();
  } else {
    urlPart = line;
  }

  if (!urlPart) return null;
  const url = normalizeUrl(urlPart);
  if (!name) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./i, "");
      const parts = hostname.split(".");
      if (parts.length >= 2) {
        const slug = parts[parts.length - 2];
        name = slug.charAt(0).toUpperCase() + slug.slice(1);
      } else {
        name = hostname;
      }
    } catch {
      name = urlPart;
    }
  }
  return { rawLine: raw, lineNumber, name, url };
}

router.post("/sites/bulk", async (req, res) => {
  const text: unknown = req.body?.text;
  if (typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "Field 'text' is required" });
    return;
  }

  // Optional server assignment for all bulk-imported sites
  const rawServerId: unknown = req.body?.serverId;
  let bulkServerId: number | null = null;
  if (typeof rawServerId === "number" && rawServerId > 0) {
    const serverExists = await db
      .select({ id: serversTable.id })
      .from(serversTable)
      .where(eq(serversTable.id, rawServerId))
      .limit(1);
    if (serverExists.length > 0) bulkServerId = rawServerId;
  }

  const lines = text.split(/\r?\n/);
  const parsed: ParsedEntry[] = [];
  const invalid: { line: number; value: string; reason: string }[] = [];
  const seenUrls = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i] ?? "";
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const entry = parseBulkLine(raw, lineNo);
    if (!entry) {
      invalid.push({ line: lineNo, value: raw, reason: "could not parse" });
      continue;
    }
    if (!isValidUrl(entry.url)) {
      invalid.push({ line: lineNo, value: raw, reason: "invalid URL" });
      continue;
    }
    if (seenUrls.has(entry.url)) {
      invalid.push({ line: lineNo, value: raw, reason: "duplicate in input" });
      continue;
    }
    seenUrls.add(entry.url);
    parsed.push(entry);
  }

  // Detect duplicates against the database in one query
  const existingRows =
    parsed.length > 0
      ? await db
          .select({ url: sitesTable.url })
          .from(sitesTable)
      : [];
  const existingUrls = new Set(existingRows.map((r) => r.url));

  const added: Array<{ id: number; name: string; url: string; host: string }> = [];
  const insertedSites: Site[] = [];
  const duplicates: { line: number; value: string; reason: string }[] = [];

  for (const entry of parsed) {
    if (existingUrls.has(entry.url)) {
      duplicates.push({
        line: entry.lineNumber,
        value: entry.rawLine,
        reason: "already exists",
      });
      continue;
    }
    try {
      const host = deriveHost(entry.url);
      const [row] = await db
        .insert(sitesTable)
        .values({
          name: entry.name,
          url: entry.url,
          host,
          enabled: true,
          serverId: bulkServerId,
        })
        .returning();
      if (row) {
        added.push({ id: row.id, name: row.name, url: row.url, host: row.host });
        insertedSites.push(row);
        existingUrls.add(row.url);
      }
    } catch (err) {
      invalid.push({
        line: entry.lineNumber,
        value: entry.rawLine,
        reason: err instanceof Error ? err.message : "insert failed",
      });
    }
  }

  const monitoringPaused = isMonitoringPaused();

  if (added.length > 0) {
    logEvent(
      "info",
      "system",
      `Bulk import: ${added.length} site(s) added (${duplicates.length} duplicates, ${invalid.length} invalid). Sites will be checked in the next scheduled sweep.`,
      { details: { added: added.map((a) => a.url) } },
    );
  }

  res.json({
    totalProcessed: parsed.length + invalid.length,
    addedCount: added.length,
    duplicateCount: duplicates.length,
    invalidCount: invalid.length,
    added,
    duplicates,
    invalid,
    monitoringPaused,
  });
});

// ---------------------------------------------------------------------------
// Bulk delete and Run-Check-All — placed BEFORE /sites/:id routes so the
// literal paths win against the parameterized ones.
// ---------------------------------------------------------------------------
router.post("/sites/bulk-delete", async (req, res) => {
  const raw = req.body?.ids;
  if (!Array.isArray(raw) || raw.length === 0) {
    res.status(400).json({ error: "Field 'ids' must be a non-empty array of numbers" });
    return;
  }
  const ids = Array.from(
    new Set(raw.map((v) => Number(v)).filter((n) => Number.isFinite(n))),
  );
  if (ids.length === 0) {
    res.status(400).json({ error: "No valid ids supplied" });
    return;
  }
  try {
    const result = await db
      .delete(sitesTable)
      .where(inArray(sitesTable.id, ids))
      .returning({ id: sitesTable.id });
    const deletedIds = result.map((r) => r.id);
    logEvent(
      "info",
      "system",
      `Bulk delete: ${deletedIds.length} site(s) removed`,
      { details: { ids: deletedIds } },
    );
    void auditFromRequest(req, {
      action: "bulk_delete_sites",
      resource: "site",
      details: { deletedIds, count: deletedIds.length },
    });
    res.json({
      requested: ids.length,
      deleted: deletedIds.length,
      deletedIds,
    });
  } catch (err) {
    req.log.error({ err }, "Bulk delete failed");
    res.status(500).json({ error: "Bulk delete failed" });
  }
});

router.post("/sites/run-check-all", async (req, res) => {
  // Refuse the on-demand sweep when monitoring is paused. The operator
  // explicitly stopped the engine — the manual button must respect that.
  if (isMonitoringPaused()) {
    res.status(409).json({
      error: "monitoring_stopped",
      message:
        "Monitoring is currently paused. Resume monitoring before running an on-demand check.",
    });
    return;
  }

  const sites = await db
    .select()
    .from(sitesTable)
    .where(and(eq(sitesTable.enabled, true), eq(sitesTable.monitoringPaused, false)));
  if (sites.length === 0) {
    res.json({ queued: true, siteCount: 0, message: "No enabled sites to check" });
    return;
  }

  // Publish the queue snapshot so the UI can render the manual run.
  setQueue(
    "run-check-all",
    sites.map((s) => ({ id: s.id, name: s.name, host: s.host, url: s.url })),
  );

  // Fire-and-forget staggered run. Each worker checks pause state before
  // starting a site — so Pause mid-run stops within one site boundary.
  runStaggered(
    sites,
    async (site) => {
      if (isMonitoringPaused() || isSweepCancelRequested()) {
        markSkipped(site.id);
        return;
      }
      try {
        markChecking(site.id);
        await runAndStoreCheck(site);
        markCompleted(site.id);
      } catch (err) {
        markFailed(site.id, err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    // Manual checks are higher priority — use more workers and minimal inter-check delay
    // so the operator sees results quickly rather than waiting on the sweep schedule.
    { concurrency: 4, minDelayMs: 0, maxDelayMs: 300, label: "run-check-all" },
  )
    .catch((err) => req.log.error({ err }, "Run-check-all queue crashed"))
    .finally(() => {
      // Clear the queue after the manual sweep finishes so the next sweep
      // starts with a clean slate.
      clearQueue();
    });

  logEvent(
    "info",
    "system",
    `Manual check queued for ${sites.length} site(s) via Run-Check-All`,
  );
  res.json({
    queued: true,
    siteCount: sites.length,
    message: `Manual check queued for ${sites.length} sites`,
  });
});

router.get("/sites/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const rows = await db.select().from(sitesTable).where(eq(sitesTable.id, id)).limit(1);
  const site = rows[0];
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  const status = await buildSiteStatus(site);
  res.json(status);
});

// PATCH /api/sites/bulk-assign-server — must be BEFORE /sites/:id to prevent
// the parameterized route from catching "bulk-assign-server" as an id.
router.patch("/sites/bulk-assign-server", requireAuth, requireRole("operator"), async (req, res) => {
  try {
    const { siteIds, serverId } = req.body as { siteIds?: number[]; serverId?: number | null };
    if (!Array.isArray(siteIds) || siteIds.length === 0) {
      return res.status(400).json({ error: "siteIds required" });
    }
    if (serverId !== null && serverId !== undefined) {
      const [server] = await db.select().from(serversTable).where(eq(serversTable.id, serverId)).limit(1);
      if (!server) return res.status(404).json({ error: "server_not_found" });
    }
    await db
      .update(sitesTable)
      .set({ serverId: serverId ?? null })
      .where(inArray(sitesTable.id, siteIds));
    return res.json({ ok: true, updated: siteIds.length });
  } catch {
    return res.status(500).json({ error: "Failed to bulk assign server" });
  }
});

router.patch("/sites/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateSiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const updates: Partial<typeof sitesTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled;
  if (parsed.data.region !== undefined) updates.region = parsed.data.region;
  if (parsed.data.productCheckEnabled !== undefined)
    updates.productCheckEnabled = parsed.data.productCheckEnabled;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No updatable fields supplied" });
    return;
  }
  const [row] = await db
    .update(sitesTable)
    .set(updates)
    .where(eq(sitesTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  void auditFromRequest(req, {
    action: "update_site",
    resource: "site",
    resourceId: String(id),
    entityName: row.name,
    siteId: id,
    details: parsed.data,
  });
  const status = await buildSiteStatus(row);
  res.json(status);
});

// Clear check history for a single site
router.delete("/sites/:id/checks", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    // Clearing a site's check history is a "fresh start" action — incidents
    // are anchored to those checks, so we drop them too. Notes cascade via
    // the FK on incident_notes.incident_id.
    const incidentsDeleted = await db
      .delete(incidentsTable)
      .where(eq(incidentsTable.siteId, id))
      .returning({ id: incidentsTable.id });
    const result = await db
      .delete(checksTable)
      .where(eq(checksTable.siteId, id))
      .returning({ id: checksTable.id });
    logEvent(
      "info",
      "system",
      `Check history cleared for site ${id}: ${result.length} check(s) and ${incidentsDeleted.length} incident(s) removed`,
      {
        details: {
          siteId: id,
          checkCount: result.length,
          incidentCount: incidentsDeleted.length,
        },
      },
    );
    res.json({
      deleted: result.length,
      incidentsDeleted: incidentsDeleted.length,
      siteId: id,
    });
  } catch (err) {
    req.log.error({ err }, "Clear checks failed");
    res.status(500).json({ error: "Failed to clear check history" });
  }
});

// Bulk clear check history for multiple sites
router.post("/sites/bulk-clear-checks", async (req, res) => {
  const raw = req.body?.ids;
  if (!Array.isArray(raw) || raw.length === 0) {
    res.status(400).json({ error: "Field 'ids' must be a non-empty array of numbers" });
    return;
  }
  const ids = Array.from(
    new Set(raw.map((v) => Number(v)).filter((n) => Number.isFinite(n))),
  );
  if (ids.length === 0) {
    res.status(400).json({ error: "No valid ids supplied" });
    return;
  }
  try {
    // Same rationale as single-site clear: incidents are anchored to checks,
    // so wiping check history must also wipe incidents (notes cascade).
    const incidentsDeleted = await db
      .delete(incidentsTable)
      .where(inArray(incidentsTable.siteId, ids))
      .returning({ id: incidentsTable.id });
    const result = await db
      .delete(checksTable)
      .where(inArray(checksTable.siteId, ids))
      .returning({ id: checksTable.id });
    logEvent(
      "info",
      "system",
      `Bulk check history clear: ${result.length} check(s) and ${incidentsDeleted.length} incident(s) removed for ${ids.length} site(s)`,
      {
        details: {
          siteIds: ids,
          checkCount: result.length,
          incidentCount: incidentsDeleted.length,
        },
      },
    );
    res.json({
      deleted: result.length,
      incidentsDeleted: incidentsDeleted.length,
      siteIds: ids,
    });
  } catch (err) {
    req.log.error({ err }, "Bulk clear checks failed");
    res.status(500).json({ error: "Failed to bulk clear check history" });
  }
});

router.delete("/sites/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const deleted = await db
    .delete(sitesTable)
    .where(eq(sitesTable.id, id))
    .returning({ id: sitesTable.id, name: sitesTable.name });
  if (deleted.length > 0) {
    logEvent(
      "info",
      "system",
      `Site deleted: ${deleted[0]!.name} (id ${deleted[0]!.id})`,
    );
    void auditFromRequest(req, {
      action: "delete_site",
      resource: "site",
      resourceId: String(deleted[0]!.id),
      details: { name: deleted[0]!.name },
    });
  }
  res.status(204).send();
});

router.get("/sites/:id/checks", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const limit = Math.min(Number(req.query["limit"] ?? 100), 1000);
  const rows = await db
    .select()
    .from(checksTable)
    .where(eq(checksTable.siteId, id))
    .orderBy(desc(checksTable.timestamp))
    .limit(limit);
  res.json(
    rows.map((r) => ({
      id: r.id,
      siteId: r.siteId,
      timestamp: r.timestamp.toISOString(),
      overallStatus: r.overallStatus,
      httpStatus: r.httpStatus,
      responseTimeMs: r.responseTimeMs,
      dnsStatus: r.dnsStatus,
      dnsResolveMs: r.dnsResolveMs,
      resolvedIp: r.resolvedIp,
      resolverUsed: r.resolverUsed,
      tcp80Open: r.tcp80Open,
      tcp443Open: r.tcp443Open,
      sslStatus: r.sslStatus,
      sslDaysRemaining: r.sslDaysRemaining,
      sslIssuer: r.sslIssuer,
      errorType: r.errorType,
      errorMessage: r.errorMessage,
      blockedReason: r.blockedReason,
    })),
  );
});

router.get("/sites/:id/uptime", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const hours = Math.min(Math.max(Number(req.query["hours"] ?? 24), 1), 720);
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const rows = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      up: sql<number>`COUNT(*) FILTER (WHERE ${checksTable.overallStatus} = 'up')::int`,
      down: sql<number>`COUNT(*) FILTER (WHERE ${checksTable.overallStatus} = 'down')::int`,
      slow: sql<number>`COUNT(*) FILTER (WHERE ${checksTable.overallStatus} = 'slow')::int`,
      avgMs: sql<number | null>`AVG(${checksTable.responseTimeMs})`,
      p95Ms: sql<number | null>`PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${checksTable.responseTimeMs})`,
    })
    .from(checksTable)
    .where(and(eq(checksTable.siteId, id), gte(checksTable.timestamp, since)));
  const r = rows[0]!;
  const total = r.total ?? 0;
  const up = r.up ?? 0;
  const slow = r.slow ?? 0;
  res.json({
    siteId: id,
    hours,
    uptimePercent:
      total > 0 ? Math.round(((up + slow) / total) * 10000) / 100 : 100,
    totalChecks: total,
    upChecks: up,
    downChecks: r.down ?? 0,
    slowChecks: slow,
    avgResponseTimeMs: r.avgMs !== null ? Math.round(Number(r.avgMs)) : null,
    p95ResponseTimeMs: r.p95Ms !== null ? Math.round(Number(r.p95Ms)) : null,
  });
});

router.get("/sites/:id/diagnostics", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const rows = await db.select().from(sitesTable).where(eq(sitesTable.id, id)).limit(1);
  const site = rows[0];
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  const useHttps = site.url.startsWith("https://");
  const [dnsAdv, httpDiag, ssl] = await Promise.all([
    getAdvancedDnsReport(site.host),
    runHttpDiagnostic(site.url),
    useHttps
      ? checkSsl(site.host, 443)
      : Promise.resolve({
          status: "unknown" as const,
          daysRemaining: null,
          issuer: null,
          error: null,
        }),
  ]);

  let productCheck: ProductCheckResult | null = null;
  if (site.productCheckEnabled) {
    if (site.productCheckResult) {
      try {
        productCheck = JSON.parse(site.productCheckResult);
      } catch {
        productCheck = null;
      }
    }
  } else {
    productCheck = {
      enabled: false,
      url: site.url,
      status: "skipped",
      productPagesFound: false,
      source: "none",
      checkedUrls: [],
      workingUrls: [],
      message: "Product check is disabled for this site.",
      responseTimeMs: 0,
      errorMessage: null,
      generatedAt: new Date().toISOString(),
    };
  }

  let latestCurlDiagnostic: CurlCheckResult | null = null;
  if (site.latestCurlDiagnostic) {
    try {
      latestCurlDiagnostic = JSON.parse(site.latestCurlDiagnostic);
    } catch {
      latestCurlDiagnostic = null;
    }
  }

  res.json({
    siteId: site.id,
    host: site.host,
    url: site.url,
    generatedAt: new Date().toISOString(),
    dns: dnsAdv,
    http: httpDiag,
    ssl: {
      status: ssl.status,
      daysRemaining: ssl.daysRemaining,
      issuer: ssl.issuer,
      error: ssl.error,
    },
    productCheck,
    productCheckEnabled: site.productCheckEnabled,
    productCheckRanAt: site.productCheckRanAt
      ? site.productCheckRanAt.toISOString()
      : null,
    latestCurlDiagnostic,
    latestCurlDiagnosticAt: site.latestCurlDiagnosticAt
      ? site.latestCurlDiagnosticAt.toISOString()
      : null,
  });
});

router.post("/sites/:id/run-product-check", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const rows = await db.select().from(sitesTable).where(eq(sitesTable.id, id)).limit(1);
  const site = rows[0];
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  if (!site.productCheckEnabled) {
    res.status(400).json({
      error:
        "Product check is disabled for this site. Enable it via PATCH /sites/:id first.",
    });
    return;
  }
  const result = await runProductCheck(site.url);
  await db
    .update(sitesTable)
    .set({
      productCheckResult: JSON.stringify(result),
      productCheckRanAt: new Date(),
    })
    .where(eq(sitesTable.id, site.id));
  logEvent(
    result.status === "ok" ? "info" : "warn",
    "monitor",
    `Product check for ${site.name}: ${result.status} — ${result.workingUrls.length}/${result.checkedUrls.length} working (source: ${result.source})`,
    { siteId: site.id, details: result },
  );
  res.json(result);
});

router.post("/sites/:id/run-curl-check", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const rows = await db.select().from(sitesTable).where(eq(sitesTable.id, id)).limit(1);
  const site = rows[0];
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  const result = await runCurlCheck(site.url);
  // Persist as JSON snapshot — this is purely diagnostic and never affects
  // the site's overall status.
  await db
    .update(sitesTable)
    .set({
      latestCurlDiagnostic: JSON.stringify(result),
      latestCurlDiagnosticAt: new Date(),
    })
    .where(eq(sitesTable.id, site.id));
  logEvent(
    "info",
    "monitor",
    `Curl check for ${site.name}: ${result.statusCode ?? "—"} ${result.statusGroup} (${result.responseTimeMs}ms, ${result.redirectCount} redirects)`,
    { siteId: site.id, details: result },
  );
  res.json(result);
});

router.post("/sites/:id/run-check", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const rows = await db.select().from(sitesTable).where(eq(sitesTable.id, id)).limit(1);
  const site = rows[0];
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  const check = await runAndStoreCheck(site);
  res.json({
    id: check.id,
    siteId: check.siteId,
    timestamp: check.timestamp.toISOString(),
    overallStatus: check.overallStatus,
    httpStatus: check.httpStatus,
    responseTimeMs: check.responseTimeMs,
    dnsStatus: check.dnsStatus,
    dnsResolveMs: check.dnsResolveMs,
    resolvedIp: check.resolvedIp,
    resolverUsed: check.resolverUsed,
    tcp80Open: check.tcp80Open,
    tcp443Open: check.tcp443Open,
    sslStatus: check.sslStatus,
    sslDaysRemaining: check.sslDaysRemaining,
    sslIssuer: check.sslIssuer,
    errorType: check.errorType,
    errorMessage: check.errorMessage,
    blockedReason: check.blockedReason,
  });
});

// ---------------------------------------------------------------------------
// Per-site pause / resume monitoring
// PATCH /sites/:id/pause   — pause monitoring for a single site
// PATCH /sites/:id/resume  — resume monitoring for a single site
// ---------------------------------------------------------------------------

router.patch("/sites/:id/pause", requireAuth, async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  // Only founder/admin/operator can pause
  const role = req.user?.role;
  if (role !== "founder" && role !== "admin" && role !== "operator") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const rows = await db.select().from(sitesTable).where(eq(sitesTable.id, id)).limit(1);
  const site = rows[0];
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  if (site.monitoringPaused) {
    res.status(400).json({ error: "Site monitoring is already paused" });
    return;
  }
  const [updated] = await db.update(sitesTable).set({
    monitoringPaused: true,
    monitoringPausedAt: new Date(),
    monitoringPausedBy: req.user?.username ?? null,
  }).where(eq(sitesTable.id, id)).returning();
  if (!updated) {
    res.status(500).json({ error: "Failed to pause site" });
    return;
  }
  logEvent("info", "monitor", `Site monitoring paused: ${site.name} by ${req.user?.username}`);
  void auditFromRequest(req, {
    action: "pause_site",
    resource: "site",
    resourceId: String(id),
    entityName: site.name,
    siteId: id,
    details: { siteName: site.name, siteUrl: site.url },
  });
  res.json({ success: true, siteId: id, monitoringPaused: true });
});

router.patch("/sites/:id/resume", requireAuth, async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const role = req.user?.role;
  if (role !== "founder" && role !== "admin" && role !== "operator") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const rows = await db.select().from(sitesTable).where(eq(sitesTable.id, id)).limit(1);
  const site = rows[0];
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  if (!site.monitoringPaused) {
    res.status(400).json({ error: "Site monitoring is not paused" });
    return;
  }
  const [updated] = await db.update(sitesTable).set({
    monitoringPaused: false,
    monitoringPausedAt: null,
    monitoringPausedBy: null,
  }).where(eq(sitesTable.id, id)).returning();
  if (!updated) {
    res.status(500).json({ error: "Failed to resume site" });
    return;
  }
  logEvent("info", "monitor", `Site monitoring resumed: ${site.name} by ${req.user?.username}`);
  void auditFromRequest(req, {
    action: "resume_site",
    resource: "site",
    resourceId: String(id),
    entityName: site.name,
    siteId: id,
    details: { siteName: site.name, siteUrl: site.url },
  });
  res.json({ success: true, siteId: id, monitoringPaused: false });
});

// PATCH /sites/:id/currently-fine   — mark site as "currently fine" (temp ignore mode)
// PATCH /sites/:id/unset-currently-fine — clear the currently-fine flag
router.patch("/sites/:id/currently-fine", requireAuth, async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const role = req.user?.role;
  if (role !== "founder" && role !== "admin" && role !== "operator") {
    res.status(403).json({ error: "forbidden" }); return;
  }
  const rows = await db.select().from(sitesTable).where(eq(sitesTable.id, id)).limit(1);
  const site = rows[0];
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }
  const { durationMs } = req.body as { durationMs?: number | null };
  const currentlyFineUntil = typeof durationMs === "number" && durationMs > 0
    ? new Date(Date.now() + durationMs)
    : null;
  await db.update(sitesTable).set({
    currentlyFine: true,
    currentlyFineAt: new Date(),
    currentlyFineBy: req.user?.username ?? null,
    currentlyFineUntil,
  }).where(eq(sitesTable.id, id));
  logEvent("info", "monitor", `Site marked as currently-fine: ${site.name} by ${req.user?.username}`);
  void auditFromRequest(req, {
    action: "set_currently_fine",
    resource: "site",
    resourceId: String(id),
    entityName: site.name,
    siteId: id,
  });
  res.json({ success: true, siteId: id, currentlyFine: true });
});

router.patch("/sites/:id/unset-currently-fine", requireAuth, async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const role = req.user?.role;
  if (role !== "founder" && role !== "admin" && role !== "operator") {
    res.status(403).json({ error: "forbidden" }); return;
  }
  const rows = await db.select().from(sitesTable).where(eq(sitesTable.id, id)).limit(1);
  const site = rows[0];
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }
  await db.update(sitesTable).set({
    currentlyFine: false,
    currentlyFineAt: null,
    currentlyFineBy: null,
    currentlyFineUntil: null,
  }).where(eq(sitesTable.id, id));
  logEvent("info", "monitor", `Site currently-fine cleared: ${site.name} by ${req.user?.username}`);
  void auditFromRequest(req, {
    action: "unset_currently_fine",
    resource: "site",
    resourceId: String(id),
    entityName: site.name,
    siteId: id,
  });
  res.json({ success: true, siteId: id, currentlyFine: false });
});

// ---------------------------------------------------------------------------
// Bulk pause / resume
// ---------------------------------------------------------------------------

/** GET /api/sites/:id/ssl-target — return linked ssl_target record for a site */
router.get("/sites/:id/ssl-target", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    // Try by siteId link first
    const byLink = await db
      .select()
      .from(sslTargetsTable)
      .where(eq(sslTargetsTable.siteId, id))
      .limit(1);
    if (byLink.length > 0) {
      return res.json(byLink[0]);
    }
    // Fallback: match by host
    const site = await db.select({ host: sitesTable.host, url: sitesTable.url }).from(sitesTable).where(eq(sitesTable.id, id)).limit(1);
    if (!site.length) return res.status(404).json({ error: "Site not found" });
    const normalHost = site[0]!.host.toLowerCase().replace(/^www\./, "");
    const byHost = await db
      .select()
      .from(sslTargetsTable)
      .where(eq(sslTargetsTable.host, normalHost))
      .limit(1);
    if (byHost.length > 0) return res.json(byHost[0]);
    return res.status(404).json({ error: "No SSL target found" });
  } catch {
    res.status(500).json({ error: "Failed to fetch SSL target" });
  }
});

// Site name autocomplete search for audit log filter etc.
router.get("/sites/search", requireAuth, async (req, res) => {
  const q = String(req.query["q"] ?? "").trim();
  if (q.length === 0) {
    res.json([]);
    return;
  }
  const rows = await db
    .select({ id: sitesTable.id, name: sitesTable.name, host: sitesTable.host })
    .from(sitesTable)
    .where(ilike(sitesTable.name, `%${q}%`))
    .orderBy(sitesTable.name)
    .limit(20);
  res.json(rows);
});

router.post("/sites/bulk-pause", requireAuth, async (req, res) => {
  const raw = req.body?.ids;
  if (!Array.isArray(raw) || raw.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array" });
    return;
  }
  const role = req.user?.role;
  if (role !== "founder" && role !== "admin" && role !== "operator") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const ids = Array.from(new Set(raw.map(Number).filter(Number.isFinite)));
  await db.update(sitesTable).set({
    monitoringPaused: true,
    monitoringPausedAt: new Date(),
    monitoringPausedBy: req.user?.username ?? null,
  }).where(inArray(sitesTable.id, ids));
  void auditFromRequest(req, {
    action: "bulk_pause_sites",
    resource: "site",
    details: { ids, count: ids.length },
  });
  res.json({ success: true, paused: ids.length });
});

router.post("/sites/bulk-resume", requireAuth, async (req, res) => {
  const raw = req.body?.ids;
  if (!Array.isArray(raw) || raw.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array" });
    return;
  }
  const role = req.user?.role;
  if (role !== "founder" && role !== "admin" && role !== "operator") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const ids = Array.from(new Set(raw.map(Number).filter(Number.isFinite)));
  await db.update(sitesTable).set({
    monitoringPaused: false,
    monitoringPausedAt: null,
    monitoringPausedBy: null,
  }).where(inArray(sitesTable.id, ids));
  void auditFromRequest(req, {
    action: "bulk_resume_sites",
    resource: "site",
    details: { ids, count: ids.length },
  });
  res.json({ success: true, resumed: ids.length });
});

export default router;
