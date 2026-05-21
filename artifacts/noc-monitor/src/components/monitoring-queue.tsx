import { useEffect, useMemo, useRef, useState } from "react";
import {
  useGetMonitoringQueue,
  getGetMonitoringQueueUrl,
  useGetMonitorLiveState,
  getGetMonitorLiveStateQueryKey,
  useGetMonitorStatus,
  getGetMonitorStatusQueryKey,
  useGetAppSettings,
  getGetAppSettingsQueryKey,
  type MonitoringQueueItem,
  type MonitoringQueueSnapshot,
  type MonitoringNextCycleItem,
} from "@workspace/api-client-react";
import {
  CheckCircle2,
  Loader2,
  Hourglass,
  XCircle,
  ListChecks,
  Clock,
  UserCheck,
  Bot,
  CalendarClock,
  PauseCircle,
  Upload,
  ChevronDown,
  ChevronUp,
  PlayCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`,
  );
}

function formatCountdown(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

function StateBadge({ state }: { state: MonitoringQueueItem["state"] }) {
  const { t } = useT();
  switch (state) {
    case "checking":
      return (
        <Badge className="gap-1 bg-primary/15 text-primary border border-primary/30 hover:bg-primary/15">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("queue.state.checking")}
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="outline" className="gap-1 text-success border-success/40">
          <CheckCircle2 className="h-3 w-3" />
          {t("queue.state.completed")}
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="outline" className="gap-1 text-destructive border-destructive/40">
          <XCircle className="h-3 w-3" />
          {t("queue.state.failed")}
        </Badge>
      );
    case "skipped":
      return (
        <Badge variant="outline" className="gap-1 text-muted-foreground border-muted-foreground/30">
          <XCircle className="h-3 w-3" />
          {t("queue.state.skipped") || "Skipped"}
        </Badge>
      );
    case "cancelled":
      return (
        <Badge variant="outline" className="gap-1 text-orange-600 dark:text-orange-400 border-orange-400/40">
          <XCircle className="h-3 w-3" />
          {t("queue.state.cancelled") || "Cancelled"}
        </Badge>
      );
    case "waiting":
    default:
      return (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <Hourglass className="h-3 w-3" />
          {t("queue.state.waiting")}
        </Badge>
      );
  }
}

function SourceBadge({ source }: { source: MonitoringQueueItem["source"] }) {
  const { t } = useT();
  if (source === "manual") {
    return (
      <Badge
        variant="outline"
        className="gap-1 text-xs text-violet-600 dark:text-violet-400 border-violet-300 dark:border-violet-600/50 bg-violet-50 dark:bg-violet-900/20 hover:bg-violet-100"
      >
        <UserCheck className="h-2.5 w-2.5" />
        {t("queue.source.manual") || "Manual"}
      </Badge>
    );
  }
  if (source === "bulk-import") {
    return (
      <Badge
        variant="outline"
        className="gap-1 text-xs text-sky-600 dark:text-sky-400 border-sky-300 dark:border-sky-600/50 bg-sky-50 dark:bg-sky-900/20"
      >
        <Upload className="h-2.5 w-2.5" />
        {t("queue.source.bulkImport") || "Bulk Import"}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 text-xs text-muted-foreground border-border/50"
    >
      <Bot className="h-2.5 w-2.5" />
      {t("queue.source.auto") || "Auto"}
    </Badge>
  );
}

function durationMs(item: MonitoringQueueItem): number | null {
  if (!item.startedAt) return null;
  const start = new Date(item.startedAt).getTime();
  const end = item.finishedAt ? new Date(item.finishedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleTimeString();
}

function labelFor(label: string | null, t: (k: string) => string): string {
  if (label === "scheduled-sweep") return t("queue.label.scheduledSweep");
  if (label === "run-check-all") return t("queue.label.runCheckAll");
  if (label === "manual") return t("queue.label.manual") || "Manual";
  return t("queue.label.unknown");
}

/** Compact chip list for next-cycle sites with expand/collapse. */
function NextCycleList({ items }: { items: MonitoringNextCycleItem[] }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const PREVIEW = 12;

  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic px-1">
        {t("queue.nextCycleEmpty")}
      </p>
    );
  }

  const visible = expanded ? items : items.slice(0, PREVIEW);
  const hidden = items.length - PREVIEW;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {visible.map((item) => (
          <span
            key={item.siteId}
            className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/70 transition-colors"
            title={item.url}
          >
            {item.siteName}
          </span>
        ))}
        {!expanded && hidden > 0 && (
          <button
            onClick={() => setExpanded(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/60 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
          >
            +{hidden} more
            <ChevronDown className="h-3 w-3" />
          </button>
        )}
        {expanded && hidden > 0 && (
          <button
            onClick={() => setExpanded(false)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/60 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
          >
            <ChevronUp className="h-3 w-3" />
            show less
          </button>
        )}
      </div>
    </div>
  );
}

export function MonitoringQueue() {
  const { t } = useT();
  const { toast } = useToast();
  const [runNextCyclePending, setRunNextCyclePending] = useState(false);
  const [runManualPending, setRunManualPending] = useState(false);

  async function handleRunNextCycle() {
    setRunNextCyclePending(true);
    try {
      const res = await fetch("/api/monitor/run-next-cycle", {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        toast({ title: t("queue.runNextCycleTriggered") });
      } else {
        toast({ title: t("queue.runNextCycleError"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("queue.runNextCycleError"), variant: "destructive" });
    } finally {
      setRunNextCyclePending(false);
    }
  }

  async function handleRunManualQueue() {
    setRunManualPending(true);
    try {
      const res = await fetch("/api/monitor/run-manual-queue", {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        toast({ title: t("queue.runNextCycleTriggered") });
      } else {
        toast({ title: t("queue.runNextCycleError"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("queue.runNextCycleError"), variant: "destructive" });
    } finally {
      setRunManualPending(false);
    }
  }

  const { data: queue } = useGetMonitoringQueue({
    query: {
      queryKey: [getGetMonitoringQueueUrl()],
      refetchInterval: 1500,
      staleTime: 1000,
      refetchOnWindowFocus: false,
    },
  });

  const { data: monitorStatus } = useGetMonitorStatus({
    query: {
      queryKey: getGetMonitorStatusQueryKey(),
      refetchInterval: 5000,
      staleTime: 3000,
    },
  });

  const { data: liveState } = useGetMonitorLiveState({
    query: {
      queryKey: getGetMonitorLiveStateQueryKey(),
      refetchInterval: 2000,
      staleTime: 1500,
    },
  });

  const { data: appSettings } = useGetAppSettings({
    query: {
      queryKey: getGetAppSettingsQueryKey(),
      refetchInterval: 30000,
      staleTime: 15000,
    },
  });

  const nextSweepAt = useMemo(() => {
    if (!liveState?.lastSweepCompletedAt || !appSettings?.monitorIntervalMs) return null;
    return new Date(liveState.lastSweepCompletedAt).getTime() + appSettings.monitorIntervalMs;
  }, [liveState?.lastSweepCompletedAt, appSettings?.monitorIntervalMs]);

  const [countdownMs, setCountdownMs] = useState<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (!nextSweepAt) {
      setCountdownMs(null);
      return;
    }
    const tick = () => setCountdownMs(Math.max(0, nextSweepAt - Date.now()));
    tick();
    tickRef.current = setInterval(tick, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [nextSweepAt]);

  const sortedItems = useMemo(() => {
    if (!queue?.items) return [];
    const order: Record<MonitoringQueueItem["state"], number> = {
      checking: 0,
      waiting: 1,
      failed: 2,
      cancelled: 3,
      skipped: 4,
      completed: 5,
    };
    return [...queue.items].sort((a, b) => {
      const diff = order[a.state] - order[b.state];
      if (diff !== 0) return diff;
      return a.position - b.position;
    });
  }, [queue]);

  const isActivelyChecking = Boolean(liveState?.currentSiteId);
  const isPaused = Boolean(monitorStatus?.paused);
  const hasManualWaiting = sortedItems.some(
    (item) => item.source === "manual" && item.state === "waiting",
  );

  // Cast to access fields added in this session (typegen already ran, but guard for safety)
  const snap = queue as (MonitoringQueueSnapshot & {
    isCompleted?: boolean;
    completedAt?: string | null;
    nextCycleItems?: MonitoringNextCycleItem[];
    skippedCount?: number;
    cancelledCount?: number;
  }) | undefined;

  const isCompleted = snap?.isCompleted ?? false;
  const nextCycleItems: MonitoringNextCycleItem[] = snap?.nextCycleItems ?? [];
  const hasQueueItems = Boolean(queue && queue.totalCount > 0);
  const hasNextCycle = nextCycleItems.length > 0 && !isPaused;

  const countdownText = useMemo(() => {
    if (isPaused) return t("queue.monitorPaused");
    if (isActivelyChecking) return t("queue.activelySweeping");
    if (countdownMs === null) return t("queue.waitingFirst");
    if (countdownMs <= 0) return t("queue.startingSoon");
    return `${t("queue.nextCycleIn")} ${formatCountdown(countdownMs)}`;
  }, [isPaused, isActivelyChecking, countdownMs, t]);

  const countdownUrgent = !isPaused && !isActivelyChecking && countdownMs !== null && countdownMs <= 10000;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" />
            {t("queue.title")}
          </CardTitle>
          <CardDescription>{t("queue.subtitle")}</CardDescription>
        </div>

        <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground shrink-0">
          {hasQueueItems && queue && (
            <>
              <span className="font-medium text-foreground">{labelFor(queue.label, t)}</span>
              <span dir="ltr">
                {fmt(t("queue.totals"), {
                  checking: queue.checkingCount,
                  waiting: queue.waitingCount,
                  completed: queue.completedCount,
                  failed: queue.failedCount,
                })}
              </span>
            </>
          )}
          <div
            className={cn(
              "flex items-center gap-1.5 mt-0.5 text-xs font-medium tabular-nums",
              isActivelyChecking
                ? "text-primary"
                : isPaused
                  ? "text-muted-foreground"
                  : countdownUrgent
                    ? "text-warning"
                    : "text-muted-foreground",
            )}
            dir="ltr"
          >
            {isPaused ? (
              <PauseCircle className="h-3 w-3 shrink-0" />
            ) : (
              <Clock className="h-3 w-3 shrink-0" />
            )}
            {countdownText}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {/* Paused banner */}
        {isPaused && (
          <div className="flex items-center gap-2 rounded-lg border border-orange-200 dark:border-orange-800/60 bg-orange-50 dark:bg-orange-900/20 px-3 py-2 text-xs text-orange-700 dark:text-orange-400">
            <PauseCircle className="h-4 w-4 shrink-0" />
            {t("queue.pausedBanner")}
          </div>
        )}

        {/* Current cycle table — show when there are items */}
        {hasQueueItems ? (
          <div>
            {isCompleted && (
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {t("queue.lastCycleLabel")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {fmt(t("queue.lastCycleSummary"), {
                    done: snap?.completedCount ?? 0,
                    skipped: (snap?.skippedCount ?? 0) + (snap?.cancelledCount ?? 0),
                    failed: snap?.failedCount ?? 0,
                  })}
                </span>
              </div>
            )}
            {!isCompleted && (
              <div className="flex items-center justify-between gap-2 mb-2 px-1">
                <span className="text-xs font-semibold text-primary uppercase tracking-wide flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("queue.currentCycle")}
                </span>
                {hasManualWaiting && !isActivelyChecking && !isPaused && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs gap-1"
                    disabled={runManualPending}
                    onClick={handleRunManualQueue}
                    title={t("queue.runCurrentCycle")}
                  >
                    {runManualPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <PlayCircle className="h-3 w-3" />
                    )}
                    {t("queue.runCurrentCycle")}
                  </Button>
                )}
              </div>
            )}
            <div className="max-h-[280px] overflow-y-auto rounded-md border border-border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
                  <TableRow>
                    <TableHead className="w-10 text-center">#</TableHead>
                    <TableHead>{t("queue.col.site")}</TableHead>
                    <TableHead>{t("queue.col.state")}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t("queue.source.label") || "Source"}</TableHead>
                    <TableHead className="text-right">{t("queue.col.duration")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedItems.map((item) => {
                    const dur = durationMs(item);
                    return (
                      <TableRow
                        key={item.siteId}
                        className={cn(
                          "transition-colors",
                          item.state === "checking" &&
                            "bg-primary/5 dark:bg-primary/10 border-l-2 border-l-primary",
                          item.state === "failed" &&
                            "bg-destructive/5 dark:bg-destructive/10",
                          (item.state === "skipped" || item.state === "cancelled") &&
                            "opacity-60",
                          item.source === "manual" &&
                            item.state === "waiting" &&
                            "bg-violet-50/50 dark:bg-violet-900/10",
                        )}
                      >
                        <TableCell className="text-center font-mono text-xs text-muted-foreground">
                          {item.position}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-sm leading-tight">{item.siteName}</div>
                          <div className="text-xs text-muted-foreground truncate" dir="ltr">{item.host}</div>
                        </TableCell>
                        <TableCell>
                          <StateBadge state={item.state} />
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <SourceBadge source={item.source} />
                        </TableCell>
                        <TableCell
                          className="text-right text-xs text-muted-foreground tabular-nums"
                          dir="ltr"
                        >
                          {item.state === "checking" && dur != null
                            ? fmt(t("queue.duration.ms"), { ms: dur })
                            : item.startedAt
                              ? `${formatTime(item.startedAt)}`
                              : t("queue.duration.dash")}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          /* Empty state — only show when there are no current items and no next cycle */
          !hasNextCycle && (
            <div className="flex flex-col items-center py-6 gap-2 text-muted-foreground text-sm">
              <ListChecks className="h-8 w-8 text-muted-foreground/30" />
              <span>{isPaused ? t("queue.monitorPaused") : t("queue.empty")}</span>
            </div>
          )
        )}

        {/* Next cycle section — shown during countdown when not actively checking */}
        {hasNextCycle && (
          <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <CalendarClock className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {t("queue.nextCycle")}
                </span>
                <Badge variant="outline" className="text-xs h-5 px-1.5 text-muted-foreground">
                  {fmt(t("queue.nextCycleCount"), { count: nextCycleItems.length })}
                </Badge>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!isPaused && countdownMs !== null && countdownMs > 0 && (
                  <span
                    className={cn(
                      "text-xs font-mono tabular-nums",
                      countdownUrgent ? "text-warning font-semibold" : "text-muted-foreground/70",
                    )}
                    dir="ltr"
                  >
                    {formatCountdown(countdownMs)}
                  </span>
                )}
                {!isPaused && countdownMs !== null && countdownMs <= 0 && (
                  <span className="text-xs text-primary font-medium">{t("queue.startingSoon")}</span>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs gap-1"
                  disabled={isPaused || isActivelyChecking || runNextCyclePending}
                  onClick={handleRunNextCycle}
                  title={isPaused ? t("queue.monitorPaused") : t("queue.runNextCycle")}
                >
                  {runNextCyclePending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <PlayCircle className="h-3 w-3" />
                  )}
                  {runNextCyclePending ? t("queue.runNextCycleRunning") : t("queue.runNextCycle")}
                </Button>
              </div>
            </div>
            <NextCycleList items={nextCycleItems} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
