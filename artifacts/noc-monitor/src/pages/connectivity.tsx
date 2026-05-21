import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Wifi,
  WifiOff,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Play,
  Clock,
  Settings2,
  Terminal,
  Trash2,
  Copy,
  PauseCircle,
  PlayCircle,
  Check,
  Activity,
} from "lucide-react";
import { useT } from "@/i18n/LanguageProvider";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { faIR } from "date-fns/locale";

interface TargetResult {
  id: number;
  name: string;
  host: string;
  lastStatus: "online" | "offline" | null;
  lastResponseTimeMs: number | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastFailedAt: string | null;
}

interface ConnectivityStatus {
  status: "online" | "offline" | "checking" | "unknown";
  isChecking: boolean;
  lastCheckedAt: string | null;
  nextRetryAt: string | null;
  results: TargetResult[];
}

interface ConsoleEvent {
  id: number;
  ts: string;
  type: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  details?: Record<string, unknown>;
}

function RelTime({ iso, locale }: { iso: string | null; locale: Locale | undefined }) {
  if (!iso) return null;
  try {
    return <span>{formatDistanceToNow(new Date(iso), { addSuffix: true, locale })}</span>;
  } catch {
    return null;
  }
}

function RetryCountdown({ nextRetryAt, label }: { nextRetryAt: string | null; label: string }) {
  const [secs, setSecs] = useState<number | null>(null);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (ref.current) clearInterval(ref.current);
    if (!nextRetryAt) { setSecs(null); return; }
    const tick = () => {
      const ms = new Date(nextRetryAt).getTime() - Date.now();
      setSecs(ms > 0 ? Math.ceil(ms / 1000) : 0);
    };
    tick();
    ref.current = setInterval(tick, 1000);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [nextRetryAt]);

  if (secs === null || secs <= 0) return null;
  return (
    <span className="flex items-center gap-1">
      <Clock className="h-3 w-3" />
      {label} <span className="tabular-nums font-mono" dir="ltr">{secs}s</span>
    </span>
  );
}

// ── Connectivity Terminal ──────────────────────────────────────────────────────
function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  } catch { return "??:??:??"; }
}

function classifyLine(msg: string, level: string): string {
  if (!msg || msg.trim() === "") return "text-slate-700";
  if (msg.startsWith("===")) return "text-cyan-400/70 italic";
  if (/reply from .+: bytes=/i.test(msg)) return "text-green-400";
  if (/request timed out/i.test(msg)) return "text-amber-400/70";
  if (/connectivity (offline|lost)/i.test(msg) || msg.includes("OFFLINE")) return "text-red-400 font-semibold";
  if (/connectivity restored/i.test(msg) || msg.includes("RESTORED")) return "text-green-400 font-semibold";
  if (/^ping statistics for /i.test(msg)) return "text-slate-300 font-semibold";
  if (msg.startsWith("\t") || msg.startsWith("    ")) return "text-slate-400";
  if (/pinging .+ with \d+ bytes/i.test(msg)) return "text-blue-300";
  if (msg.startsWith("Ping request could not find")) return "text-red-400";
  if (level === "error") return "text-red-400";
  if (level === "warn") return "text-amber-400";
  if (level === "debug") return "text-slate-500";
  return "text-slate-200";
}

