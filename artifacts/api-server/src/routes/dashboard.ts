import { Router, type IRouter } from "express";
import { db, sitesTable, checksTable, incidentsTable, eventLogsTable } from "@workspace/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res) => {
  // Latest check per site (using DISTINCT ON)
  const latestPerSite: Array<{
    siteId: number;
    name: string;
    host: string;
    overallStatus: string;
    responseTimeMs: number | null;
    sslDaysRemaining: number | null;
  }> = await db.execute(sql`
    SELECT DISTINCT ON (s.id)
      s.id AS "siteId",
      s.name AS "name",
      s.host AS "host",
      c.overall_status AS "overallStatus",
      c.response_time_ms AS "responseTimeMs",
      c.ssl_days_remaining AS "sslDaysRemaining"
    FROM sites s
    LEFT JOIN checks c ON c.site_id = s.id
    ORDER BY s.id, c.timestamp DESC NULLS LAST
  `).then((r: any) => r.rows ?? r);

  const totalSites = latestPerSite.length;
  let upCount = 0,
    downCount = 0,
    slowCount = 0,
    degradedCount = 0;
  let respSum = 0,
    respN = 0;
  const sslExpiringSoon: Array<{
    siteId: number;
    name: string;
    host: string;
    daysRemaining: number;
  }> = [];

  for (const s of latestPerSite) {
    switch (s.overallStatus) {
      case "up":
        upCount++;
        break;
      case "down":
        downCount++;
        break;
      case "slow":
        slowCount++;
        break;
      case "degraded":
        degradedCount++;
        break;
      default:
        break;
    }
    if (s.responseTimeMs != null) {
      respSum += Number(s.responseTimeMs);
      respN++;
    }
    if (s.sslDaysRemaining != null && s.sslDaysRemaining <= 30) {
      sslExpiringSoon.push({
        siteId: s.siteId,
        name: s.name,
        host: s.host,
        daysRemaining: Number(s.sslDaysRemaining),
      });
    }
  }
  sslExpiringSoon.sort((a, b) => a.daysRemaining - b.daysRemaining);

  // Open & critical incidents
  const incRows = await db
    .select({
      open: sql<number>`COUNT(*) FILTER (WHERE ${incidentsTable.status} IN ('open','acknowledged'))::int`,
      critical: sql<number>`COUNT(*) FILTER (WHERE ${incidentsTable.status} IN ('open','acknowledged') AND ${incidentsTable.severity} = 'critical')::int`,
    })
    .from(incidentsTable);
  const openIncidents = incRows[0]?.open ?? 0;
  const criticalIncidents = incRows[0]?.critical ?? 0;

  // Avg uptime over last 24h across all sites
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const upRows = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      up: sql<number>`COUNT(*) FILTER (WHERE ${checksTable.overallStatus} = 'up')::int`,
    })
    .from(checksTable)
    .where(gte(checksTable.timestamp, since));
  const upR = upRows[0];
  const avgUptime24h =
    upR && upR.total > 0
      ? Math.round((upR.up / upR.total) * 10000) / 100
      : 100;

  res.json({
    totalSites,
    upCount,
    downCount,
    slowCount,
    degradedCount,
    openIncidents,
    criticalIncidents,
    avgResponseTimeMs: respN > 0 ? Math.round(respSum / respN) : null,
    avgUptime24h,
    sslExpiringSoon: sslExpiringSoon.slice(0, 8),
    lastUpdatedAt: new Date().toISOString(),
  });
});

