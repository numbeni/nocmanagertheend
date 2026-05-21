import { Router } from "express";
import { eq, desc, and, inArray } from "drizzle-orm";
import {
  db,
  paymentGatewaysTable,
  paymentGatewayChecksTable,
  siteGatewayLinksTable,
  sitesTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { runAndPersistGatewayCheck } from "../monitoring/gateway-check";
import { runCurlCheck } from "../monitoring/curl-check";
import { logger } from "../lib/logger";

const router = Router();

// ── List all gateways (with latest check snapshot) ────────────────────────────
router.get("/gateways", requireAuth, async (_req, res) => {
  try {
    const gateways = await db
      .select()
      .from(paymentGatewaysTable)
      .orderBy(paymentGatewaysTable.name);

    // Fetch latest check for each gateway
    const ids = gateways.map((g) => g.id);
    let latestChecks: Record<number, (typeof paymentGatewayChecksTable.$inferSelect)> = {};

    if (ids.length > 0) {
      // For each gateway get the most recent check
      const checks = await db
        .select()
        .from(paymentGatewayChecksTable)
        .where(inArray(paymentGatewayChecksTable.gatewayId, ids))
        .orderBy(desc(paymentGatewayChecksTable.checkedAt));

      // Keep only the first (latest) check per gateway
      for (const c of checks) {
        if (!latestChecks[c.gatewayId]) {
          latestChecks[c.gatewayId] = c;
        }
      }
    }

    const result = gateways.map((g) => ({
      ...g,
      latestCheck: latestChecks[g.id] ?? null,
    }));

    res.json(result);
  } catch (err) {
    logger.error({ err }, "Failed to list gateways");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get single gateway ─────────────────────────────────────────────────────────
router.get("/gateways/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return void res.status(400).json({ error: "Invalid id" });

    const [gw] = await db
      .select()
      .from(paymentGatewaysTable)
      .where(eq(paymentGatewaysTable.id, id));

    if (!gw) return void res.status(404).json({ error: "Not found" });

    // Latest check
    const [latestCheck] = await db
      .select()
      .from(paymentGatewayChecksTable)
      .where(eq(paymentGatewayChecksTable.gatewayId, id))
      .orderBy(desc(paymentGatewayChecksTable.checkedAt))
      .limit(1);

    // Linked sites
    const links = await db
      .select({ site: sitesTable })
      .from(siteGatewayLinksTable)
      .innerJoin(sitesTable, eq(siteGatewayLinksTable.siteId, sitesTable.id))
      .where(eq(siteGatewayLinksTable.gatewayId, id));

    res.json({
      ...gw,
      latestCheck: latestCheck ?? null,
      linkedSites: links.map((l) => l.site),
    });
  } catch (err) {
    logger.error({ err }, "Failed to get gateway");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Create gateway ─────────────────────────────────────────────────────────────
router.post("/gateways", requireAuth, async (req, res) => {
  try {
    const { name, provider, baseDomain, apiUrl, paymentPageUrl, tags, notes } =
      req.body ?? {};

    if (!name || !baseDomain) {
      return void res.status(400).json({ error: "name and baseDomain are required" });
    }

    // Normalise domain
    const domain = (baseDomain as string)
      .trim()
      .replace(/^https?:\/\//, "")
      .split("/")[0];

    const [created] = await db
      .insert(paymentGatewaysTable)
      .values({
        name: (name as string).trim(),
        provider: (provider as string | undefined)?.trim() || "other",
        baseDomain: domain,
        apiUrl: apiUrl || null,
        paymentPageUrl: paymentPageUrl || null,
        tags: tags || null,
        notes: notes || null,
      })
      .returning();

    res.status(201).json(created);
  } catch (err) {
    logger.error({ err }, "Failed to create gateway");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Bulk create gateways (from multi-line textarea / CSV) ──────────────────────
router.post("/gateways/bulk", requireAuth, async (req, res) => {
  try {
    const { domains } = req.body ?? {};
    if (!domains || typeof domains !== "string") {
      return void res.status(400).json({ error: "domains string is required" });
    }

    const lines = domains
      .split(/[\n,]+/)
      .map((l: string) => l.trim().replace(/^https?:\/\//, "").split("/")[0])
      .filter(Boolean)
      .filter((d: string) => d.includes("."));

    if (lines.length === 0) {
      return void res.status(400).json({ error: "No valid domains found" });
    }

    const values = lines.map((domain: string) => ({
      name: domain,
      provider: guessProvider(domain),
      baseDomain: domain,
    }));

    const created = await db
      .insert(paymentGatewaysTable)
      .values(values)
      .onConflictDoNothing()
      .returning();

    res.status(201).json({ created: created.length, gateways: created });
  } catch (err) {
    logger.error({ err }, "Failed to bulk create gateways");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Update gateway ─────────────────────────────────────────────────────────────
router.patch("/gateways/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return void res.status(400).json({ error: "Invalid id" });

    const { name, provider, baseDomain, apiUrl, paymentPageUrl, enabled, tags, notes } =
      req.body ?? {};

    const updates: Partial<typeof paymentGatewaysTable.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (name !== undefined) updates.name = (name as string).trim();
    if (provider !== undefined) updates.provider = provider;
    if (baseDomain !== undefined) {
      updates.baseDomain = (baseDomain as string)
        .trim()
        .replace(/^https?:\/\//, "")
        .split("/")[0];
    }
    if (apiUrl !== undefined) updates.apiUrl = apiUrl || null;
    if (paymentPageUrl !== undefined) updates.paymentPageUrl = paymentPageUrl || null;
    if (enabled !== undefined) updates.enabled = Boolean(enabled);
    if (tags !== undefined) updates.tags = tags || null;
    if (notes !== undefined) updates.notes = notes || null;

    const [updated] = await db
      .update(paymentGatewaysTable)
      .set(updates)
      .where(eq(paymentGatewaysTable.id, id))
      .returning();

    if (!updated) return void res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Failed to update gateway");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Delete gateway ─────────────────────────────────────────────────────────────
router.delete("/gateways/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return void res.status(400).json({ error: "Invalid id" });

    await db
      .delete(paymentGatewaysTable)
      .where(eq(paymentGatewaysTable.id, id));

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to delete gateway");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Manual check for one gateway ───────────────────────────────────────────────
router.post("/gateways/:id/check", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return void res.status(400).json({ error: "Invalid id" });

    const [gw] = await db
      .select()
      .from(paymentGatewaysTable)
      .where(eq(paymentGatewaysTable.id, id));

    if (!gw) return void res.status(404).json({ error: "Not found" });

    const result = await runAndPersistGatewayCheck(gw);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Failed to run gateway check");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Manual check all gateways ──────────────────────────────────────────────────
router.post("/gateways/check-all", requireAuth, async (_req, res) => {
  try {
    const gateways = await db
      .select()
      .from(paymentGatewaysTable)
      .then((rows) => rows.filter((g) => g.enabled));

    // Fire off checks without waiting (non-blocking)
    (async () => {
      for (const gw of gateways) {
        try {
          await runAndPersistGatewayCheck(gw);
        } catch (err) {
          logger.error({ err, gatewayId: gw.id }, "Check-all: gateway check failed");
        }
      }
    })().catch((err) => logger.error({ err }, "check-all loop error"));

    res.json({ ok: true, queued: gateways.length });
  } catch (err) {
    logger.error({ err }, "Failed to trigger check-all");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Curl check for one gateway ─────────────────────────────────────────────────
router.post("/gateways/:id/curl-check", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return void res.status(400).json({ error: "Invalid id" });

    const [gw] = await db
      .select()
      .from(paymentGatewaysTable)
      .where(eq(paymentGatewaysTable.id, id));

    if (!gw) return void res.status(404).json({ error: "Not found" });

    const url = gw.paymentPageUrl ?? `https://${gw.baseDomain}`;
    const result = await runCurlCheck(url);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Failed to run gateway curl check");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get check history for one gateway ─────────────────────────────────────────
router.get("/gateways/:id/checks", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return void res.status(400).json({ error: "Invalid id" });

    const limit = Math.min(parseInt((req.query.limit as string) ?? "50"), 200);

    const checks = await db
      .select()
      .from(paymentGatewayChecksTable)
      .where(eq(paymentGatewayChecksTable.gatewayId, id))
      .orderBy(desc(paymentGatewayChecksTable.checkedAt))
      .limit(limit);

    res.json(checks);
  } catch (err) {
    logger.error({ err }, "Failed to get gateway checks");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Link a site to a gateway ───────────────────────────────────────────────────
router.post("/gateways/:id/sites", requireAuth, async (req, res) => {
  try {
    const gatewayId = parseInt(req.params.id);
    const { siteId } = req.body ?? {};

    if (isNaN(gatewayId) || !siteId) {
      return void res.status(400).json({ error: "gatewayId and siteId are required" });
    }

    // Check if already linked
    const [existing] = await db
      .select()
      .from(siteGatewayLinksTable)
      .where(
        and(
          eq(siteGatewayLinksTable.gatewayId, gatewayId),
          eq(siteGatewayLinksTable.siteId, parseInt(siteId)),
        ),
      );

    if (existing) {
      return void res.status(409).json({ error: "Already linked" });
    }

    const [link] = await db
      .insert(siteGatewayLinksTable)
      .values({ gatewayId, siteId: parseInt(siteId) })
      .returning();

    res.status(201).json(link);
  } catch (err) {
    logger.error({ err }, "Failed to link site to gateway");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Unlink a site from a gateway ───────────────────────────────────────────────
router.delete("/gateways/:id/sites/:siteId", requireAuth, async (req, res) => {
  try {
    const gatewayId = parseInt(req.params.id);
    const siteId = parseInt(req.params.siteId);

    await db
      .delete(siteGatewayLinksTable)
      .where(
        and(
          eq(siteGatewayLinksTable.gatewayId, gatewayId),
          eq(siteGatewayLinksTable.siteId, siteId),
        ),
      );

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to unlink site from gateway");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get all gateways linked to a site ─────────────────────────────────────────
router.get("/sites/:siteId/gateways", requireAuth, async (req, res) => {
  try {
    const siteId = parseInt(req.params.siteId);
    if (isNaN(siteId)) return void res.status(400).json({ error: "Invalid siteId" });

    const links = await db
      .select({ gateway: paymentGatewaysTable })
      .from(siteGatewayLinksTable)
      .innerJoin(
        paymentGatewaysTable,
        eq(siteGatewayLinksTable.gatewayId, paymentGatewaysTable.id),
      )
      .where(eq(siteGatewayLinksTable.siteId, siteId));

    res.json(links.map((l) => l.gateway));
  } catch (err) {
    logger.error({ err }, "Failed to get site gateways");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Provider auto-detector ─────────────────────────────────────────────────────
function guessProvider(domain: string): string {
  const d = domain.toLowerCase();
  if (d.includes("zarinpal")) return "ZarinPal";
  if (d.includes("zibal")) return "Zibal";
  if (d.includes("idpay")) return "IDPay";
  if (d.includes("nextpay")) return "NextPay";
  if (d.includes("vandar")) return "Vandar";
  if (d.includes("mellat") || d.includes("behpardakht")) return "Mellat";
  if (d.includes("sep") || d.includes("shaparak") || d.includes("saman")) return "SEP/Saman";
  if (d.includes("sadad")) return "Sadad";
  if (d.includes("parsian") || d.includes("pec.ir")) return "Parsian";
  if (d.includes("digipay")) return "DigiPay";
  if (d.includes("asanpardakht") || d.includes("asan")) return "Asan Pardakht";
  if (d.includes("irankish")) return "IranKish";
  if (d.includes("pay.ir")) return "Pay.ir";
  return "other";
}

export default router;
