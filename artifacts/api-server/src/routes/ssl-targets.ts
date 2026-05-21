import { Router } from "express";
import { db, sslTargetsTable, sitesTable } from "@workspace/db";
import { eq, asc, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { checkSsl } from "../monitoring/ssl";
import { runSslBatchForAllTargets } from "../monitoring/engine";
import { getSslScanState, isSslScanInFlight, isMonitoringSweepInFlight } from "../monitoring/monitor-state";

const router = Router();

/** Normalize a hostname: strip leading www., lowercase, strip trailing dot */
function normalizeHost(raw: string): string {
  return raw.trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "").split(":")[0]!;
}

router.get("/ssl-targets", requireAuth, async (_req, res) => {
  try {
    const targets = await db
      .select()
      .from(sslTargetsTable)
      .orderBy(asc(sslTargetsTable.host));
    res.json(targets);
  } catch {
    res.status(500).json({ error: "Failed to fetch SSL targets" });
  }
});

router.get("/ssl-targets/summary", requireAuth, async (_req, res) => {
  try {
    const targets = await db.select().from(sslTargetsTable);
    const total = targets.length;
    const valid = targets.filter((t) => t.lastStatus === "valid").length;
    const expiring = targets.filter((t) => t.lastStatus === "expiring_soon").length;
    const expired = targets.filter((t) => t.lastStatus === "expired").length;
    const invalid = targets.filter(
      (t) =>
        t.lastStatus != null &&
        !["valid", "expiring_soon", "expired"].includes(t.lastStatus),
    ).length;
    const unchecked = targets.filter((t) => !t.lastStatus).length;

    const checkedTargets = targets.filter((t) => t.lastCheckedAt);
    const lastCheckedAt = checkedTargets.length > 0
      ? checkedTargets.reduce((latest, t) =>
          t.lastCheckedAt && t.lastCheckedAt > latest ? t.lastCheckedAt : latest,
          checkedTargets[0]!.lastCheckedAt!,
        )
      : null;

    const sslScanState = getSslScanState();

    res.json({
      total,
      valid,
      expiring,
      expired,
      invalid,
      unchecked,
      lastCheckedAt: lastCheckedAt?.toISOString() ?? null,
      sslScan: sslScanState,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch summary" });
  }
});

/** GET /api/ssl-targets/scan-status */
router.get("/ssl-targets/scan-status", requireAuth, (_req, res) => {
  res.json({
    ...getSslScanState(),
    monitoringSweepInFlight: isMonitoringSweepInFlight(),
  });
});

/** POST /api/ssl-targets — create single target */
router.post("/ssl-targets", requireAuth, async (req, res) => {
  const { host, port = 443, siteId = null, notes = null } = req.body as {
    host?: string;
    port?: number;
    siteId?: number | null;
    notes?: string | null;
  };
  if (!host || typeof host !== "string") {
    return res.status(400).json({ error: "host is required" });
  }
  try {
    const [target] = await db
      .insert(sslTargetsTable)
      .values({
        host: host.trim(),
        port: Number(port) || 443,
        siteId: siteId ?? null,
        notes: notes ?? null,
      })
      .returning();
    res.status(201).json(target);
  } catch {
    res.status(500).json({ error: "Failed to create SSL target" });
  }
});

/** POST /api/ssl-targets/bulk-import */
router.post("/ssl-targets/bulk-import", requireAuth, async (req, res) => {
  const { domains } = req.body as { domains?: string[] };
  if (!Array.isArray(domains) || domains.length === 0) {
    return res.status(400).json({ error: "domains array is required" });
  }

  const results: { host: string; status: "added" | "duplicate" | "invalid" }[] = [];
  const existing = await db.select({ host: sslTargetsTable.host }).from(sslTargetsTable);
  const existingHosts = new Set(existing.map((e) => e.host.toLowerCase()));

  for (const raw of domains) {
    const host = raw.trim().replace(/^https?:\/\//i, "").replace(/\/.*/,"").toLowerCase();
    if (!host || !/^[a-z0-9]([a-z0-9\-\.]*[a-z0-9])?(:[0-9]+)?$/i.test(host)) {
      results.push({ host: raw.trim(), status: "invalid" });
      continue;
    }
    if (existingHosts.has(host)) {
      results.push({ host, status: "duplicate" });
      continue;
    }
    try {
      await db.insert(sslTargetsTable).values({ host, port: 443 });
      existingHosts.add(host);
      results.push({ host, status: "added" });
    } catch {
      results.push({ host, status: "invalid" });
    }
  }

  const added = results.filter((r) => r.status === "added").length;
  const duplicates = results.filter((r) => r.status === "duplicate").length;
  const invalid = results.filter((r) => r.status === "invalid").length;

  res.json({ added, duplicates, invalid, results });
});

/** POST /api/ssl-targets/check-all — trigger full SSL batch scan */
router.post("/ssl-targets/check-all", requireAuth, async (_req, res) => {
  if (isSslScanInFlight()) {
    return res.status(409).json({
      error: "ssl_scan_running",
      message: "An SSL scan is already in progress",
    });
  }
  runSslBatchForAllTargets().catch(() => {});
  res.json({ ok: true, message: "SSL scan started" });
});

/** POST /api/ssl-targets/auto-link — auto-link ssl targets to monitored sites by domain */
router.post("/ssl-targets/auto-link", requireAuth, async (_req, res) => {
  try {
    const [targets, sites] = await Promise.all([
      db.select().from(sslTargetsTable),
      db.select({ id: sitesTable.id, host: sitesTable.host, url: sitesTable.url }).from(sitesTable),
    ]);

    // Build a map: normalizedHost → siteId
    const siteHostMap = new Map<string, number>();
    for (const site of sites) {
      siteHostMap.set(normalizeHost(site.host), site.id);
      // Also try to extract host from URL
      try {
        const parsed = new URL(site.url);
        siteHostMap.set(normalizeHost(parsed.hostname), site.id);
      } catch {}
    }

    let linked = 0;
    let alreadyLinked = 0;

    for (const target of targets) {
      const normTarget = normalizeHost(target.host);
      const matchedSiteId = siteHostMap.get(normTarget);

      if (matchedSiteId != null) {
        if (target.siteId === matchedSiteId) {
          alreadyLinked++;
        } else {
          await db
            .update(sslTargetsTable)
            .set({ siteId: matchedSiteId })
            .where(eq(sslTargetsTable.id, target.id));
          linked++;
        }
      }
    }

    res.json({ ok: true, linked, alreadyLinked });
  } catch {
    res.status(500).json({ error: "Auto-link failed" });
  }
});

/** DELETE /api/ssl-targets/bulk-delete — delete multiple targets by IDs */
router.delete("/ssl-targets/bulk-delete", requireAuth, async (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids array is required" });
  }
  const numericIds = ids.map(Number).filter((n) => n > 0);
  if (numericIds.length === 0) {
    return res.status(400).json({ error: "No valid ids" });
  }
  try {
    await db.delete(sslTargetsTable).where(inArray(sslTargetsTable.id, numericIds));
    res.json({ ok: true, deleted: numericIds.length });
  } catch {
    res.status(500).json({ error: "Failed to delete" });
  }
});

router.delete("/ssl-targets/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    await db.delete(sslTargetsTable).where(eq(sslTargetsTable.id, id));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete SSL target" });
  }
});

router.post("/ssl-targets/:id/check", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const rows = await db
      .select()
      .from(sslTargetsTable)
      .where(eq(sslTargetsTable.id, id));
    const target = rows[0];
    if (!target) return res.status(404).json({ error: "Not found" });

    const result = await checkSsl(target.host, target.port);

    await db
      .update(sslTargetsTable)
      .set({
        lastCheckedAt: new Date(),
        lastStatus: result.status,
        lastDaysRemaining: result.daysRemaining,
        lastIssuer: result.issuer,
        lastSubject: result.subject,
        lastValidFrom: result.validFrom,
        lastValidTo: result.validTo,
        lastProtocol: result.protocol,
        lastError: result.error,
      })
      .where(eq(sslTargetsTable.id, id));

    res.json({ id, ...result });
  } catch {
    res.status(500).json({ error: "Failed to run SSL check" });
  }
});

export default router;
