import {
  db,
  incidentsTable,
  type Site,
  type Check,
  type Incident,
} from "@workspace/db";
import { and, eq, inArray, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { logEvent } from "./logger";
import { alertIncidentOpened, alertIncidentResolved } from "./alerts";
import { getCachedSettings } from "../services/settings";
import { emitConsoleEvent } from "./console-events";
import { broadcastSse } from "../services/sse-broadcast";

type Severity = "info" | "warning" | "critical";

const TYPE_FROM_ERROR: Record<string, string> = {
  dns_failure: "dns_failure",
  network: "network_issue",
  timeout: "timeout",
  ssl_issue: "ssl_issue",
  server_error: "application_issue",
  application_issue: "application_issue",
  client_error: "application_issue",
  slow: "latency_issue",
  latency_issue: "latency_issue",
};

function classifyIncidentType(check: Check): string {
  if (check.errorType && TYPE_FROM_ERROR[check.errorType]) {
    return TYPE_FROM_ERROR[check.errorType]!;
  }
  if (check.overallStatus === "slow") return "latency_issue";
  if (check.overallStatus === "degraded") return "application_issue";
  return "unknown";
}

function classifySeverity(check: Check, failureCount: number): Severity {
  if (check.overallStatus === "down") {
    return failureCount >= 5 ? "critical" : "warning";
  }
  if (check.overallStatus === "degraded") return "warning";
  if (check.overallStatus === "slow") return "info";
  return "info";
}

function buildTitle(site: Site, check: Check, type: string): string {
  const labels: Record<string, string> = {
    dns_failure: "DNS resolution failing",
    application_issue: "Application returning errors",
    network_issue: "Network unreachable",
    timeout: "Request timing out",
    ssl_issue: "SSL certificate problem",
    latency_issue: "Elevated latency",
    unknown: "Site unhealthy",
  };
  const label = labels[type] || labels["unknown"]!;
  return `${label} on ${site.name}`;
}

// Track consecutive states in-memory (cheap, rebuilt on restart)
const failureStreak = new Map<number, number>();
const successStreak = new Map<number, number>();

export function getStreaks(siteId: number): { fail: number; success: number } {
  return {
    fail: failureStreak.get(siteId) ?? 0,
    success: successStreak.get(siteId) ?? 0,
  };
}

export function resetStreaks(siteId: number): void {
  failureStreak.delete(siteId);
  successStreak.delete(siteId);
}

export async function processCheckResult(site: Site, check: Check): Promise<void> {
  if (check.overallStatus === "blocked") {
    return;
  }

  const settings = getCachedSettings();
  const FAILURE_THRESHOLD = settings.failureThreshold;
  const RECOVERY_THRESHOLD = settings.recoveryThreshold;

  const isFailure = check.overallStatus === "down";

  if (isFailure) {
    const fails = (failureStreak.get(site.id) ?? 0) + 1;
    failureStreak.set(site.id, fails);
    successStreak.set(site.id, 0);

    emitConsoleEvent({
      type: "incident",
      level: fails >= FAILURE_THRESHOLD ? "warn" : "debug",
      siteId: site.id,
      siteName: site.name,
      message: `failure ${fails}/${FAILURE_THRESHOLD} — ${check.errorMessage ?? check.errorType ?? "down"}`,
      details: { fails, threshold: FAILURE_THRESHOLD, errorType: check.errorType },
    });

    const existing = await db
      .select()
      .from(incidentsTable)
      .where(
        and(
          eq(incidentsTable.siteId, site.id),
          inArray(incidentsTable.status, ["open", "acknowledged"]),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const incident = existing[0]!;
      await db
        .update(incidentsTable)
        .set({
          failureCount: incident.failureCount + 1,
          lastFailureAt: check.timestamp,
          severity: classifySeverity(check, fails),
          updatedAt: new Date(),
        })
        .where(eq(incidentsTable.id, incident.id));
      return;
    }

    if (fails < FAILURE_THRESHOLD) return;

    const incidentType = classifyIncidentType(check);
    const severity = classifySeverity(check, fails);
    const title = buildTitle(site, check, incidentType);
    const description = check.errorMessage ?? null;

    const [openedRow] = await db
      .insert(incidentsTable)
      .values({
        siteId: site.id,
        incidentType,
        severity,
        status: "open",
        title,
        description,
        failureCount: fails,
        lastFailureAt: check.timestamp,
      })
      .returning();
    logger.warn({ siteId: site.id, type: incidentType, severity }, "Incident opened");
    logEvent(
      severity === "critical" ? "error" : "warn",
      "incident",
      `Incident opened: ${title} [${severity}]`,
      { siteId: site.id, details: { incidentType, severity, failureCount: fails, description } },
    );
    emitConsoleEvent({
      type: "incident",
      level: severity === "critical" ? "error" : "warn",
      siteId: site.id,
      siteName: site.name,
      message: `incident OPEN — ${incidentType} (${severity})`,
      details: { incidentType, severity, failureCount: fails },
    });
    if (openedRow) {
      broadcastSse({
        type: "incident_new",
        id: openedRow.id,
        siteId: site.id,
        siteName: site.name,
        severity: openedRow.severity,
        incidentType: openedRow.incidentType,
        title: openedRow.title,
        startedAt: openedRow.startedAt.toISOString(),
      });
      await alertIncidentOpened(site, openedRow);
    }
  } else {
    const successes = (successStreak.get(site.id) ?? 0) + 1;
    successStreak.set(site.id, successes);
    failureStreak.set(site.id, 0);

    emitConsoleEvent({
      type: "incident",
      level: "debug",
      siteId: site.id,
      siteName: site.name,
      message: `success ${successes}/${RECOVERY_THRESHOLD}`,
      details: { successes, threshold: RECOVERY_THRESHOLD },
    });

    if (successes >= RECOVERY_THRESHOLD) {
      const open = await db
        .select()
        .from(incidentsTable)
        .where(
          and(
            eq(incidentsTable.siteId, site.id),
            inArray(incidentsTable.status, ["open", "acknowledged"]),
          ),
        );
      for (const inc of open) {
        const resolvedAt = new Date();
        const resolvedReason = `Auto-resolved after ${RECOVERY_THRESHOLD} consecutive successful checks`;
        const resolvedBy = "system";
        const resolvedFromCheckId = check.id;
        await db
          .update(incidentsTable)
          .set({
            status: "resolved",
            resolvedAt,
            resolvedReason,
            resolvedBy,
            resolvedFromCheckId,
            updatedAt: resolvedAt,
          })
          .where(eq(incidentsTable.id, inc.id));
        logger.info({ incidentId: inc.id, siteId: site.id }, "Incident auto-resolved");
        logEvent("info", "incident", `Incident auto-resolved: ${inc.title}`, {
          siteId: site.id,
          details: { incidentId: inc.id, type: inc.incidentType, resolvedFromCheckId },
        });
        emitConsoleEvent({
          type: "incident",
          level: "info",
          siteId: site.id,
          siteName: site.name,
          message: `incident RESOLVED — ${inc.incidentType}`,
          details: { incidentId: inc.id, after: RECOVERY_THRESHOLD },
        });
        broadcastSse({
          type: "incident_resolved",
          id: inc.id,
          siteId: site.id,
          siteName: site.name,
          severity: inc.severity,
          incidentType: inc.incidentType,
          title: inc.title,
          resolvedAt: resolvedAt.toISOString(),
        });
        await alertIncidentResolved(site, {
          ...inc,
          status: "resolved",
          resolvedAt,
          resolvedReason,
          resolvedBy,
          resolvedFromCheckId,
          updatedAt: resolvedAt,
        });
      }
    }
  }
}

export async function getOpenIncidentForSite(
  siteId: number,
): Promise<Incident | null> {
  const rows = await db
    .select()
    .from(incidentsTable)
    .where(
      and(
        eq(incidentsTable.siteId, siteId),
        inArray(incidentsTable.status, ["open", "acknowledged"]),
      ),
    )
    .orderBy(desc(incidentsTable.startedAt))
    .limit(1);
  return rows[0] ?? null;
}
