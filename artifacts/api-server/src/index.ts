import app from "./app";
import { logger } from "./lib/logger";
import { startMonitoringScheduler, startCurlScheduler, startSslScheduler } from "./monitoring/engine";
import { startConnectivityScheduler } from "./services/connectivity";
import { loadSitesFromFile } from "./monitoring/sites-loader";
import { getSettings } from "./services/settings";
import { sweepStalePresence, cleanupExpiredSessions, autoLogoutStaleUsers } from "./services/auth";
import { runAllGatewayChecks } from "./monitoring/gateway-check";
import { runDataRetentionCleanup } from "./services/data-retention";
import { readRetention } from "./routes/retention";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");

  try {
    await loadSitesFromFile();
  } catch (err) {
    logger.error({ err }, "Failed to load sites from file");
  }

  // Resolve monitor interval. Precedence:
  //   1. app_settings.monitorIntervalMs (operator-controlled, live-updatable)
  //   2. MONITOR_INTERVAL_MS / MONITOR_INTERVAL_SECONDS env vars
  //   3. default 120_000ms (2 min), minimum 30_000ms.
  const settings = await getSettings(true);
  logger.info(
    { intervalMs: settings.monitorIntervalMs },
    "Monitor interval resolved",
  );
  startMonitoringScheduler(settings.monitorIntervalMs);
  startCurlScheduler();
  startSslScheduler();
  startConnectivityScheduler().catch((err) =>
    logger.warn({ err }, "Connectivity scheduler startup failed"),
  );

  // Run gateway health checks on startup (with delay so app is fully ready)
  setTimeout(() => {
    runAllGatewayChecks().catch((err) =>
      logger.warn({ err }, "Initial gateway check sweep failed"),
    );
  }, 15_000);

  // Gateway checks every 12 hours
  setInterval(() => {
    runAllGatewayChecks().catch((err) =>
      logger.warn({ err }, "Scheduled gateway check sweep failed"),
    );
  }, 12 * 60 * 60 * 1000);

  // Sweep stale presence every 60s (marks users offline after 5 min of no heartbeat)
  setInterval(() => {
    sweepStalePresence().catch((err) => logger.warn({ err }, "sweepStalePresence failed"));
  }, 60_000);

  // Auto-logout users who have been inactive for 1 hour — runs every 5 min
  setInterval(() => {
    autoLogoutStaleUsers().catch((err) => logger.warn({ err }, "autoLogoutStaleUsers failed"));
  }, 5 * 60 * 1000);

  // Clean up expired sessions every 6 hours
  setInterval(() => {
    cleanupExpiredSessions().catch((err) => logger.warn({ err }, "cleanupExpiredSessions failed"));
  }, 6 * 60 * 60 * 1000);

  // Data retention cleanup — runs once at startup (after 5 min delay) then every 24 hours
  const runRetention = () =>
    readRetention()
      .then((cfg) => runDataRetentionCleanup(cfg))
      .catch((err) => logger.warn({ err }, "Data retention cleanup failed"));

  setTimeout(runRetention, 5 * 60 * 1000);
  setInterval(runRetention, 24 * 60 * 60 * 1000);
});
