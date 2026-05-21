/**
 * In-memory ring buffer of monitoring events.
 *
 * Distinct from `event_logs` (which is the user-facing chronological audit
 * log). This buffer powers the "Live Console" page — short-lived,
 * high-frequency events (sweep started, site checking, dns ok, http ok, ssl
 * warn, incident decision, alert decision) — without hammering the DB.
 *
 * Capacity: 500 entries (oldest pruned on overflow).
 * Cursor : monotonically-increasing event id; clients pass `since` to poll.
 */

export type ConsoleEventType =
  | "cycle"
  | "site"
  | "dns"
  | "http"
  | "ssl"
  | "tcp"
  | "incident"
  | "alert"
  | "system"
  | "connectivity";

export type ConsoleEventLevel = "debug" | "info" | "warn" | "error";

export interface ConsoleEvent {
  id: number;
  ts: string;
  type: ConsoleEventType;
  level: ConsoleEventLevel;
  message: string;
  siteId?: number;
  siteName?: string;
  details?: Record<string, unknown>;
}

const MAX = 500;
const buffer: ConsoleEvent[] = [];
let nextId = 1;

export function emitConsoleEvent(input: Omit<ConsoleEvent, "id" | "ts">): ConsoleEvent {
  const ev: ConsoleEvent = {
    id: nextId++,
    ts: new Date().toISOString(),
    ...input,
  };
  buffer.push(ev);
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
  return ev;
}

export interface ConsoleQuery {
  since?: number;
  types?: ConsoleEventType[];
  limit?: number;
}

export function getConsoleEvents(query: ConsoleQuery = {}): {
  events: ConsoleEvent[];
  cursor: number;
} {
  const since = query.since ?? 0;
  const types = query.types && query.types.length > 0 ? new Set(query.types) : null;
  const limit = Math.max(1, Math.min(500, query.limit ?? 200));

  let out = buffer.filter((e) => e.id > since);
  if (types) out = out.filter((e) => types.has(e.type));
  if (out.length > limit) out = out.slice(out.length - limit);

  const cursor = buffer.length > 0 ? buffer[buffer.length - 1]!.id : since;
  return { events: out, cursor };
}

export function clearConsoleEvents(): void {
  buffer.splice(0, buffer.length);
}
