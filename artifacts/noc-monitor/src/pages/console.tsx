import { useEffect, useMemo, useRef, useState } from "react";
import {
  useListConsoleEvents,
  getListConsoleEventsQueryKey,
  useGetMonitorLiveState,
  getGetMonitorLiveStateQueryKey,
  type ConsoleEvent,
} from "@workspace/api-client-react";
import { Pause, Play, TerminalSquare, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useT } from "@/i18n/LanguageProvider";

type EventType = ConsoleEvent["type"];

// "connectivity" is intentionally excluded from the main console —
// the detailed ping output belongs only to the Connectivity Terminal.
// High-level connectivity summaries arrive as "system" events.
const ALL_TYPES: EventType[] = [
  "cycle",
  "site",
  "dns",
  "http",
  "ssl",
  "tcp",
  "incident",
  "alert",
  "system",
];

const MAX_BUFFER = 1_000;

// Light-mode safe level colors — use dark: variant for dark mode.
function levelClass(level: ConsoleEvent["level"]): string {
  switch (level) {
    case "error":
      return "text-red-600 dark:text-red-400";
    case "warn":
      return "text-amber-600 dark:text-amber-300";
    case "debug":
      return "text-zinc-400 dark:text-zinc-500";
    default:
      return "text-emerald-700 dark:text-emerald-300";
  }
}

