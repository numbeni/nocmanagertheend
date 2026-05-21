import { Router, type IRouter } from "express";
import { db, dnsResolversTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  BUILT_IN_RESOLVERS,
  isValidResolverAddress,
  type ResolverEntry,
} from "../monitoring/dns";
import { logEvent } from "../monitoring/logger";
import { auditFromRequest } from "../services/audit";

const router: IRouter = Router();

router.get("/dns-resolvers", async (_req, res) => {
  const customRows = await db.select().from(dnsResolversTable);
  const custom: ResolverEntry[] = customRows.map((r) => ({
    id: r.id,
    name: r.name,
    address: r.address,
    builtIn: false,
  }));
  res.json({
    builtIn: BUILT_IN_RESOLVERS,
    custom,
  });
});

router.post("/dns-resolvers", async (req, res) => {
  const text: unknown = req.body?.text;
  if (typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "Field 'text' is required" });
    return;
  }

  // Split on newlines OR commas; allow optional "name=ip" entries.
  const tokens = text
    .split(/[\n,]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const builtInAddresses = new Set(BUILT_IN_RESOLVERS.map((r) => r.address));
  const existingRows = await db.select().from(dnsResolversTable);
  const existingByAddress = new Map(existingRows.map((r) => [r.address, r]));

  const added: ResolverEntry[] = [];
  const skipped: { value: string; reason: string }[] = [];
  const seenInBatch = new Set<string>();

  for (const raw of tokens) {
    let name: string;
    let address: string;
    if (raw.includes("=")) {
      const parts = raw.split("=");
      name = (parts[0] ?? "").trim();
      address = (parts[1] ?? "").trim();
    } else {
      address = raw;
      name = `Custom (${raw})`;
    }
    if (!isValidResolverAddress(address)) {
      skipped.push({ value: raw, reason: "invalid IP address" });
      continue;
    }
    if (seenInBatch.has(address)) {
      skipped.push({ value: raw, reason: "duplicate in input" });
      continue;
    }
    seenInBatch.add(address);
    if (builtInAddresses.has(address)) {
      skipped.push({ value: raw, reason: "already in built-in defaults" });
      continue;
    }
    if (existingByAddress.has(address)) {
      skipped.push({ value: raw, reason: "already added" });
      continue;
    }
    if (!name) name = `Custom (${address})`;
    try {
      const [row] = await db
        .insert(dnsResolversTable)
        .values({ name, address })
        .returning();
      if (row) {
        added.push({
          id: row.id,
          name: row.name,
          address: row.address,
          builtIn: false,
        });
      }
    } catch (err) {
      skipped.push({
        value: raw,
        reason: err instanceof Error ? err.message : "insert failed",
      });
    }
  }

  if (added.length > 0) {
    logEvent(
      "info",
      "dns",
      `Added ${added.length} custom DNS resolver(s)`,
      { details: { added: added.map((a) => a.address) } },
    );
    void auditFromRequest(req, {
      action: "add_dns_resolvers",
      resource: "dns_resolver",
      details: { added: added.map((a) => ({ name: a.name, address: a.address })), count: added.length },
    });
  }
  res.json({ added, skipped });
});

router.delete("/dns-resolvers/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const rows = await db
    .select()
    .from(dnsResolversTable)
    .where(eq(dnsResolversTable.id, id))
    .limit(1);
  const target = rows[0];
  if (!target) {
    res.status(404).json({ error: "Resolver not found" });
    return;
  }
  await db.delete(dnsResolversTable).where(eq(dnsResolversTable.id, id));
  logEvent("info", "dns", `Removed custom DNS resolver ${target.address}`);
  void auditFromRequest(req, {
    action: "delete_dns_resolver",
    resource: "dns_resolver",
    resourceId: String(id),
    details: { name: target.name, address: target.address },
  });
  res.status(204).send();
});

export default router;