router.get("/dashboard/recent-activity", async (req, res) => {
  const limit = Math.min(Number(req.query["limit"] ?? 30), 200);

  // Combine recent incidents (opened, acknowledged, resolved) and recent failed checks
  const incidents = await db
    .select({ incident: incidentsTable, site: sitesTable })
    .from(incidentsTable)
    .innerJoin(sitesTable, eq(sitesTable.id, incidentsTable.siteId))
    .orderBy(desc(incidentsTable.startedAt))
    .limit(limit);

  const events: Array<{
    id: string;
    kind: string;
    siteId: number;
    siteName: string;
    timestamp: string;
    message: string;
    severity: string;
  }> = [];

  for (const r of incidents) {
    events.push({
      id: `inc-open-${r.incident.id}`,
      kind: "incident_opened",
      siteId: r.site.id,
      siteName: r.site.name,
      timestamp: r.incident.startedAt.toISOString(),
      message: r.incident.title,
      severity: r.incident.severity,
    });
    if (r.incident.acknowledgedAt) {
      events.push({
        id: `inc-ack-${r.incident.id}`,
        kind: "incident_acknowledged",
        siteId: r.site.id,
        siteName: r.site.name,
        timestamp: r.incident.acknowledgedAt.toISOString(),
        message: `Acknowledged: ${r.incident.title}`,
        severity: "info",
      });
    }
    if (r.incident.resolvedAt) {
      events.push({
        id: `inc-res-${r.incident.id}`,
        kind: "incident_resolved",
        siteId: r.site.id,
        siteName: r.site.name,
        timestamp: r.incident.resolvedAt.toISOString(),
        message: `Resolved: ${r.incident.title}`,
        severity: "info",
      });
    }
  }

  // Recent non-up checks
  const failedChecks = await db
    .select({ check: checksTable, site: sitesTable })
    .from(checksTable)
    .innerJoin(sitesTable, eq(sitesTable.id, checksTable.siteId))
    .where(inArray(checksTable.overallStatus, ["down", "slow", "degraded"]))
    .orderBy(desc(checksTable.timestamp))
    .limit(limit);

  for (const r of failedChecks) {
    events.push({
      id: `chk-${r.check.id}`,
      kind: "check",
      siteId: r.site.id,
      siteName: r.site.name,
      timestamp: r.check.timestamp.toISOString(),
      message:
        r.check.errorMessage ||
        `${r.check.overallStatus.toUpperCase()} (HTTP ${r.check.httpStatus ?? "—"})`,
      severity:
        r.check.overallStatus === "down"
          ? "critical"
          : r.check.overallStatus === "degraded"
            ? "warning"
            : "info",
    });
  }

  // Recent event log entries (warn/error level)
  const recentLogs = await db
    .select()
    .from(eventLogsTable)
    .where(inArray(eventLogsTable.level, ["warn", "error"]))
    .orderBy(desc(eventLogsTable.timestamp))
    .limit(limit);

  for (const log of recentLogs) {
    events.push({
      id: `log-${log.id}`,
      kind: "event_log",
      siteId: log.siteId ?? 0,
      siteName: "",
      timestamp: log.timestamp.toISOString(),
      message: log.message,
      severity: log.level === "error" ? "critical" : "warning",
    });
  }

  events.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  res.json(events.slice(0, limit));
});

// Map a human-friendly range token to (windowMinutes, bucketSeconds).
// Bucket sizes are chosen so a single response is always ≲ 60 points,
// keeping the chart responsive for 7-day ranges as well.
const RANGE_PRESETS: Record<string, { minutes: number; bucketSec: number }> = {
  "30m": { minutes: 30, bucketSec: 60 },        // ~30 points
  "1h":  { minutes: 60, bucketSec: 60 },        // ~60 points
  "12h": { minutes: 12 * 60, bucketSec: 15 * 60 }, // ~48 points
  "24h": { minutes: 24 * 60, bucketSec: 30 * 60 }, // ~48 points
  "7d":  { minutes: 7 * 24 * 60, bucketSec: 3 * 3600 }, // ~56 points
};

