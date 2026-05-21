import { Router, type Request, type Response } from "express";
import { db, eventLogsTable } from "@workspace/db";
import { and, desc, eq, type SQL } from "drizzle-orm";

const router = Router();

function buildFilters(req: Request): SQL[] {
  const filters: SQL[] = [];
  const level = req.query.level as string | undefined;
  const category = req.query.category as string | undefined;
  const siteIdRaw = req.query.siteId as string | undefined;
  if (level && level !== "all") {
    filters.push(eq(eventLogsTable.level, level));
  }
  if (category && category !== "all") {
    filters.push(eq(eventLogsTable.category, category));
  }
  if (siteIdRaw) {
    const siteId = Number(siteIdRaw);
    if (Number.isFinite(siteId)) {
      filters.push(eq(eventLogsTable.siteId, siteId));
    }
  }
  return filters;
}

router.get("/", async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const filters = buildFilters(req);
  const query = db.select().from(eventLogsTable);
  const rows = await (filters.length > 0 ? query.where(and(...filters)) : query)
    .orderBy(desc(eventLogsTable.timestamp))
    .limit(limit);
  res.json(
    rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp.toISOString(),
      level: r.level,
      category: r.category,
      siteId: r.siteId,
      message: r.message,
      details: r.details,
    })),
  );
});

router.get("/export", async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 10_000, 100_000);
  const filters = buildFilters(req);
  const query = db.select().from(eventLogsTable);
  const rows = await (filters.length > 0 ? query.where(and(...filters)) : query)
    .orderBy(desc(eventLogsTable.timestamp))
    .limit(limit);

  const lines: string[] = [];
  lines.push("# NOC Monitor Event Log Export");
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push(`# Entries: ${rows.length}`);
  lines.push("# Format: [timestamp] LEVEL [category] (site=ID) message | details");
  lines.push("");
  // Render oldest -> newest in the file (more natural for reading)
  for (const r of rows.slice().reverse()) {
    const ts = r.timestamp.toISOString();
    const lvl = r.level.toUpperCase().padEnd(5, " ");
    const cat = `[${r.category}]`.padEnd(11, " ");
    const site = r.siteId != null ? ` (site=${r.siteId})` : "";
    const det = r.details ? ` | ${r.details}` : "";
    lines.push(`[${ts}] ${lvl} ${cat}${site} ${r.message}${det}`);
  }

  const filename = `noc-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(lines.join("\n"));
});

export default router;
