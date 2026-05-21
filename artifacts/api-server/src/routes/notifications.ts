import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { db, incidentsTable, sitesTable } from "@workspace/db";
import { desc, eq, gte } from "drizzle-orm";
import { registerSseClient, unregisterSseClient, broadcastSse } from "../services/sse-broadcast";

export { broadcastSse as broadcastNotification };

const router: IRouter = Router();

router.get("/notifications/stream", requireAuth, (req: Request, res: Response) => {
  const clientId = `${Date.now()}-${Math.random()}`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: "connected", clientId })}\n\n`);

  registerSseClient(clientId, res);

  const keepAlive = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      clearInterval(keepAlive);
      unregisterSseClient(clientId);
    }
  }, 25_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    unregisterSseClient(clientId);
  });
});

router.get("/notifications/recent", requireAuth, async (_req: Request, res: Response) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        id: incidentsTable.id,
        siteId: incidentsTable.siteId,
        siteName: sitesTable.name,
        incidentType: incidentsTable.incidentType,
        severity: incidentsTable.severity,
        status: incidentsTable.status,
        title: incidentsTable.title,
        startedAt: incidentsTable.startedAt,
        updatedAt: incidentsTable.updatedAt,
      })
      .from(incidentsTable)
      .innerJoin(sitesTable, eq(incidentsTable.siteId, sitesTable.id))
      .where(gte(incidentsTable.startedAt, since))
      .orderBy(desc(incidentsTable.startedAt))
      .limit(50);

    return res.json(
      rows.map((r) => ({
        id: r.id,
        siteId: r.siteId,
        siteName: r.siteName,
        incidentType: r.incidentType,
        severity: r.severity,
        status: r.status,
        title: r.title,
        startedAt: r.startedAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    );
  } catch {
    return res.status(500).json({ error: "internal_error" });
  }
});

router.post("/notifications/test", requireAuth, (_req: Request, res: Response) => {
  return res.json({
    type: "test",
    title: "NOC Monitor Test",
    body: "Test notification — the system is working correctly.",
    timestamp: new Date().toISOString(),
  });
});

export default router;
