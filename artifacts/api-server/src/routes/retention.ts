import { Router } from "express";
import { requireAuth, requireRole } from "../middlewares/auth";
import { db, appSettingsTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { runDataRetentionCleanup } from "../services/data-retention";

const router = Router();

const RETENTION_KEYS = [
  "checksRetentionDays",
  "eventLogRetentionDays",
  "auditLogRetentionDays",
  "alertRetentionDays",
] as const;

const DEFAULTS = {
  checksRetentionDays: 90,
  eventLogRetentionDays: 30,
  auditLogRetentionDays: 365,
  alertRetentionDays: 90,
};

function parseDay(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

async function readRetention() {
  const rows = await db
    .select()
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, RETENTION_KEYS as unknown as string[]));
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    checksRetentionDays: parseDay(map.get("checksRetentionDays"), DEFAULTS.checksRetentionDays),
    eventLogRetentionDays: parseDay(map.get("eventLogRetentionDays"), DEFAULTS.eventLogRetentionDays),
    auditLogRetentionDays: parseDay(map.get("auditLogRetentionDays"), DEFAULTS.auditLogRetentionDays),
    alertRetentionDays: parseDay(map.get("alertRetentionDays"), DEFAULTS.alertRetentionDays),
  };
}

router.get("/settings/retention", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    res.json(await readRetention());
  } catch (err) {
    logger.error({ err }, "Failed to get retention settings");
    res.status(500).json({ error: "Failed to get retention settings" });
  }
});

router.put("/settings/retention", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    for (const key of RETENTION_KEYS) {
      const v = body[key];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        const value = String(Math.floor(v));
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
    }
    res.json(await readRetention());
  } catch (err) {
    logger.error({ err }, "Failed to update retention settings");
    res.status(500).json({ error: "Failed to update retention settings" });
  }
});

router.post("/settings/retention/run", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const cfg = await readRetention();
    await runDataRetentionCleanup(cfg);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to run retention cleanup");
    res.status(500).json({ error: "Failed to run retention cleanup" });
  }
});

export { readRetention };
export default router;
