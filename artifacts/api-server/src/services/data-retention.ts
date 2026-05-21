import {
  db,
  checksTable,
  eventLogsTable,
  auditLogsTable,
  importantAlertsTable,
  telegramAlertsTable,
} from "@workspace/db";
import { lt } from "drizzle-orm";
import { logger } from "../lib/logger";

export interface RetentionConfig {
  checksRetentionDays: number;
  eventLogRetentionDays: number;
  auditLogRetentionDays: number;
  alertRetentionDays: number;
}

function cutoff(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function runDataRetentionCleanup(cfg: RetentionConfig): Promise<void> {
  logger.info({ cfg }, "Data retention cleanup started");

  if (cfg.checksRetentionDays > 0) {
    const c = cutoff(cfg.checksRetentionDays);
    await db.delete(checksTable).where(lt(checksTable.timestamp, c));
    logger.info({ days: cfg.checksRetentionDays }, "Data retention: cleaned checks");
  }

  if (cfg.eventLogRetentionDays > 0) {
    const c = cutoff(cfg.eventLogRetentionDays);
    await db.delete(eventLogsTable).where(lt(eventLogsTable.timestamp, c));
    logger.info({ days: cfg.eventLogRetentionDays }, "Data retention: cleaned event_logs");
  }

  if (cfg.auditLogRetentionDays > 0) {
    const c = cutoff(cfg.auditLogRetentionDays);
    await db.delete(auditLogsTable).where(lt(auditLogsTable.timestamp, c));
    logger.info({ days: cfg.auditLogRetentionDays }, "Data retention: cleaned audit_logs");
  }

  if (cfg.alertRetentionDays > 0) {
    const c = cutoff(cfg.alertRetentionDays);
    await db.delete(importantAlertsTable).where(lt(importantAlertsTable.sentAt, c));
    await db.delete(telegramAlertsTable).where(lt(telegramAlertsTable.sentAt, c));
    logger.info({ days: cfg.alertRetentionDays }, "Data retention: cleaned alert history");
  }

  logger.info("Data retention cleanup complete");
}
