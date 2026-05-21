import { Router, type IRouter } from "express";
import { db, incidentsTable, sitesTable, checksTable, incidentNotesTable } from "@workspace/db";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { auditFromRequest } from "../services/audit";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

function serializeIncident(i: typeof incidentsTable.$inferSelect, site: { name: string; url: string }) {
  const now = i.resolvedAt ?? new Date();
  const durationSeconds =
    i.status === "resolved" && i.resolvedAt
      ? Math.floor((i.resolvedAt.getTime() - i.startedAt.getTime()) / 1000)
      : Math.floor((now.getTime() - i.startedAt.getTime()) / 1000);
  return {
    id: i.id,
    siteId: i.siteId,
    siteName: site.name,
    siteUrl: site.url,
    incidentType: i.incidentType,
    severity: i.severity,
    status: i.status,
    title: i.title,
    description: i.description,
    startedAt: i.startedAt.toISOString(),
    acknowledgedAt: i.acknowledgedAt ? i.acknowledgedAt.toISOString() : null,
    resolvedAt: i.resolvedAt ? i.resolvedAt.toISOString() : null,
    updatedAt: i.updatedAt.toISOString(),
    durationSeconds,
    failureCount: i.failureCount,
    resolvedReason: i.resolvedReason,
    resolvedBy: i.resolvedBy,
    resolvedFromCheckId: i.resolvedFromCheckId,
  };
}

// Whitelist of sortable columns. Only allows columns the operator needs.
const SORT_COLUMNS = {
  startedAt: incidentsTable.startedAt,
  updatedAt: incidentsTable.updatedAt,
  createdAt: incidentsTable.startedAt, // alias — incidents have no separate createdAt
} as const;
type SortBy = keyof typeof SORT_COLUMNS;

function resolveSort(req: { query: Record<string, unknown> }): {
  column: (typeof SORT_COLUMNS)[SortBy];
  direction: "asc" | "desc";
} {
  const rawSortBy = String(req.query["sortBy"] ?? "updatedAt");
  const rawOrder = String(req.query["order"] ?? "desc").toLowerCase();
  const sortBy: SortBy = (Object.keys(SORT_COLUMNS) as SortBy[]).includes(
    rawSortBy as SortBy,
  )
    ? (rawSortBy as SortBy)
    : "updatedAt";
  const direction: "asc" | "desc" = rawOrder === "asc" ? "asc" : "desc";
  return { column: SORT_COLUMNS[sortBy], direction };
}

router.get("/incidents", async (req, res) => {
  const status = String(req.query["status"] ?? "all");
  const limit = Math.min(Number(req.query["limit"] ?? 50), 500);
  const { column, direction } = resolveSort(req);
  const orderClause = direction === "asc" ? asc(column) : desc(column);

  const rows =
    status === "all"
      ? await db
          .select({ incident: incidentsTable, site: sitesTable })
          .from(incidentsTable)
          .innerJoin(sitesTable, eq(sitesTable.id, incidentsTable.siteId))
          .orderBy(orderClause)
          .limit(limit)
      : await db
          .select({ incident: incidentsTable, site: sitesTable })
          .from(incidentsTable)
          .innerJoin(sitesTable, eq(sitesTable.id, incidentsTable.siteId))
          .where(eq(incidentsTable.status, status))
          .orderBy(orderClause)
          .limit(limit);

  res.json(rows.map((r) => serializeIncident(r.incident, r.site)));
});

router.get("/incidents/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const rows = await db
    .select({ incident: incidentsTable, site: sitesTable })
    .from(incidentsTable)
    .innerJoin(sitesTable, eq(sitesTable.id, incidentsTable.siteId))
    .where(eq(incidentsTable.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }
  // Build timeline of related checks: from startedAt through resolvedAt (or now)
  const until = row.incident.resolvedAt ?? new Date();
  const timeline = await db
    .select()
    .from(checksTable)
    .where(
      and(
        eq(checksTable.siteId, row.incident.siteId),
        gte(checksTable.timestamp, row.incident.startedAt),
      ),
    )
    .orderBy(desc(checksTable.timestamp))
    .limit(200);
  void until;
  const base = serializeIncident(row.incident, row.site);
  res.json({
    ...base,
    timeline: timeline.map((r) => ({
      id: r.id,
      siteId: r.siteId,
      timestamp: r.timestamp.toISOString(),
      overallStatus: r.overallStatus,
      httpStatus: r.httpStatus,
      responseTimeMs: r.responseTimeMs,
      dnsStatus: r.dnsStatus,
      dnsResolveMs: r.dnsResolveMs,
      tcp80Open: r.tcp80Open,
      tcp443Open: r.tcp443Open,
      sslStatus: r.sslStatus,
      sslDaysRemaining: r.sslDaysRemaining,
      sslIssuer: r.sslIssuer,
      errorType: r.errorType,
      errorMessage: r.errorMessage,
    })),
  });
});

