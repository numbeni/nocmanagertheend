import { Router, type IRouter } from "express";
import { requireRole } from "../middlewares/auth";
import { queryAuditLogs } from "../services/audit";

const router: IRouter = Router();

router.get("/audit-logs", requireRole("operator"), async (req, res) => {
  try {
    const format = typeof req.query["format"] === "string" ? req.query["format"] : "json";
    const siteIdRaw = req.query["siteId"];
    const siteId =
      typeof siteIdRaw === "string" && siteIdRaw.trim() !== ""
        ? Number(siteIdRaw)
        : undefined;

    const result = await queryAuditLogs({
      page: req.query["page"] ? Number(req.query["page"]) : 1,
      pageSize: req.query["pageSize"] ? Number(req.query["pageSize"]) : 50,
      action: typeof req.query["action"] === "string" ? req.query["action"] : undefined,
      resource: typeof req.query["resource"] === "string" ? req.query["resource"] : undefined,
      actorUsername: typeof req.query["actorUsername"] === "string" ? req.query["actorUsername"] : undefined,
      result: typeof req.query["result"] === "string" ? req.query["result"] : undefined,
      from: typeof req.query["from"] === "string" ? req.query["from"] : undefined,
      to: typeof req.query["to"] === "string" ? req.query["to"] : undefined,
      search: typeof req.query["search"] === "string" ? req.query["search"] : undefined,
      siteId: siteId != null && Number.isFinite(siteId) ? siteId : undefined,
    });

    if (format === "text") {
      // Plain-text export: one line per log entry
      const lines = result.data.map((row) => {
        const ts = row.timestamp;
        const actor = row.actorUsername ?? "system";
        const entity = row.entityName ? ` [${row.entityName}]` : "";
        const details = row.details ? ` | ${row.details}` : "";
        const ip = row.ipAddress ? ` @${row.ipAddress}` : "";
        return `${ts} | ${actor} (${row.actorRole ?? "?"}) | ${row.action} ${row.resource}${entity}${row.resourceId ? `#${row.resourceId}` : ""} | ${row.result}${details}${ip}`;
      });
      const header = `# Audit Log Export — ${new Date().toISOString()}\n# Total: ${result.pagination.total} entries (page ${result.pagination.page}/${result.pagination.totalPages})\n\n`;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="audit-log-${Date.now()}.txt"`);
      return res.send(header + lines.join("\n"));
    }

    return res.json(result);
  } catch {
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
