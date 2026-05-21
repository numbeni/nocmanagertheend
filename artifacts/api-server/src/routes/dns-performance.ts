import { Router, type IRouter } from "express";
import { db, dnsResolverTestsTable, sitesTable } from "@workspace/db";
import { gte, sql, desc, eq } from "drizzle-orm";
import { getAllResolvers, BUILT_IN_RESOLVERS } from "../monitoring/dns";

const router: IRouter = Router();

function getRangeSince(range: string): Date {
  const now = Date.now();
  const map: Record<string, number> = {
    "1h": 1 * 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
  };
  return new Date(now - (map[range] ?? map["24h"]!));
}

function computeScore(successRate: number, avgLatencyMs: number | null, timeoutRate: number): number {
  const latencyScore = avgLatencyMs != null
    ? Math.max(0, 100 - avgLatencyMs / 8)
    : 0;
  const stabilityScore = Math.max(0, 100 - timeoutRate * 2);
  return Math.round(successRate * 0.5 + latencyScore * 0.35 + stabilityScore * 0.15);
}

// GET /api/dns-performance/ranking?range=24h
router.get("/dns-performance/ranking", async (req, res) => {
  const range = String(req.query["range"] ?? "24h");
  const since = getRangeSince(range);
  const builtInAddresses = new Set(BUILT_IN_RESOLVERS.map((r) => r.address));

  const rows = await db
    .select({
      resolverName: dnsResolverTestsTable.resolverName,
      resolverAddress: dnsResolverTestsTable.resolverAddress,
      totalTests: sql<number>`count(*)::int`,
      successCount: sql<number>`sum(case when ${dnsResolverTestsTable.success} then 1 else 0 end)::int`,
      avgLatencyMs: sql<number | null>`avg(case when ${dnsResolverTestsTable.success} then ${dnsResolverTestsTable.latencyMs} else null end)`,
      minLatencyMs: sql<number | null>`min(case when ${dnsResolverTestsTable.success} then ${dnsResolverTestsTable.latencyMs} else null end)::int`,
      maxLatencyMs: sql<number | null>`max(case when ${dnsResolverTestsTable.success} then ${dnsResolverTestsTable.latencyMs} else null end)::int`,
    })
    .from(dnsResolverTestsTable)
    .where(gte(dnsResolverTestsTable.testedAt, since))
    .groupBy(dnsResolverTestsTable.resolverName, dnsResolverTestsTable.resolverAddress)
    .orderBy(desc(sql`count(*)`));

  const resolvers = rows.map((r, idx) => {
    const successRate = r.totalTests > 0 ? (r.successCount / r.totalTests) * 100 : 0;
    const timeoutCount = r.totalTests - r.successCount;
    const timeoutRate = r.totalTests > 0 ? (timeoutCount / r.totalTests) * 100 : 0;
    const avgMs = r.avgLatencyMs != null ? Math.round(Number(r.avgLatencyMs)) : null;
    const score = computeScore(successRate, avgMs, timeoutRate);
    return {
      rank: idx + 1,
      name: r.resolverName,
      address: r.resolverAddress,
      builtIn: builtInAddresses.has(r.resolverAddress),
      totalTests: r.totalTests,
      successCount: r.successCount,
      failCount: timeoutCount,
      successRate: Math.round(successRate * 10) / 10,
      avgLatencyMs: avgMs,
      minLatencyMs: r.minLatencyMs,
      maxLatencyMs: r.maxLatencyMs,
      timeoutCount,
      timeoutRate: Math.round(timeoutRate * 10) / 10,
      score,
    };
  });

  // Sort by score descending, re-rank
  resolvers.sort((a, b) => b.score - a.score);
  resolvers.forEach((r, i) => { r.rank = i + 1; });

  const totalTests = resolvers.reduce((s, r) => s + r.totalTests, 0);

  res.json({ range, totalTests, resolvers });
});