router.get("/dashboard/latency-trend", async (req, res) => {
  // New API: ?range=30m|1h|12h|24h|7d
  // Legacy:  ?hours=N  (kept for backward compatibility with older clients)
  const rangeParam = typeof req.query["range"] === "string" ? req.query["range"] : null;
  let windowMinutes: number;
  let bucketSec: number;

  if (rangeParam && RANGE_PRESETS[rangeParam]) {
    const preset = RANGE_PRESETS[rangeParam]!;
    windowMinutes = preset.minutes;
    bucketSec = preset.bucketSec;
  } else {
    const hours = Math.min(Math.max(Number(req.query["hours"] ?? 24), 1), 168);
    windowMinutes = hours * 60;
    bucketSec = hours >= 24 * 7 ? 3 * 3600 : hours >= 24 ? 1800 : hours >= 6 ? 300 : 60;
  }

  const since = new Date(Date.now() - windowMinutes * 60 * 1000);

  const rows: Array<{
    bucket: Date;
    avgMs: number | null;
    p95Ms: number | null;
    upCount: number;
    downCount: number;
  }> = await db.execute(sql`
    SELECT
      to_timestamp(floor(extract(epoch from timestamp) / ${bucketSec}) * ${bucketSec}) AS bucket,
      AVG(response_time_ms)::float AS "avgMs",
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)::float AS "p95Ms",
      COUNT(*) FILTER (WHERE overall_status = 'up')::int AS "upCount",
      COUNT(*) FILTER (WHERE overall_status IN ('down','degraded'))::int AS "downCount"
    FROM checks
    WHERE timestamp >= ${since}
    GROUP BY bucket
    ORDER BY bucket ASC
  `).then((r: any) => r.rows ?? r);

  res.json(
    rows.map((r) => ({
      bucket: new Date(r.bucket).toISOString(),
      avgMs: r.avgMs !== null ? Math.round(Number(r.avgMs)) : null,
      p95Ms: r.p95Ms !== null ? Math.round(Number(r.p95Ms)) : null,
      upCount: Number(r.upCount),
      downCount: Number(r.downCount),
    })),
  );
});