function ConnectivityTerminal({ isLive }: { isLive: boolean }) {
  const { t } = useT();
  const [events, setEvents] = useState<ConsoleEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [copied, setCopied] = useState(false);
  const termRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const scrollToBottom = useCallback(() => {
    if (termRef.current && !pausedRef.current)
      termRef.current.scrollTop = termRef.current.scrollHeight;
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    let localCursor = 0;

    async function poll() {
      if (!active) return;
      try {
        const res = await fetch(
          `/api/monitor/console-events?types=connectivity&since=${localCursor}&limit=100`,
          { credentials: "include" },
        );
        if (res.ok) {
          const data: { events: ConsoleEvent[]; cursor: number } = await res.json();
          if (data.events.length > 0) {
            localCursor = data.cursor;
            setEvents((prev) => [...prev, ...data.events].slice(-500));
            setTimeout(scrollToBottom, 40);
          }
        }
      } catch {}
      if (active) timer = setTimeout(poll, isLive ? 1000 : 2000);
    }

    poll();
    return () => { active = false; clearTimeout(timer); };
  }, [scrollToBottom, isLive]);

  const handleCopy = async () => {
    const text = events.map((e) => `[${formatTs(e.ts)}] ${e.message}`).join("\n");
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-xl border border-slate-700/60 overflow-hidden shadow-lg">
      {/* ── toolbar ── */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-slate-800/90 border-b border-slate-700/60">
        <div className="flex items-center gap-2.5">
          <Terminal className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-[11px] font-mono text-slate-300 select-none tracking-wide">
            connectivity@sentinel:~$
          </span>
          {isLive && !paused && (
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[10px] font-mono text-green-400/70 select-none">live</span>
            </span>
          )}
          {events.length > 0 && (
            <span className="text-[10px] font-mono text-slate-600 select-none tabular-nums">
              {events.length} events
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPaused((v) => !v)}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
          >
            {paused
              ? <><PlayCircle className="h-3 w-3" />{t("connectivity.terminal.resume")}</>
              : <><PauseCircle className="h-3 w-3" />{t("connectivity.terminal.pause")}</>}
          </button>
          <button
            onClick={handleCopy}
            disabled={events.length === 0}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-30"
          >
            {copied
              ? <><Check className="h-3 w-3 text-green-400" />{t("connectivity.terminal.copy")}</>
              : <><Copy className="h-3 w-3" />{t("connectivity.terminal.copy")}</>}
          </button>
          <button
            onClick={() => setEvents([])}
            disabled={events.length === 0}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono text-slate-400 hover:text-red-400 hover:bg-slate-700 transition-colors disabled:opacity-30"
          >
            <Trash2 className="h-3 w-3" />{t("connectivity.terminal.clear")}
          </button>
        </div>
      </div>

      {/* ── output ── */}
      <div
        ref={termRef}
        className="bg-[#0d1117] px-4 py-3 font-mono text-[11.5px] leading-[1.7] overflow-x-auto h-80 overflow-y-auto"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#374151 transparent" }}
      >
        {events.length === 0 ? (
          <div className="flex items-center gap-2 text-slate-600 text-[11px] select-none h-full justify-center">
            <Activity className="h-3.5 w-3.5" />
            {t("connectivity.terminal.empty")}
          </div>
        ) : (
          <>
            {events.map((ev) => {
              const msg = ev.message;
              const isEmpty = !msg || msg.trim() === "" || msg === "`" || msg === "``";
              const colorCls = classifyLine(msg, ev.level);
              const isSection = msg.startsWith("===");

              return (
                <div key={ev.id} dir="ltr" className={cn("flex items-start gap-2 min-w-0", isSection && "mt-2 mb-0.5")}>
                  <span className="text-slate-600 flex-shrink-0 select-none text-[10.5px] mt-px">
                    [{formatTs(ev.ts)}]
                  </span>
                  {isEmpty ? (
                    <span className="h-[1.2em]" />
                  ) : (
                    <span className={cn("flex-1 min-w-0 whitespace-pre-wrap break-words", colorCls)}>
                      {msg}
                    </span>
                  )}
                </div>
              );
            })}
            {/* blinking cursor when live */}
            {isLive && !paused && (
              <div dir="ltr" className="flex items-start gap-2 min-w-0 mt-0.5">
                <span className="text-slate-700 flex-shrink-0 select-none text-[10.5px]">
                  [{formatTs(new Date().toISOString())}]
                </span>
                <span className="text-green-400/60 animate-pulse select-none">▌</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ConnectivityPage() {
  const { t, dir } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const locale = dir === "rtl" ? faIR : undefined;
  const [pingingId, setPingingId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<ConnectivityStatus>({
    queryKey: ["connectivity-status"],
    queryFn: () =>
      fetch("/api/connectivity/status", { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.json();
      }),
    refetchInterval: 3_000,
    staleTime: 2_000,
    retry: 2,
  });

  const runCheck = useMutation({
    mutationFn: () =>
      fetch("/api/connectivity/check", { method: "POST", credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error("check failed");
        return r.json() as Promise<ConnectivityStatus>;
      }),
    onSuccess: (fresh) => {
      qc.setQueryData(["connectivity-status"], fresh);
    },
    onError: () => {
      toast({ title: t("connectivity.checkFailed"), variant: "destructive" });
    },
  });

  const pingTarget = async (id: number) => {
    setPingingId(id);
    try {
      const res = await fetch(`/api/connectivity/check/${id}`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const fresh = await res.json() as ConnectivityStatus;
        qc.setQueryData(["connectivity-status"], fresh);
      }
    } finally {
      setPingingId(null);
    }
  };

  const status = data?.status ?? "unknown";
  const isChecking = data?.isChecking || runCheck.isPending;
  const effectiveStatus = isChecking ? "checking" : status;

  const STATUS_CFG = {
    online: {
      Icon: Wifi,
      label: t("connectivity.online"),
      outerRing: "border-green-500/40",
      innerBg: "bg-green-500/10",
      iconColor: "text-green-400",
      dot: "bg-green-500",
      badgeCls: "border-green-500/30 bg-green-500/10 text-green-400",
      descKey: "connectivity.statusOnlineDesc",
    },
    offline: {
      Icon: WifiOff,
      label: t("connectivity.offline"),
      outerRing: "border-red-500/50",
      innerBg: "bg-red-500/10",
      iconColor: "text-red-400",
      dot: "bg-red-500",
      badgeCls: "border-red-500/30 bg-red-500/10 text-red-400",
      descKey: "connectivity.statusOfflineDesc",
    },
    checking: {
      Icon: Loader2,
      label: t("connectivity.checking"),
      outerRing: "border-blue-500/40",
      innerBg: "bg-blue-500/10",
      iconColor: "text-blue-400",
      dot: "bg-blue-400",
      badgeCls: "border-blue-500/30 bg-blue-500/10 text-blue-400",
      descKey: "connectivity.statusCheckingDesc",
    },
    unknown: {
      Icon: AlertCircle,
      label: t("connectivity.unknown"),
      outerRing: "border-border",
      innerBg: "bg-muted/20",
      iconColor: "text-muted-foreground",
      dot: "bg-muted-foreground/40",
      badgeCls: "border-border bg-muted/20 text-muted-foreground",
      descKey: "connectivity.statusUnknownDesc",
    },
  } as const;

  const cfg = STATUS_CFG[effectiveStatus as keyof typeof STATUS_CFG] ?? STATUS_CFG.unknown;
  const { Icon: StatusIcon } = cfg;
  const results = data?.results ?? [];
  const onlineCount = results.filter((r) => r.lastStatus === "online").length;
  const offlineCount = results.filter((r) => r.lastStatus === "offline").length;

  return (
    <div className="flex-1 space-y-6 p-8 pt-6 max-w-3xl mx-auto">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{t("connectivity.title")}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t("connectivity.desc")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/settings#connectivity">
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
              <Settings2 className="h-4 w-4" />
              {t("connectivity.settings")}
            </Button>
          </Link>
          <Button
            onClick={() => runCheck.mutate()}
            disabled={isChecking}
            className="gap-2"
            variant="outline"
          >
            {isChecking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t("connectivity.runCheck")}
          </Button>
        </div>
      </div>

      {/* ── Status Hero ─────────────────────────────────────────────────── */}
      <Card className={cn("border-2 transition-all duration-300", cfg.outerRing)}>
        <CardContent className="pt-8 pb-8">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div
              className={cn(
                "flex items-center justify-center h-24 w-24 rounded-full border-2 flex-shrink-0 transition-all duration-300",
                cfg.innerBg,
                cfg.outerRing,
              )}
            >
              <StatusIcon
                className={cn(
                  "h-12 w-12 transition-colors duration-300",
                  cfg.iconColor,
                  effectiveStatus === "checking" && "animate-spin",
                )}
              />
            </div>

            <div className="flex-1 text-center sm:text-start space-y-3">
              <div className="flex items-center gap-2 justify-center sm:justify-start flex-wrap">
                <span className="relative flex h-3 w-3">
                  <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-60", cfg.dot)} />
                  <span className={cn("relative inline-flex rounded-full h-3 w-3", cfg.dot)} />
                </span>
                <Badge variant="outline" className={cn("text-sm px-4 py-1 transition-all duration-300", cfg.badgeCls)}>
                  {cfg.label}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{t(cfg.descKey)}</p>
              <div className="flex items-center gap-4 flex-wrap justify-center sm:justify-start text-xs text-muted-foreground">
                {isLoading ? (
                  <Skeleton className="h-4 w-40" />
                ) : (
                  <>
                    {data?.lastCheckedAt && (
                      <span>
                        {t("connectivity.lastChecked")}:{" "}
                        <RelTime iso={data.lastCheckedAt} locale={locale} />
                      </span>
                    )}
                    {status === "offline" && data?.nextRetryAt && (
                      <span className="text-red-400/80">
                        <RetryCountdown nextRetryAt={data.nextRetryAt} label={t("connectivity.retryIn")} />
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>

            {!isLoading && results.length > 0 && (
              <div className="flex gap-6 flex-shrink-0">
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-400">{onlineCount}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{t("connectivity.online")}</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-red-400">{offlineCount}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{t("connectivity.offline")}</div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Offline banner ───────────────────────────────────────────────── */}
      {status === "offline" && !isChecking && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-red-500/40 bg-red-500/5">
          <WifiOff className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-500 dark:text-red-400 text-sm">
              {t("connectivity.offlineWarningTitle")}
            </p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("connectivity.offlineWarningDesc")}
            </p>
          </div>
        </div>
      )}

      {/* ── Per-target status ────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wifi className="h-4 w-4 text-muted-foreground" />
            {t("connectivity.targetsTitle")}
            {isChecking && (
              <span className="flex items-center gap-1 text-xs font-normal text-blue-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("connectivity.checking")}
              </span>
            )}
          </CardTitle>
          <CardDescription>{t("connectivity.targetsDesc")}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-2">
          {isLoading ? (
            <>{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</>
          ) : results.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
              {t("connectivity.noTargets")}
            </div>
          ) : (
            results.map((result) => {
              const isPinging = pingingId === result.id;
              const showChecking = isChecking && result.lastStatus === null;

              return (
                <div
                  key={result.id}
                  className={cn(
                    "flex items-start gap-3 p-4 rounded-lg border transition-all duration-300",
                    isChecking && !isPinging
                      ? "border-blue-500/20 bg-blue-500/[0.03]"
                      : result.lastStatus === "online"
                        ? "border-green-500/25 bg-green-500/[0.04]"
                        : result.lastStatus === "offline"
                          ? "border-red-500/25 bg-red-500/[0.04]"
                          : "border-border bg-muted/5",
                  )}
                >
                  <span className="flex-shrink-0 mt-0.5">
                    {isPinging || showChecking ? (
                      <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />
                    ) : result.lastStatus === "online" ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : result.lastStatus === "offline" ? (
                      <XCircle className="h-5 w-5 text-red-500" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-muted-foreground/40" />
                    )}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{result.name}</span>
                      <span className="text-xs text-muted-foreground font-mono" dir="ltr">
                        {result.host}
                      </span>
                      {result.lastStatus === "online" && result.lastResponseTimeMs !== null && (
                        <Badge
                          variant="outline"
                          className="bg-green-500/10 text-green-500 border-green-500/30 text-xs h-5 px-2 tabular-nums"
                          dir="ltr"
                        >
                          {result.lastResponseTimeMs}ms
                        </Badge>
                      )}
                      {isChecking && (
                        <span className="text-[10px] text-blue-400/70 font-mono">
                          {t("connectivity.checking")}
                        </span>
                      )}
                    </div>

                    <div className="mt-1 flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground/70">
                      {result.lastStatus === "offline" && result.lastError && (
                        <span className="text-red-400/80">{result.lastError}</span>
                      )}
                      {result.lastSuccessAt && (
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="h-2.5 w-2.5 text-green-500" />
                          {t("connectivity.lastSuccessAt")}:{" "}
                          <RelTime iso={result.lastSuccessAt} locale={locale} />
                        </span>
                      )}
                      {result.lastFailedAt && (
                        <span className="flex items-center gap-1">
                          <XCircle className="h-2.5 w-2.5 text-red-500" />
                          {t("connectivity.lastFailedAt")}:{" "}
                          <RelTime iso={result.lastFailedAt} locale={locale} />
                        </span>
                      )}
                      {!result.lastSuccessAt && !result.lastFailedAt && result.lastCheckedAt && (
                        <span>
                          {t("connectivity.lastChecked")}:{" "}
                          <RelTime iso={result.lastCheckedAt} locale={locale} />
                        </span>
                      )}
                      {!result.lastCheckedAt && (
                        <span className="italic opacity-60">{t("connectivity.neverChecked")}</span>
                      )}
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-blue-400 hover:bg-blue-500/10 flex-shrink-0"
                    onClick={() => pingTarget(result.id)}
                    disabled={isPinging || isChecking}
                    title={t("connectivity.pingTarget")}
                  >
                    {isPinging ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* ── Connectivity Terminal ────────────────────────────────────────── */}
      <ConnectivityTerminal isLive={isChecking} />

      {/* ── Info note ───────────────────────────────────────────────────── */}
      <p className="text-xs text-muted-foreground/60 text-center">
        {t("connectivity.autoCheckNote")}
      </p>
    </div>
  );
}