// GET /api/dns-performance/sites?range=24h
router.get("/dns-performance/sites", async (req, res) => {
  const range = String(req.query["range"] ?? "24h");
  const since = getRangeSince(range);

  const rows = await db
    .select({
      siteId: dnsResolverTestsTable.siteId,
      resolverName: dnsResolverTestsTable.resolverName,
      resolverAddress: dnsResolverTestsTable.resolverAddress,
      totalTests: sql<number>`count(*)::int`,
      successCount: sql<number>`sum(case when ${dnsResolverTestsTable.success} then 1 else 0 end)::int`,
      avgLatencyMs: sql<number | null>`avg(case when ${dnsResolverTestsTable.success} then ${dnsResolverTestsTable.latencyMs} else null end)`,
    })
    .from(dnsResolverTestsTable)
    .where(gte(dnsResolverTestsTable.testedAt, since))
    .groupBy(
      dnsResolverTestsTable.siteId,
      dnsResolverTestsTable.resolverName,
      dnsResolverTestsTable.resolverAddress,
    );

  const sites = await db.select().from(sitesTable);
  const siteMap = new Map(sites.map((s) => [s.id, s]));

  // For each site, find the best resolver by success rate then latency
  const bysite = new Map<number, typeof rows>();
  for (const r of rows) {
    if (r.siteId == null) continue;
    const bucket = bysite.get(r.siteId) ?? [];
    bucket.push(r);
    bysite.set(r.siteId, bucket);
  }

  const result = [];
  for (const [siteId, resolvers] of bysite.entries()) {
    const site = siteMap.get(siteId);
    if (!site) continue;
    const best = resolvers.sort((a, b) => {
      const aRate = a.totalTests > 0 ? a.successCount / a.totalTests : 0;
      const bRate = b.totalTests > 0 ? b.successCount / b.totalTests : 0;
      if (bRate !== aRate) return bRate - aRate;
      const aLatency = a.avgLatencyMs != null ? Number(a.avgLatencyMs) : 9999;
      const bLatency = b.avgLatencyMs != null ? Number(b.avgLatencyMs) : 9999;
      return aLatency - bLatency;
    })[0]!;

    const successRate = best.totalTests > 0 ? (best.successCount / best.totalTests) * 100 : 0;
    result.push({
      siteId,
      siteName: site.name,
      host: site.host,
      bestResolver: best.resolverName,
      bestResolverAddress: best.resolverAddress,
      successRate: Math.round(successRate * 10) / 10,
      avgLatencyMs: best.avgLatencyMs != null ? Math.round(Number(best.avgLatencyMs)) : null,
      totalTests: best.totalTests,
    });
  }

  result.sort((a, b) => a.siteName.localeCompare(b.siteName));
  res.json({ range, sites: result });
});