// ─── Check Stats Trend ──────────────────────────────────────────────────────
// Returns per-bucket aggregates: upCount, downCount, slowCount, dnsFailCount,
// sslWarnCount, totalCount, avgMs, errorRate, uptimePct.
// All derived from the `checks` table — no schema change needed.
router.get("/dashboard/check-stats-trend", async (req, res) => {
  const rangeParam = typeof req.query["range"] === "string" ? req.query["range"] : null;
  const preset =
    rangeParam && RANGE_PRESETS[rangeParam]
      ? RANGE_PRESETS[rangeParam]!
      : RANGE_PRESETS["24h"]!;
  const { minutes, bucketSec } = preset;
  const since = new Date(Date.now() - minutes * 60 * 1000);

  const rows: Array<{
    bucket: Date;
    upCount: number;
    downCount: number;
    slowCount: number;
    dnsFailCount: number;
    sslWarnCount: number;
    totalCount: number;
    avgMs: number | null;
  }> = await db
    .execute(
      sql`
      SELECT
        to_timestamp(floor(extract(epoch from timestamp) / ${bucketSec}) * ${bucketSec}) AS bucket,
        COUNT(*) FILTER (WHERE overall_status = 'up')::int                                            AS "upCount",
        COUNT(*) FILTER (WHERE overall_status IN ('down','degraded'))::int                            AS "downCount",
        COUNT(*) FILTER (WHERE overall_status = 'slow')::int                                          AS "slowCount",
        COUNT(*) FILTER (WHERE dns_status ILIKE 'fail%' OR dns_status ILIKE '%error%'
                                 OR dns_status = 'timeout')::int                                      AS "dnsFailCount",
        COUNT(*) FILTER (WHERE ssl_days_remaining IS NOT NULL AND ssl_days_remaining < 30)::int        AS "sslWarnCount",
        COUNT(*)::int                                                                                  AS "totalCount",
        AVG(response_time_ms)::float                                                                   AS "avgMs"
      FROM checks
      WHERE timestamp >= ${since}
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
    )
    .then((r: any) => r.rows ?? r);

  res.json(
    rows.map((r) => {
      const total = Number(r.totalCount);
      const down = Number(r.downCount);
      const up = Number(r.upCount);
      return {
        bucket: new Date(r.bucket).toISOString(),
        upCount: up,
        downCount: down,
        slowCount: Number(r.slowCount),
        dnsFailCount: Number(r.dnsFailCount),
        sslWarnCount: Number(r.sslWarnCount),
        totalCount: total,
        avgMs: r.avgMs !== null ? Math.round(Number(r.avgMs)) : null,
        errorRate: total > 0 ? Math.round((down / total) * 1000) / 10 : 0,
        uptimePct: total > 0 ? Math.round((up / total) * 1000) / 10 : 100,
      };
    }),
  );
});

// ─── Incident Trend ──────────────────────────────────────────────────────────
// Returns per-bucket incident opened vs resolved counts.
router.get("/dashboard/incident-trend", async (req, res) => {
  const rangeParam = typeof req.query["range"] === "string" ? req.query["range"] : null;
  const preset =
    rangeParam && RANGE_PRESETS[rangeParam]
      ? RANGE_PRESETS[rangeParam]!
      : RANGE_PRESETS["24h"]!;
  const { minutes, bucketSec } = preset;
  const since = new Date(Date.now() - minutes * 60 * 1000);
  // For wide ranges use larger buckets so charts stay readable
  const effectiveBucketSec = minutes >= 7 * 24 * 60 ? 24 * 3600 : bucketSec;

  const created: Array<{ bucket: Date; createdCount: number }> = await db
    .execute(
      sql`
      SELECT
        to_timestamp(floor(extract(epoch from started_at) / ${effectiveBucketSec}) * ${effectiveBucketSec}) AS bucket,
        COUNT(*)::int AS "createdCount"
      FROM incidents
      WHERE started_at >= ${since}
      GROUP BY bucket
    `,
    )
    .then((r: any) => r.rows ?? r);

  const resolved: Array<{ bucket: Date; resolvedCount: number }> = await db
    .execute(
      sql`
      SELECT
        to_timestamp(floor(extract(epoch from resolved_at) / ${effectiveBucketSec}) * ${effectiveBucketSec}) AS bucket,
        COUNT(*)::int AS "resolvedCount"
      FROM incidents
      WHERE resolved_at IS NOT NULL AND resolved_at >= ${since}
      GROUP BY bucket
    `,
    )
    .then((r: any) => r.rows ?? r);

  const bucketMap = new Map<string, { createdCount: number; resolvedCount: number }>();
  for (const r of created) {
    const key = new Date(r.bucket).toISOString();
    bucketMap.set(key, { createdCount: Number(r.createdCount), resolvedCount: 0 });
  }
  for (const r of resolved) {
    const key = new Date(r.bucket).toISOString();
    const existing = bucketMap.get(key) ?? { createdCount: 0, resolvedCount: 0 };
    bucketMap.set(key, { ...existing, resolvedCount: Number(r.resolvedCount) });
  }

  const merged = Array.from(bucketMap.entries())
    .map(([bucket, counts]) => ({ bucket, ...counts }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));

  res.json(merged);
});

// ─── Top Unstable Sites ───────────────────────────────────────────────────────
// Returns the 10 sites with the most non-up checks in the given range.
router.get("/dashboard/top-unstable-sites", async (req, res) => {
  const rangeParam = typeof req.query["range"] === "string" ? req.query["range"] : null;
  const preset =
    rangeParam && RANGE_PRESETS[rangeParam]
      ? RANGE_PRESETS[rangeParam]!
      : RANGE_PRESETS["24h"]!;
  const { minutes } = preset;
  const since = new Date(Date.now() - minutes * 60 * 1000);

  const rows: Array<{
    id: number;
    name: string;
    host: string;
    failCount: number;
    totalCount: number;
  }> = await db
    .execute(
      sql`
      SELECT
        s.id,
        s.name,
        s.host,
        COUNT(*) FILTER (WHERE c.overall_status != 'up')::int AS "failCount",
        COUNT(*)::int                                          AS "totalCount"
      FROM sites s
      JOIN checks c ON c.site_id = s.id
      WHERE c.timestamp >= ${since}
      GROUP BY s.id, s.name, s.host
      HAVING COUNT(*) FILTER (WHERE c.overall_status != 'up') > 0
      ORDER BY "failCount" DESC
      LIMIT 10
    `,
    )
    .then((r: any) => r.rows ?? r);

  res.json(
    rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      host: r.host,
      failCount: Number(r.failCount),
      totalCount: Number(r.totalCount),
      failRate:
        Number(r.totalCount) > 0
          ? Math.round((Number(r.failCount) / Number(r.totalCount)) * 1000) / 10
          : 0,
    })),
  );
});

export default router;
