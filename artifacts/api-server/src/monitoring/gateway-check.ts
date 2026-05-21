import { checkHttp } from "./http";
import {
  db,
  paymentGatewaysTable,
  paymentGatewayChecksTable,
  type PaymentGateway,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { isNextcloudTalkConfigured, sendImportantAlert } from "../services/important-alerts";

export interface GatewayCheckResult {
  dnsStatus: "ok" | "failed" | "timeout";
  dnsResolveMs: number | null;
  resolvedIp: string | null;
  sslStatus: string | null;
  sslDaysRemaining: number | null;
  sslIssuer: string | null;
  httpStatus: number | null;
  httpResponseTimeMs: number | null;
  httpCheckStatus: "ok" | "slow" | "down" | "error" | null;
  paymentPageStatus: number | null;
  paymentPageResponseTimeMs: number | null;
  paymentPageCheckStatus: "ok" | "slow" | "down" | "error" | null;
  overallStatus: "up" | "degraded" | "down" | "unknown";
  errorMessage: string | null;
}

function deriveHttpCheckStatus(
  httpStatus: number | null,
  responseTimeMs: number | null,
): "ok" | "slow" | "down" | "error" {
  if (httpStatus === null) return "down";
  if (httpStatus >= 500) return "error";
  if (httpStatus >= 400) return "error";
  if (responseTimeMs && responseTimeMs > 5000) return "slow";
  return "ok";
}

function deriveOverallStatus(
  httpCheckStatus: "ok" | "slow" | "down" | "error" | null,
  paymentPageCheckStatus: "ok" | "slow" | "down" | "error" | null,
): "up" | "degraded" | "down" | "unknown" {
  if (httpCheckStatus === "down" || httpCheckStatus === "error") return "down";
  if (
    httpCheckStatus === "slow" ||
    paymentPageCheckStatus === "error" ||
    paymentPageCheckStatus === "down" ||
    paymentPageCheckStatus === "slow"
  ) return "degraded";
  if (httpCheckStatus === "ok") return "up";
  return "unknown";
}

async function doSingleGatewayCheck(gateway: PaymentGateway): Promise<GatewayCheckResult> {
  const mainUrl = gateway.baseDomain.startsWith("http")
    ? gateway.baseDomain
    : `https://${gateway.baseDomain}`;

  let httpStatus: number | null = null;
  let httpResponseTimeMs: number | null = null;
  let httpCheckStatus: "ok" | "slow" | "down" | "error" | null = null;
  let errorMessage: string | null = null;

  try {
    const http = await checkHttp(mainUrl);
    httpStatus = http.httpStatus;
    httpResponseTimeMs = http.responseTimeMs;
    httpCheckStatus = deriveHttpCheckStatus(http.httpStatus, http.responseTimeMs);
  } catch (err) {
    httpCheckStatus = "down";
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  // Payment page check (if configured)
  let paymentPageStatus: number | null = null;
  let paymentPageResponseTimeMs: number | null = null;
  let paymentPageCheckStatus: "ok" | "slow" | "down" | "error" | null = null;

  if (gateway.paymentPageUrl) {
    try {
      const http = await checkHttp(gateway.paymentPageUrl);
      paymentPageStatus = http.httpStatus;
      paymentPageResponseTimeMs = http.responseTimeMs;
      paymentPageCheckStatus = deriveHttpCheckStatus(http.httpStatus, http.responseTimeMs);
    } catch {
      paymentPageCheckStatus = "down";
    }
  }

  const overallStatus = deriveOverallStatus(httpCheckStatus, paymentPageCheckStatus);

  return {
    dnsStatus: "ok",
    dnsResolveMs: null,
    resolvedIp: null,
    sslStatus: null,
    sslDaysRemaining: null,
    sslIssuer: null,
    httpStatus,
    httpResponseTimeMs,
    httpCheckStatus,
    paymentPageStatus,
    paymentPageResponseTimeMs,
    paymentPageCheckStatus,
    overallStatus,
    errorMessage,
  };
}

/**
 * Run a gateway check with one automatic retry on failure.
 * If the first attempt returns "down" or "unknown", wait 4 seconds and retry once.
 * This prevents transient network hiccups from triggering false alarms.
 */
export async function runGatewayCheck(gateway: PaymentGateway): Promise<GatewayCheckResult> {
  const first = await doSingleGatewayCheck(gateway);
  if (first.overallStatus === "down" || first.overallStatus === "unknown") {
    logger.info({ gatewayId: gateway.id, domain: gateway.baseDomain, firstResult: first.overallStatus }, "Gateway check failed — retrying once after 4s");
    await new Promise((r) => setTimeout(r, 4_000));
    return doSingleGatewayCheck(gateway);
  }
  return first;
}

export async function runAndPersistGatewayCheck(gateway: PaymentGateway): Promise<GatewayCheckResult> {
  let result: GatewayCheckResult;
  try {
    result = await runGatewayCheck(gateway);
  } catch (err) {
    result = {
      dnsStatus: "failed",
      dnsResolveMs: null,
      resolvedIp: null,
      sslStatus: null,
      sslDaysRemaining: null,
      sslIssuer: null,
      httpStatus: null,
      httpResponseTimeMs: null,
      httpCheckStatus: "down",
      paymentPageStatus: null,
      paymentPageResponseTimeMs: null,
      paymentPageCheckStatus: null,
      overallStatus: "unknown",
      errorMessage: err instanceof Error ? err.message : "Unknown error",
    };
  }

  // Persist check record
  await db.insert(paymentGatewayChecksTable).values({
    gatewayId: gateway.id,
    dnsStatus: result.dnsStatus,
    dnsResolveMs: result.dnsResolveMs,
    resolvedIp: result.resolvedIp,
    sslStatus: result.sslStatus,
    sslDaysRemaining: result.sslDaysRemaining,
    sslIssuer: result.sslIssuer,
    httpStatus: result.httpStatus,
    httpResponseTimeMs: result.httpResponseTimeMs,
    httpCheckStatus: result.httpCheckStatus,
    paymentPageStatus: result.paymentPageStatus,
    paymentPageResponseTimeMs: result.paymentPageResponseTimeMs,
    paymentPageCheckStatus: result.paymentPageCheckStatus,
    overallStatus: result.overallStatus,
    errorMessage: result.errorMessage,
  });

  // Update gateway status
  await db
    .update(paymentGatewaysTable)
    .set({
      status: result.overallStatus,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(paymentGatewaysTable.id, gateway.id));

  return result;
}

export async function runAllGatewayChecks(): Promise<void> {
  const gateways = await db
    .select()
    .from(paymentGatewaysTable)
    .then((rows) => rows.filter((g) => g.enabled));

  logger.info({ count: gateways.length }, "Running gateway health checks");

  const alertsEnabled = isNextcloudTalkConfigured();

  for (const gw of gateways) {
    const prevStatus = gw.status; // status before this check
    try {
      const result = await runAndPersistGatewayCheck(gw);
      if (alertsEnabled) {
        if (result.overallStatus === "down" && prevStatus !== "down") {
          sendImportantAlert({
            type: "gateway_down",
            severity: "critical",
            siteName: gw.name,
            details: { domain: gw.baseDomain, httpStatus: result.httpStatus, error: result.errorMessage },
          }).catch(() => {});
        } else if (result.overallStatus === "up" && prevStatus === "down") {
          sendImportantAlert({
            type: "gateway_recovered",
            severity: "info",
            siteName: gw.name,
            details: { domain: gw.baseDomain },
          }).catch(() => {});
        }
      }
    } catch (err) {
      logger.error({ err, gatewayId: gw.id, domain: gw.baseDomain }, "Gateway check failed");
    }
  }

  logger.info("Gateway health checks complete");
}
