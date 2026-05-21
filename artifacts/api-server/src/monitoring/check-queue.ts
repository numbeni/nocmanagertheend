import { logger } from "../lib/logger";

export interface StaggeredOptions {
  /** Max parallel workers. Default 1 (strictly serial). */
  concurrency?: number;
  /** Min ms to wait between starting items. Default 2000. */
  minDelayMs?: number;
  /** Max ms to wait between starting items (random in [min,max]). Default 5000. */
  maxDelayMs?: number;
  /** Optional human label for log lines. */
  label?: string;
}

export interface StaggeredSummary {
  total: number;
  ok: number;
  failed: number;
  durationMs: number;
}

/**
 * Run `worker(item)` for each item with a small delay between starts and a
 * tight concurrency cap. Designed for bulk-import / "check-all" flows where
 * we want to AVOID stampeding herds (every site failing because the host
 * couldn't keep up with 50 parallel DNS lookups).
 *
 * - never throws: per-item errors are logged and counted.
 * - never blocks the caller: invoke without awaiting if you want fire-and-forget.
 */
export async function runStaggered<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  opts: StaggeredOptions = {},
): Promise<StaggeredSummary> {
  const concurrency = Math.max(1, opts.concurrency ?? 1);
  const minDelay = Math.max(0, opts.minDelayMs ?? 2000);
  const maxDelay = Math.max(minDelay, opts.maxDelayMs ?? 5000);
  const label = opts.label ?? "queue";

  const start = Date.now();
  let ok = 0;
  let failed = 0;
  let cursor = 0;

  function nextDelay(): number {
    if (maxDelay === minDelay) return minDelay;
    return minDelay + Math.floor(Math.random() * (maxDelay - minDelay + 1));
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function loop(workerId: number) {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      const item = items[idx]!;
      try {
        await worker(item, idx);
        ok++;
      } catch (err) {
        failed++;
        logger.warn(
          { err, workerId, index: idx, label },
          `[queue:${label}] item failed`,
        );
      }
      // Stagger between starts even within the same worker.
      if (cursor < items.length) await sleep(nextDelay());
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    (_, w) => loop(w),
  );
  await Promise.all(workers);

  const durationMs = Date.now() - start;
  logger.info(
    { label, total: items.length, ok, failed, durationMs },
    `[queue:${label}] finished`,
  );
  return { total: items.length, ok, failed, durationMs };
}
