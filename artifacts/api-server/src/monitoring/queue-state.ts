/**
 * In-memory monitoring queue tracker — two-layer system.
 *
 * Layer 1 — Current Queue (_items):
 *   Sites being processed in the active sweep. Stays visible after completion
 *   so operators can always see what happened in the last cycle.
 *
 * Layer 2 — Next Cycle (_nextCycleItems):
 *   Sites scheduled for the upcoming sweep. Populated right after a sweep
 *   finishes so the UI can show "what's coming up" during the countdown.
 *   Cleared when the next sweep begins.
 *
 * Resets on server restart (intentional — live operational state only).
 */

export type QueueItemState =
  | "waiting"
  | "checking"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export type QueueItemSource = "auto" | "manual" | "bulk-import";

export interface QueueItem {
  siteId: number;
  siteName: string;
  host: string;
  url: string;
  position: number;
  state: QueueItemState;
  source: QueueItemSource;
  enqueuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
}

export interface NextCycleItem {
  siteId: number;
  siteName: string;
  host: string;
  url: string;
}

export interface QueueSnapshot {
  label: string | null;
  startedAt: string | null;
  completedAt: string | null;
  isCompleted: boolean;
  totalCount: number;
  waitingCount: number;
  checkingCount: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  cancelledCount: number;
  items: QueueItem[];
  /** Sites that will be checked in the NEXT monitoring cycle. */
  nextCycleItems: NextCycleItem[];
}

interface QueueSite {
  id: number;
  name: string;
  host: string;
  url: string;
}

let _label: string | null = null;
let _startedAt: Date | null = null;
let _completedAt: Date | null = null;
let _isCompleted = false;
let _items: QueueItem[] = [];
let _nextCycleItems: NextCycleItem[] = [];

function nowIso(): string {
  return new Date().toISOString();
}

export function setQueue(label: string, sites: QueueSite[]): void {
  _label = label;
  _startedAt = new Date();
  _completedAt = null;
  _isCompleted = false;
  _nextCycleItems = []; // clear next-cycle preview when a new sweep starts
  const ts = _startedAt.toISOString();
  _items = sites.map((site, idx) => ({
    siteId: site.id,
    siteName: site.name,
    host: site.host,
    url: site.url,
    position: idx + 1,
    state: "waiting",
    source: "auto",
    enqueuedAt: ts,
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
  }));
}

/**
 * Populate the next-cycle preview list.
 * Called right after a sweep completes — engines sets this so the UI
 * shows what will be checked during the countdown period.
 */
export function setNextCycleQueue(sites: QueueSite[]): void {
  _nextCycleItems = sites.map((s) => ({
    siteId: s.id,
    siteName: s.name,
    host: s.host,
    url: s.url,
  }));
}

/** Clear the next-cycle preview (e.g. when monitoring is paused). */
export function clearNextCycleQueue(): void {
  _nextCycleItems = [];
}

/**
 * Manually enqueue a single site at the FRONT of the waiting queue.
 * If the site is already in the queue in a waiting state, it is moved to
 * position 1. If it is currently being checked or already completed/failed,
 * a fresh entry is prepended at position 1 so it runs next.
 * If no active queue exists, creates one labelled "manual".
 */
export function addManualSite(site: QueueSite): { added: boolean; reason?: string } {
  if (!_label || _isCompleted) {
    _label = "manual";
    _startedAt = new Date();
    _completedAt = null;
    _isCompleted = false;
    _items = [];
  }

  // Remove any existing entry for this site that is still waiting
  // (don't remove if currently checking — let it finish naturally).
  const existingIdx = _items.findIndex(
    (it) => it.siteId === site.id && it.state === "waiting",
  );
  if (existingIdx !== -1) {
    _items.splice(existingIdx, 1);
  }

  // Shift all current waiting items' positions up by 1
  for (const it of _items) {
    if (it.state === "waiting") {
      it.position += 1;
    }
  }

  // Insert at position 1 (front)
  _items.unshift({
    siteId: site.id,
    siteName: site.name,
    host: site.host,
    url: site.url,
    position: 1,
    state: "waiting",
    source: "manual",
    enqueuedAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
  });

  return { added: true };
}

export function markChecking(siteId: number): void {
  const item = _items.find((it) => it.siteId === siteId);
  if (!item) return;
  item.state = "checking";
  item.startedAt = nowIso();
}

export function markCompleted(siteId: number): void {
  const item = _items.find((it) => it.siteId === siteId);
  if (!item) return;
  item.state = "completed";
  item.finishedAt = nowIso();
}

export function markFailed(siteId: number, errorMessage: string): void {
  const item = _items.find((it) => it.siteId === siteId);
  if (!item) return;
  item.state = "failed";
  item.finishedAt = nowIso();
  item.errorMessage = errorMessage;
}

/**
 * Mark a waiting item as skipped (e.g. monitoring paused before it ran).
 * Only transitions waiting → skipped; already-started items are not affected.
 */
export function markSkipped(siteId: number): void {
  const item = _items.find((it) => it.siteId === siteId);
  if (!item) return;
  if (item.state === "waiting") {
    item.state = "skipped";
    item.finishedAt = nowIso();
  }
}

/**
 * Mark a checking or waiting item as cancelled (pause triggered mid-check).
 */
export function markCancelled(siteId: number): void {
  const item = _items.find((it) => it.siteId === siteId);
  if (!item) return;
  if (item.state === "checking" || item.state === "waiting") {
    item.state = "cancelled";
    item.finishedAt = nowIso();
  }
}

/**
 * Mark ALL still-waiting items as skipped.
 * Called in the sweep finally-block when a cancel was requested.
 */
export function skipAllWaiting(): void {
  const ts = nowIso();
  for (const item of _items) {
    if (item.state === "waiting") {
      item.state = "skipped";
      item.finishedAt = ts;
    }
  }
}

/** Mark the current cycle as finished — queue stays visible until next sweep. */
export function markQueueCompleted(): void {
  _isCompleted = true;
  _completedAt = new Date();
}

/** Full reset — only used on server startup or explicit admin action. */
export function clearQueue(): void {
  _label = null;
  _startedAt = null;
  _completedAt = null;
  _isCompleted = false;
  _items = [];
  _nextCycleItems = [];
}

export function getQueueSnapshot(): QueueSnapshot {
  let waiting = 0;
  let checking = 0;
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let cancelled = 0;
  for (const it of _items) {
    if (it.state === "waiting") waiting++;
    else if (it.state === "checking") checking++;
    else if (it.state === "completed") completed++;
    else if (it.state === "failed") failed++;
    else if (it.state === "skipped") skipped++;
    else if (it.state === "cancelled") cancelled++;
  }
  return {
    label: _label,
    startedAt: _startedAt?.toISOString() ?? null,
    completedAt: _completedAt?.toISOString() ?? null,
    isCompleted: _isCompleted,
    totalCount: _items.length,
    waitingCount: waiting,
    checkingCount: checking,
    completedCount: completed,
    failedCount: failed,
    skippedCount: skipped,
    cancelledCount: cancelled,
    items: _items.map((it) => ({ ...it })),
    nextCycleItems: [..._nextCycleItems],
  };
}
