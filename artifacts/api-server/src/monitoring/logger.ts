import { db, eventLogsTable } from "@workspace/db";
import { logger as pinoLogger } from "../lib/logger";

type Level = "debug" | "info" | "warn" | "error";
type Category = "system" | "monitor" | "incident" | "api" | "dns";

interface LogOptions {
  siteId?: number | null;
  details?: unknown;
}

const buffer: Array<{
  timestamp: Date;
  level: Level;
  category: Category;
  siteId: number | null;
  message: string;
  details: string | null;
}> = [];

let flushing = false;

async function flush() {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  const batch = buffer.splice(0, buffer.length);
  try {
    await db.insert(eventLogsTable).values(batch);
  } catch (err) {
    pinoLogger.error({ err }, "Failed to persist event logs");
  } finally {
    flushing = false;
  }
}

setInterval(() => {
  flush().catch(() => {});
}, 2000);

export function logEvent(
  level: Level,
  category: Category,
  message: string,
  options: LogOptions = {},
): void {
  const entry = {
    timestamp: new Date(),
    level,
    category,
    siteId: options.siteId ?? null,
    message,
    details: options.details ? JSON.stringify(options.details) : null,
  };
  buffer.push(entry);

  const logFn =
    level === "error"
      ? pinoLogger.error.bind(pinoLogger)
      : level === "warn"
        ? pinoLogger.warn.bind(pinoLogger)
        : pinoLogger.info.bind(pinoLogger);
  logFn({ category, siteId: entry.siteId, details: options.details }, message);

  if (buffer.length >= 50) {
    flush().catch(() => {});
  }
}
