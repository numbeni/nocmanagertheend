import { Router, type IRouter } from "express";
import { db, incidentsTable, sitesTable } from "@workspace/db";
import { and, desc, gte, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

/**
 * GET /api/events/critical
 * Returns critical/warning incidents from the last 1 hour.
 * Only accessible to operators, admins and founders.
 */
router.get("/events/critical", requireAuth, requireRole("operator"), async (req, res) => {
  const lastMs = (() => {
    const raw = req.query["last"];
    if (typeof raw === "string" && raw.endsWith("h")) {
      const h = Number(raw.slice(0, -1));
      if (Number.isFinite(h) && h > 0) return h * 60 * 60 * 1000;
    }
    return 60 * 60 * 1000; // default 1 hour
  })();

  const since = new Date(Date.now() - lastMs);

  const incidents = await db
    .select({
      id: incidentsTable.id,
      siteId: incidentsTable.siteId,
      incidentType: incidentsTable.incidentType,
      severity: incidentsTable.severity,
      status: incidentsTable.status,
      title: incidentsTable.title,
      description: incidentsTable.description,
      startedAt: incidentsTable.startedAt,
      acknowledgedAt: incidentsTable.acknowledgedAt,
      resolvedAt: incidentsTable.resolvedAt,
      failureCount: incidentsTable.failureCount,
    })
    .from(incidentsTable)
    .where(
      and(
        gte(incidentsTable.startedAt, since),
        inArray(incidentsTable.severity, ["critical", "warning"]),
      ),
    )
    .orderBy(desc(incidentsTable.startedAt))
    .limit(20);

  if (incidents.length === 0) {
    return res.json({ incidents: [], siteNames: {}, total: 0, windowMs: lastMs });
  }

  const siteIds = [...new Set(incidents.map((i) => i.siteId))];
  const sites = await db
    .select({ id: sitesTable.id, name: sitesTable.name, host: sitesTable.host })
    .from(sitesTable)
    .where(inArray(sitesTable.id, siteIds));

  const siteNames: Record<number, { name: string; host: string }> = {};
  for (const s of sites) {
    siteNames[s.id] = { name: s.name, host: s.host };
  }

  return res.json({
    incidents: incidents.map((i) => ({
      id: i.id,
      siteId: i.siteId,
      siteName: siteNames[i.siteId]?.name ?? `Site #${i.siteId}`,
      siteHost: siteNames[i.siteId]?.host ?? "",
      incidentType: i.incidentType,
      severity: i.severity,
      status: i.status,
      title: i.title,
      description: i.description,
      startedAt: i.startedAt.toISOString(),
      acknowledgedAt: i.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
      failureCount: i.failureCount,
    })),
    total: incidents.length,
    windowMs: lastMs,
  });
});

export default router;