router.post("/incidents/:id/acknowledge", requireAuth, async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const now = new Date();
  await db
    .update(incidentsTable)
    .set({ status: "acknowledged", acknowledgedAt: now, updatedAt: now })
    .where(and(eq(incidentsTable.id, id), inArray(incidentsTable.status, ["open"])));
  const rows = await db
    .select({ incident: incidentsTable, site: sitesTable })
    .from(incidentsTable)
    .innerJoin(sitesTable, eq(sitesTable.id, incidentsTable.siteId))
    .where(eq(incidentsTable.id, id))
    .limit(1);
  if (!rows[0]) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }
  void auditFromRequest(req, {
    action: "acknowledge_incident",
    resource: "incident",
    resourceId: String(id),
    entityName: rows[0].site.name,
    siteId: rows[0].incident.siteId,
    details: { siteName: rows[0].site.name, status: rows[0].incident.status },
  });
  res.json(serializeIncident(rows[0].incident, rows[0].site));
});

router.post("/incidents/:id/resolve", requireAuth, async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const reasonInput =
    typeof req.body?.resolvedReason === "string"
      ? req.body.resolvedReason.trim().slice(0, 500)
      : "";
  const resolvedReason = reasonInput || "Manually resolved by operator";
  const resolvedBy = req.user?.username ?? "operator";
  const now = new Date();
  await db
    .update(incidentsTable)
    .set({
      status: "resolved",
      resolvedAt: now,
      resolvedReason,
      resolvedBy,
      updatedAt: now,
    })
    .where(eq(incidentsTable.id, id));
  const rows = await db
    .select({ incident: incidentsTable, site: sitesTable })
    .from(incidentsTable)
    .innerJoin(sitesTable, eq(sitesTable.id, incidentsTable.siteId))
    .where(eq(incidentsTable.id, id))
    .limit(1);
  if (!rows[0]) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }
  void auditFromRequest(req, {
    action: "resolve_incident",
    resource: "incident",
    resourceId: String(id),
    entityName: rows[0].site.name,
    siteId: rows[0].incident.siteId,
    details: { siteName: rows[0].site.name, resolvedReason },
  });
  res.json(serializeIncident(rows[0].incident, rows[0].site));
});

// ── Incident Notes ────────────────────────────────────────────────────────────

router.get("/incidents/:id/notes", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const notes = await db
    .select()
    .from(incidentNotesTable)
    .where(eq(incidentNotesTable.incidentId, id))
    .orderBy(asc(incidentNotesTable.createdAt));
  res.json(
    notes.map((n) => ({
      id: n.id,
      incidentId: n.incidentId,
      note: n.note,
      author: n.author,
      createdAt: n.createdAt.toISOString(),
    })),
  );
});

router.post("/incidents/:id/notes", requireAuth, async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const note = String(req.body?.note ?? "").trim();
  // Use authenticated user as author; fall back to body-provided author for backwards compat
  const author = req.user?.username ?? (String(req.body?.author ?? "Operator").trim() || "Operator");
  if (!note) {
    res.status(400).json({ error: "note is required" });
    return;
  }
  // Fetch the incident to get siteId + site name for audit
  const incidentRows = await db
    .select({ incident: incidentsTable, site: sitesTable })
    .from(incidentsTable)
    .innerJoin(sitesTable, eq(sitesTable.id, incidentsTable.siteId))
    .where(eq(incidentsTable.id, id))
    .limit(1);
  if (!incidentRows[0]) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }
  const [row] = await db
    .insert(incidentNotesTable)
    .values({ incidentId: id, note, author })
    .returning();
  if (!row) {
    res.status(500).json({ error: "Failed to insert note" });
    return;
  }
  // A note is operator-visible context — bump updatedAt so the incident
  // surfaces correctly when sorting by "most recently updated".
  await db
    .update(incidentsTable)
    .set({ updatedAt: new Date() })
    .where(eq(incidentsTable.id, id));
  void auditFromRequest(req, {
    action: "add_incident_note",
    resource: "incident",
    resourceId: String(id),
    entityName: incidentRows[0].site.name,
    siteId: incidentRows[0].incident.siteId,
    details: { author, noteLength: note.length },
  });
  res.status(201).json({
    id: row.id,
    incidentId: row.incidentId,
    note: row.note,
    author: row.author,
    createdAt: row.createdAt.toISOString(),
  });
});

export default router;