// POST /api/dns-performance/test  — test all resolvers + optional extra resolver
router.post("/dns-performance/test", async (req, res) => {
  const domain = String(req.body?.domain ?? "").trim().replace(/^https?:\/\//, "").split("/")[0] ?? "";
  const siteId: number | null = Number.isFinite(Number(req.body?.siteId)) && req.body?.siteId != null
    ? Number(req.body.siteId) : null;
  // Optional extra resolver address to test alongside the built-in/custom ones
  const additionalResolver: string | null =
    typeof req.body?.additionalResolver === "string" && req.body.additionalResolver.trim()
      ? req.body.additionalResolver.trim()
      : null;

  if (!domain) {
    res.status(400).json({ error: "domain is required" });
    return;
  }

  const all = await getAllResolvers();

  // Inject the additional resolver if provided and not already in the list
  if (additionalResolver) {
    const { isValidResolverAddress } = await import("../monitoring/dns");
    if (!isValidResolverAddress(additionalResolver)) {
      res.status(400).json({ error: "additionalResolver must be a valid IPv4/IPv6 address" });
      return;
    }
    const already = all.some((r) => r.address === additionalResolver);
    if (!already) {
      all.push({ id: -1, name: `Extra (${additionalResolver})`, address: additionalResolver, builtIn: false });
    }
  }

  const results = await Promise.all(
    all.map(async (entry) => {
      const start = Date.now();
      try {
        const { Resolver } = await import("node:dns/promises");
        const resolver = new Resolver({ timeout: 5000, tries: 1 });
        resolver.setServers([entry.address]);
        const addresses = await resolver.resolve4(domain);
        const latencyMs = Date.now() - start;
        if (addresses.length === 0) {
          await db.insert(dnsResolverTestsTable).values({
            resolverName: entry.name,
            resolverAddress: entry.address,
            domain,
            siteId,
            success: false,
            latencyMs,
            resolvedIp: null,
            errorMessage: "No A records",
            source: "manual",
          }).catch(() => {});
          return {
            resolverName: entry.name,
            resolverAddress: entry.address,
            builtIn: entry.builtIn,
            success: false,
            latencyMs: null,
            resolvedIp: null,
            error: "No A records",
          };
        }
        await db.insert(dnsResolverTestsTable).values({
          resolverName: entry.name,
          resolverAddress: entry.address,
          domain,
          siteId,
          success: true,
          latencyMs,
          resolvedIp: addresses[0] ?? null,
          errorMessage: null,
          source: "manual",
        }).catch(() => {});
        return {
          resolverName: entry.name,
          resolverAddress: entry.address,
          builtIn: entry.builtIn,
          success: true,
          latencyMs,
          resolvedIp: addresses[0] ?? null,
          error: null,
        };
      } catch (err) {
        const latencyMs = Date.now() - start;
        const errorMessage = err instanceof Error ? err.message : String(err);
        await db.insert(dnsResolverTestsTable).values({
          resolverName: entry.name,
          resolverAddress: entry.address,
          domain,
          siteId,
          success: false,
          latencyMs,
          resolvedIp: null,
          errorMessage,
          source: "manual",
        }).catch(() => {});
        return {
          resolverName: entry.name,
          resolverAddress: entry.address,
          builtIn: entry.builtIn,
          success: false,
          latencyMs: null,
          resolvedIp: null,
          error: errorMessage,
        };
      }
    }),
  );

  res.json({ domain, results });
});

// GET /api/dns-performance/resolver-coverage?range=24h
// For each resolver: which sites it's the best performer on right now
router.get("/dns-performance/resolver-coverage", async (req, res) => {
  const range = String(req.query["range"] ?? "24h");
  const since = getRangeSince(range);
  const builtInAddresses = new Set(BUILT_IN_RESOLVERS.map((r) => r.address));

  const rows = await db
    .select({
      siteId: dnsResolverTestsTable.siteId,
      resolverName: dnsResolverTestsTable.resolverName,
      resolverAddress: dnsResolverTestsTable.resolverAddress,
      totalTests: sql<number>`count(*)::int`,
      successCount: sql<number>`sum(case when ${dnsResolverTestsTable.success} then 1 else 0 end)::int`,
      avgLatencyMs: sql<number | null>`avg(case when ${dnsResolverTestsTable.success} then ${dnsResolverTestsTable.latencyMs} else null end)`,
    })
    .from(dnsResolverTestsTable)
    .where(gte(dnsResolverTestsTable.testedAt, since))
    .groupBy(dnsResolverTestsTable.siteId, dnsResolverTestsTable.resolverName, dnsResolverTestsTable.resolverAddress);

  const sites = await db.select().from(sitesTable);
  const siteMap = new Map(sites.map((s) => [s.id, s]));

  // For each site, find the best resolver
  const bysite = new Map<number, typeof rows>();
  for (const r of rows) {
    if (r.siteId == null) continue;
    const bucket = bysite.get(r.siteId) ?? [];
    bucket.push(r);
    bysite.set(r.siteId, bucket);
  }

  // Map: resolverAddress → { meta, sites[] }
  type CoverageEntry = {
    resolverName: string;
    resolverAddress: string;
    builtIn: boolean;
    sites: { siteId: number; siteName: string; host: string; successRate: number; avgLatencyMs: number | null }[];
  };
  const resolverMap = new Map<string, CoverageEntry>();

  for (const [siteId, resolvers] of bysite.entries()) {
    const site = siteMap.get(siteId);
    if (!site) continue;
    const best = [...resolvers].sort((a, b) => {
      const aRate = a.totalTests > 0 ? a.successCount / a.totalTests : 0;
      const bRate = b.totalTests > 0 ? b.successCount / b.totalTests : 0;
      if (bRate !== aRate) return bRate - aRate;
      return (a.avgLatencyMs != null ? Number(a.avgLatencyMs) : 9999)
        - (b.avgLatencyMs != null ? Number(b.avgLatencyMs) : 9999);
    })[0]!;

    const key = best.resolverAddress;
    const entry = resolverMap.get(key) ?? {
      resolverName: best.resolverName,
      resolverAddress: best.resolverAddress,
      builtIn: builtInAddresses.has(best.resolverAddress),
      sites: [],
    };
    const successRate = best.totalTests > 0 ? (best.successCount / best.totalTests) * 100 : 0;
    entry.sites.push({
      siteId,
      siteName: site.name,
      host: site.host,
      successRate: Math.round(successRate * 10) / 10,
      avgLatencyMs: best.avgLatencyMs != null ? Math.round(Number(best.avgLatencyMs)) : null,
    });
    resolverMap.set(key, entry);
  }

  const result = Array.from(resolverMap.values())
    .map((r) => ({ ...r, totalSites: r.sites.length, sites: r.sites.sort((a, b) => a.siteName.localeCompare(b.siteName)) }))
    .sort((a, b) => b.totalSites - a.totalSites);

  res.json({ range, resolvers: result });
});

export default router;