// Light-mode safe type badge colors.
function typeBadgeClass(type: EventType): string {
  switch (type) {
    case "cycle":
      return "bg-indigo-100 text-indigo-700 border border-indigo-300 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30";
    case "site":
      return "bg-sky-100 text-sky-700 border border-sky-300 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30";
    case "dns":
      return "bg-purple-100 text-purple-700 border border-purple-300 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30";
    case "http":
      return "bg-emerald-100 text-emerald-700 border border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30";
    case "ssl":
      return "bg-teal-100 text-teal-700 border border-teal-300 dark:bg-teal-500/15 dark:text-teal-300 dark:border-teal-500/30";
    case "tcp":
      return "bg-cyan-100 text-cyan-700 border border-cyan-300 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/30";
    case "incident":
      return "bg-red-100 text-red-700 border border-red-300 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30";
    case "alert":
      return "bg-orange-100 text-orange-700 border border-orange-300 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30";
    case "connectivity":
      return "bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30";
    default:
      return "bg-zinc-100 text-zinc-600 border border-zinc-300 dark:bg-zinc-500/15 dark:text-zinc-300 dark:border-zinc-500/30";
  }
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

export default function ConsolePage() {
  const { t } = useT();
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [activeFilters, setActiveFilters] = useState<Set<EventType>>(
    () => new Set(ALL_TYPES),
  );
  const [buffer, setBuffer] = useState<ConsoleEvent[]>([]);
  const [cursor, setCursor] = useState<number>(0);

  const filtersKey = useMemo(
    () => Array.from(activeFilters).sort().join(","),
    [activeFilters],
  );

  const queryParams = useMemo(
    () => ({ since: cursor, limit: 200 }),
    [cursor],
  );

  const { data: liveState } = useGetMonitorLiveState({
    query: {
      queryKey: getGetMonitorLiveStateQueryKey(),
      refetchInterval: 3_000,
      staleTime: 2_000,
    },
  });

  const sweeping = liveState
    ? ((liveState as Record<string, unknown>).currentPhase as string) !== "idle" &&
      ((liveState as Record<string, unknown>).currentPhase as string) !== "blocked"
    : false;

  const pollInterval = paused ? (false as const) : sweeping ? 500 : 2_000;

  const { data } = useListConsoleEvents(queryParams, {
    query: {
      queryKey: getListConsoleEventsQueryKey(queryParams),
      refetchInterval: pollInterval,
      refetchOnWindowFocus: false,
    },
  });

  useEffect(() => {
    if (!data || !data.events?.length) return;
    setBuffer((prev) => {
      const seen = new Set(prev.map((e) => e.id));
      const fresh = data.events.filter((e) => !seen.has(e.id));
      if (fresh.length === 0) return prev;
      const next = [...prev, ...fresh];
      if (next.length > MAX_BUFFER) next.splice(0, next.length - MAX_BUFFER);
      return next;
    });
    if (typeof data.nextCursor === "number" && data.nextCursor > cursor) {
      setCursor(data.nextCursor);
    }
  }, [data, cursor]);

  const visible = useMemo(
    () => buffer.filter((e) => activeFilters.has(e.type)),
    [buffer, activeFilters, filtersKey],
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!autoScroll || paused) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [visible.length, autoScroll, paused]);

  const toggleFilter = (type: EventType) => {
    setActiveFilters((cur) => {
      // If already exclusively showing this type, reset to all
      if (cur.size === 1 && cur.has(type)) {
        return new Set(ALL_TYPES);
      }
      // Otherwise show only this type (exclusive single-select)
      return new Set([type]);
    });
  };

  const allActive = activeFilters.size === ALL_TYPES.length;

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <TerminalSquare className="h-8 w-8 text-primary" />
            {t("console.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("console.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setAutoScroll((v) => !v)}>
            {t("console.autoscroll")}: {autoScroll ? "ON" : "OFF"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPaused((v) => !v)}>
            {paused ? <Play className="h-4 w-4 mr-2" /> : <Pause className="h-4 w-4 mr-2" />}
            {paused ? t("console.resume") : t("console.pause")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setBuffer([])}>
            <Trash2 className="h-4 w-4 mr-2" /> {t("console.clear")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={allActive ? "default" : "outline"}
          onClick={() => setActiveFilters(new Set(ALL_TYPES))}
        >
          {t("console.filterAll")}
        </Button>
        {ALL_TYPES.map((type) => {
          const active = activeFilters.has(type);
          const labelKey = `console.filter${type.charAt(0).toUpperCase()}${type.slice(1)}`;
          return (
            <Button
              key={type}
              size="sm"
              variant={active ? "default" : "outline"}
              onClick={() => toggleFilter(type)}
            >
              {t(labelKey)}
            </Button>
          );
        })}
      </div>

      <Card className="border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-mono text-muted-foreground">
                noc-monitor@engine:~$
              </CardTitle>
              <CardDescription className="text-xs">
                {t("console.eventCount").replace("{count}", String(buffer.length))}
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className={
                paused
                  ? "text-amber-600 border-amber-500/40 dark:text-amber-400"
                  : "text-emerald-700 border-emerald-500/40 dark:text-emerald-400"
              }
            >
              <span
                className={`h-2 w-2 rounded-full mr-2 ${
                  paused
                    ? "bg-amber-500"
                    : "bg-emerald-500 animate-pulse"
                }`}
              />
              {paused ? t("console.paused") : t("console.streaming")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {/* Terminal area — uses a light bg in light mode, near-black in dark */}
          <div
            ref={scrollRef}
            className="rounded-md border text-[12px] leading-relaxed font-mono p-4 h-[62vh] overflow-y-auto
              bg-zinc-50 border-zinc-200 text-zinc-800
              dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-200"
          >
            {visible.length === 0 ? (
              <div className="text-zinc-400 dark:text-zinc-500 italic">{t("console.empty")}</div>
            ) : (
              visible.map((e) => (
                <div key={e.id} className="flex items-start gap-2 py-0.5 whitespace-pre-wrap">
                  <span className="text-zinc-400 dark:text-zinc-600 select-none shrink-0">
                    {formatTime(e.ts)}
                  </span>
                  <span
                    className={`px-1.5 rounded text-[10px] uppercase tracking-wide leading-5 shrink-0 ${typeBadgeClass(e.type)}`}
                  >
                    {e.type}
                  </span>
                  {e.siteName && (
                    <span className="text-sky-600 dark:text-sky-300/80 truncate max-w-[160px] shrink-0">
                      {e.siteName}
                    </span>
                  )}
                  <span className={`flex-1 ${levelClass(e.level)}`}>{e.message}</span>
                </div>
              ))
            )}
            {!paused && (
              <div className="text-emerald-600 dark:text-emerald-400 inline-block animate-pulse">▌</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
