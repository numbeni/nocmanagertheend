import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { faIR } from "date-fns/locale";
import {
  useListSites,
  getListSitesQueryKey,
  useGetMonitorStatus,
  getGetMonitorStatusQueryKey,
  useGetMonitorLiveState,
  getGetMonitorLiveStateQueryKey,
  usePauseMonitoring,
  useResumeMonitoring,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  ExternalLink,
  FileText,
  Globe,
  LayoutGrid,
  List,
  Loader2,
  Maximize2,
  Minimize2,
  AlignJustify,
  Pause,
  Play,
  PlayCircle,
  Server,
  Clock,
  Radio,
  ShieldAlert,
  Lock,
  Copy,
  Trash2,
  RefreshCw,
  Eye,
  Zap,
  XCircle,
  SkipForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────
interface SiteRecord {
  id: number;
  name: string;
  url: string;
  host: string;
  overallStatus: string;
  responseTimeMs: number | null;
  uptime24h: number;
  lastCheckedAt: string | null;
  serverId: number | null;
  serverCode: string | null;
  serverName: string | null;
  serverColor: string | null;
  openIncidentId: number | null;
  monitoringPaused: boolean;
  currentlyFine: boolean;
  enabled: boolean;
  consecutiveFailures: number;
  errorType: string | null;
  errorMessage: string | null;
}

interface ServerRecord {
  id: number;
  code: string;
  name: string;
  description: string | null;
  color: string;
  displayOrder: number;
  siteCount: number;
}

type SweepPhase = "idle" | "blocked" | "first_pass" | "second_pass" | "final_recheck" | "cooldown";

interface LiveState {
  paused: boolean;
  running: boolean;
  currentSiteId: number | null;
  currentSiteName: string | null;
  currentStep: string | null;
  currentServerId: number | null;
  currentServerName: string | null;
  currentPhase: SweepPhase;
  currentPhaseTotal: number;
  currentPhaseDone: number;
  confirmedDownSiteIds: number[];
  cooldownEndsAt: string | null;
  lastSweepStartedAt: string | null;
  lastSweepCompletedAt: string | null;
  lastSweepDurationMs: number | null;
  lastSweepCheckedCount: number;
  monitorIntervalMs: number;
}

interface SslSummary {
  total: number;
  valid: number;
  expiring: number;
  expired: number;
  invalid: number;
  unchecked: number;
  lastCheckedAt: string | null;
}

// ── Status helpers ─────────────────────────────────────────────────────────────
function statusDotClass(status: string) {
  switch (status) {
    case "up": return "bg-green-500";
    case "slow": return "bg-yellow-500";
    case "degraded": return "bg-orange-500";
    case "blocked": return "bg-orange-600";
    case "not_stable": return "bg-violet-500";
    case "down": return "bg-red-500";
    case "currently_fine": return "bg-teal-500";
    default: return "bg-gray-500";
  }
}

function statusTileClass(status: string) {
  switch (status) {
    case "up": return "bg-green-600/80 hover:bg-green-600";
    case "slow": return "bg-yellow-600/80 hover:bg-yellow-600";
    case "degraded": return "bg-orange-600/80 hover:bg-orange-600";
    case "blocked": return "bg-orange-700/80 hover:bg-orange-700";
    case "not_stable": return "bg-violet-600/80 hover:bg-violet-600";
    case "down": return "bg-red-700/80 hover:bg-red-700";
    case "currently_fine": return "bg-teal-600/80 hover:bg-teal-600";
    default: return "bg-gray-700/80 hover:bg-gray-700";
  }
}

/** Format a sweep duration from milliseconds to a human-readable string, e.g. "2m 34s" */
function fmtSweepDuration(ms: number, lang = "en"): string {
  const fa = lang === "fa";
  if (ms < 1000) return `${ms}${fa ? "م‌ث" : "ms"}`;
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}${fa ? "ث" : "s"}`;
  if (s === 0) return `${m}${fa ? "د" : "m"}`;
  return `${m}${fa ? "د" : "m"} ${s}${fa ? "ث" : "s"}`;
}

function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return `${Math.round(ms)}ms`;
}

function fmtPhase(phase: SweepPhase, serverName: string | null, t: (k: string) => string): string {
  const k = `dash.phase.${phase}`;
  const base = t(k);
  if ((phase === "first_pass" || phase === "second_pass") && serverName) {
    return base.replace("{server}", serverName);
  }
  return base;
}

function shortFailureReason(site: SiteRecord, t: (k: string) => string): string | null {
  if (site.overallStatus === "up" || site.overallStatus === "unknown") return null;
  if (site.errorMessage) {
    const msg = site.errorMessage;
    if (msg.length > 48) return msg.slice(0, 45) + "…";
    return msg;
  }
  if (site.overallStatus === "slow") return t("dash.causeHigh");
  if (site.overallStatus === "degraded") return t("dash.causeDnsError");
  if (site.overallStatus === "blocked") return t("dash.causeBlocked");
  if (site.overallStatus === "down") {
    if (site.consecutiveFailures > 1) return `${site.consecutiveFailures}× ${t("dash.causeUnknown")}`;
    return t("dash.causeUnknown");
  }
  return null;
}

// ── Site Context Menu ─────────────────────────────────────────────────────────
function SiteContextMenu({
  site,
  children,
  onRefetch,
  t,
}: {
  site: SiteRecord;
  children: React.ReactNode;
  onRefetch: () => void;
  t: (k: string) => string;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: _ls } = useGetMonitorLiveState({
    query: { queryKey: getGetMonitorLiveStateQueryKey(), staleTime: 2000 },
  });
  const sweepActive = (_ls as unknown as LiveState | null)?.currentPhase !== "idle";

  async function handleRunCheck() {
    try {
      const r = await fetch(`/api/sites/${site.id}/run-check`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error();
      toast({ title: t("ctx.site.checkQueued") });
      setTimeout(onRefetch, 2000);
    } catch {
      toast({ title: t("ctx.site.checkError"), variant: "destructive" });
    }
  }

  async function handlePause() {
    try {
      const r = await fetch(`/api/sites/${site.id}/pause`, { method: "PATCH", credentials: "include" });
      if (!r.ok) throw new Error();
      toast({ title: t("dash.sitePauseSuccess") });
      onRefetch();
    } catch {
      toast({ title: t("dash.sitePauseError"), variant: "destructive" });
    }
  }

  async function handleResume() {
    try {
      const r = await fetch(`/api/sites/${site.id}/resume`, { method: "PATCH", credentials: "include" });
      if (!r.ok) throw new Error();
      toast({ title: t("dash.siteResumeSuccess") });
      onRefetch();
    } catch {
      toast({ title: t("dash.siteResumeError"), variant: "destructive" });
    }
  }

  async function handleMarkCurrentlyFine(durationMs: number | null) {
    try {
      const r = await fetch(`/api/sites/${site.id}/currently-fine`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationMs }),
      });
      if (!r.ok) throw new Error();
      toast({ title: t("dash.currentlyFineSuccess") });
      onRefetch();
    } catch {
      toast({ title: t("dash.currentlyFineError"), variant: "destructive" });
    }
  }

  async function handleUnsetCurrentlyFine() {
    try {
      const r = await fetch(`/api/sites/${site.id}/unset-currently-fine`, { method: "PATCH", credentials: "include" });
      if (!r.ok) throw new Error();
      toast({ title: t("dash.unsetCurrentlyFineSuccess") });
      onRefetch();
    } catch {
      toast({ title: t("dash.unsetCurrentlyFineError"), variant: "destructive" });
    }
  }

  async function handleDelete() {
    try {
      const r = await fetch(`/api/sites/${site.id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error();
      toast({ title: t("dash.rowDeleteSuccess") });
      onRefetch();
    } catch {
      toast({ title: t("dash.rowDeleteError"), variant: "destructive" });
    }
  }

  function handleCopyUrl() {
    navigator.clipboard.writeText(site.url).then(() => toast({ title: t("ctx.site.urlCopied") })).catch(() => {});
  }

  function handleCopyDomain() {
    navigator.clipboard.writeText(site.host).then(() => toast({ title: t("ctx.site.domainCopied") })).catch(() => {});
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={() => navigate(`/sites/${site.id}`)}>
          <Eye className="h-3.5 w-3.5 mr-2 flex-shrink-0" />
          {t("ctx.site.openDetail")}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => window.open(site.url, "_blank", "noopener")}>
          <ExternalLink className="h-3.5 w-3.5 mr-2 flex-shrink-0" />
          {t("ctx.site.openUrl")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={sweepActive ? undefined : handleRunCheck}
          disabled={sweepActive}
          className={sweepActive ? "opacity-50 cursor-not-allowed" : ""}
        >
          <RefreshCw className="h-3.5 w-3.5 mr-2 flex-shrink-0" />
          {t("ctx.site.runCheck")}
          {sweepActive && (
            <span className="ml-auto text-[9px] text-muted-foreground">{t("dash.sweepRunning")}</span>
          )}
        </ContextMenuItem>
        {site.monitoringPaused ? (
          <ContextMenuItem onClick={handleResume}>
            <Play className="h-3.5 w-3.5 mr-2 flex-shrink-0" />
            {t("ctx.site.resumeMonitoring")}
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onClick={handlePause}>
            <Pause className="h-3.5 w-3.5 mr-2 flex-shrink-0" />
            {t("ctx.site.pauseMonitoring")}
          </ContextMenuItem>
        )}
        {site.currentlyFine ? (
          <ContextMenuItem onClick={handleUnsetCurrentlyFine}>
            <XCircle className="h-3.5 w-3.5 mr-2 flex-shrink-0 text-teal-400" />
            {t("ctx.site.unsetCurrentlyFine")}
          </ContextMenuItem>
        ) : (
          <>
            <ContextMenuItem onClick={() => handleMarkCurrentlyFine(3600000)}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-2 flex-shrink-0 text-teal-400" />
              {t("ctx.site.markFineFor1h")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleMarkCurrentlyFine(21600000)}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-2 flex-shrink-0 text-teal-400" />
              {t("ctx.site.markFineFor6h")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleMarkCurrentlyFine(86400000)}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-2 flex-shrink-0 text-teal-400" />
              {t("ctx.site.markFineFor1d")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleMarkCurrentlyFine(null)}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-2 flex-shrink-0 text-teal-400" />
              {t("ctx.site.markFinePermanent")}
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleCopyUrl}>
          <Copy className="h-3.5 w-3.5 mr-2 flex-shrink-0" />
          {t("ctx.site.copyUrl")}
        </ContextMenuItem>
        <ContextMenuItem onClick={handleCopyDomain}>
          <Copy className="h-3.5 w-3.5 mr-2 flex-shrink-0" />
          {t("ctx.site.copyDomain")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onClick={handleDelete}
        >
          <Trash2 className="h-3.5 w-3.5 mr-2 flex-shrink-0" />
          {t("ctx.site.deleteConfirm")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ── Compact site card (inside server accordion) ───────────────────────────────
function CompactSiteCard({ site, onRefetch, t }: { site: SiteRecord; onRefetch: () => void; t: (k: string) => string }) {
  const reason = shortFailureReason(site, t);
  const effectiveStatus = site.currentlyFine ? "currently_fine" : site.overallStatus;
  return (
    <SiteContextMenu site={site} onRefetch={onRefetch} t={t}>
      <Link href={`/sites/${site.id}`}>
        <div
          className={cn(
            "group flex flex-col gap-0.5 px-2.5 py-2 rounded-md border border-border/50 bg-card cursor-pointer select-none",
            "hover:border-border transition-colors",
            site.openIncidentId ? "border-red-500/40" : "",
            site.currentlyFine ? "opacity-80 border-teal-500/30" : site.monitoringPaused ? "opacity-60" : "",
          )}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={cn(
              "h-2 w-2 rounded-full flex-shrink-0",
              site.monitoringPaused ? "bg-yellow-400" : statusDotClass(effectiveStatus),
            )} />
            <span className="text-xs font-medium truncate leading-tight">{site.name}</span>
            {site.currentlyFine && (
              <CheckCircle2 className="h-2.5 w-2.5 text-teal-400 flex-shrink-0 ml-auto" />
            )}
            {!site.currentlyFine && site.monitoringPaused && (
              <Pause className="h-2.5 w-2.5 text-yellow-400 flex-shrink-0 ml-auto" />
            )}
          </div>
          <div className="flex items-center justify-between gap-1 pl-3.5">
            <span className="text-[10px] text-muted-foreground truncate" dir="ltr">{site.host}</span>
            <span className="text-[10px] text-muted-foreground flex-shrink-0 font-mono" dir="ltr">{fmtMs(site.responseTimeMs)}</span>
          </div>
          {/* Always render 3rd line for consistent card height */}
          <div className="pl-3.5 mt-0.5">
            {reason ? (
              <span className="text-[9px] text-orange-400/80 truncate block leading-tight">{reason}</span>
            ) : (site.overallStatus === "up" || site.currentlyFine) ? (
              <span className="text-[9px] text-green-500/50 dark:text-green-400/40 truncate block leading-tight">{t("dash.consecutiveOk")}</span>
            ) : (
              <span className="text-[9px] invisible block leading-tight">—</span>
            )}
          </div>
        </div>
      </Link>
    </SiteContextMenu>
  );
}

// ── Server metrics badge row ──────────────────────────────────────────────────
function ServerMetrics({ sites, t }: { sites: SiteRecord[]; t: (k: string) => string }) {
  const total = sites.length;
  const up = sites.filter((s) => s.overallStatus === "up").length;
  const slow = sites.filter((s) => s.overallStatus === "slow").length;
  const degraded = sites.filter((s) => s.overallStatus === "degraded" || s.overallStatus === "blocked").length;
  const down = sites.filter((s) => s.overallStatus === "down" || s.overallStatus === "not_stable").length;

  return (
    <div className="flex items-center gap-1.5 text-xs font-mono flex-shrink-0 bg-black/30 rounded-md px-2 py-1">
      <span className="text-white/70">{total}</span>
      {up > 0 && (
        <span className="inline-flex items-center gap-0.5 bg-green-500/25 text-green-200 px-1.5 py-0.5 rounded text-[10px]">
          ↑{up}
        </span>
      )}
      {slow > 0 && (
        <span className="inline-flex items-center gap-0.5 bg-yellow-500/25 text-yellow-200 px-1.5 py-0.5 rounded text-[10px]">
          ~{slow}
        </span>
      )}
      {degraded > 0 && (
        <span className="inline-flex items-center gap-0.5 bg-orange-500/25 text-orange-200 px-1.5 py-0.5 rounded text-[10px]">
          !{degraded}
        </span>
      )}
      {down > 0 && (
        <span className="inline-flex items-center gap-0.5 bg-red-500/30 text-red-200 px-1.5 py-0.5 rounded text-[10px] font-bold">
          ↓{down}
        </span>
      )}
    </div>
  );
}

// ── Server accordion row ──────────────────────────────────────────────────────
function ServerAccordion({
  server,
  sites,
  criticalSiteIds,
  isChecking,
  currentSiteId,
  currentPhase,
  isOpen,
  onToggle,
  onRefetch,
  t,
}: {
  server: ServerRecord;
  sites: SiteRecord[];
  criticalSiteIds: Set<number>;
  isChecking: boolean;
  currentSiteId: number | null;
  currentPhase: SweepPhase;
  isOpen: boolean;
  onToggle: () => void;
  onRefetch: () => void;
  t: (k: string) => string;
}) {
  const visibleSites = sites.filter((s) => !criticalSiteIds.has(s.id));
  const hiddenCount = sites.length - visibleSites.length;
  const hasDown = visibleSites.some((s) => s.overallStatus === "down" || s.overallStatus === "not_stable");
  const currentSite = sites.find((s) => s.id === currentSiteId);

  return (
    <div className="rounded-lg overflow-hidden border border-border/60">
      {/* Server header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors hover:brightness-110"
        style={{ backgroundColor: server.color }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isChecking && (
            <Radio className="h-3.5 w-3.5 text-white animate-pulse flex-shrink-0" />
          )}
          <span className="text-white font-bold text-sm">{server.code}</span>
          <span className="text-white/90 font-medium text-sm">{server.name}</span>
          {server.description && (
            <span className="text-white/60 text-xs hidden md:inline truncate">{server.description}</span>
          )}
          {isChecking && currentSite && (
            <span className="text-white/70 text-xs italic ml-1 truncate max-w-[180px]">
              — {currentSite.name}
            </span>
          )}
          {isChecking && !currentSite && (
            <span className="text-white/80 text-xs italic ml-1">
              {fmtPhase(currentPhase, server.name, t)}
            </span>
          )}
          {hasDown && !isChecking && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-red-600/30 text-red-200 border border-red-400/30">
              <AlertTriangle className="h-2.5 w-2.5" />
              {visibleSites.filter((s) => s.overallStatus === "down" || s.overallStatus === "not_stable").length} down
            </span>
          )}
          {hiddenCount > 0 && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-red-900/40 text-red-200 border border-red-500/20 ml-1">
              <ShieldAlert className="h-2.5 w-2.5" />
              {t("dash.criticalExcluded").replace("{count}", String(hiddenCount))}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <ServerMetrics sites={visibleSites} t={t} />
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-white/80 flex-shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-white/80 flex-shrink-0" />
          )}
        </div>
      </button>

      {/* Expanded content — animated with CSS grid trick */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: isOpen ? "1fr" : "0fr",
          transition: "grid-template-rows 250ms ease",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <div className="bg-background p-3">
            {visibleSites.length === 0 && hiddenCount === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-4">No sites assigned to this server.</p>
            ) : visibleSites.length === 0 && hiddenCount > 0 ? (
              <p className="text-center text-xs text-muted-foreground py-4">
                {t("dash.allInCritical").replace("{count}", String(hiddenCount))}
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1.5">
                {visibleSites.map((site) => (
                  <CompactSiteCard key={site.id} site={site} onRefetch={onRefetch} t={t} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SSL Summary Card ──────────────────────────────────────────────────────────
function SslSummaryCard({ t }: { t: (k: string) => string }) {
  const { data } = useQuery<SslSummary>({
    queryKey: ["ssl-summary"],
    queryFn: () =>
      fetch("/api/ssl-targets/summary", { credentials: "include" }).then((r) => r.json()),
    refetchInterval: 60000,
    staleTime: 45000,
  });

  if (!data || data.total === 0) return null;

  const issues = (data.expiring ?? 0) + (data.expired ?? 0) + (data.invalid ?? 0);
  const healthy = issues === 0;

  return (
    <Link href="/ssl">
      <div
        className={cn(
          "flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border cursor-pointer transition-colors",
          healthy
            ? "border-green-500/30 bg-green-50 dark:bg-green-950/20 hover:bg-green-100 dark:hover:bg-green-950/30"
            : "border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-950/30",
        )}
      >
        <div className="flex items-center gap-2">
          <Lock className={cn("h-4 w-4 flex-shrink-0", healthy ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400")} />
          <span className={cn("font-medium text-sm", healthy ? "text-green-700 dark:text-green-300" : "text-amber-700 dark:text-amber-300")}>
            {t("dash.sslCard")}
          </span>
          <span className="text-muted-foreground text-xs">
            ({data.total} {t("ssl.targetsLabel")})
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {healthy ? (
            <Badge
              variant="secondary"
              className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-green-500/30 text-xs h-5"
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {t("dash.sslHealthy")}
            </Badge>
          ) : (
            <>
              {(data.expired ?? 0) > 0 && (
                <Badge variant="destructive" className="text-xs h-5">
                  {t("dash.sslExpiredBadge")}: {data.expired}
                </Badge>
              )}
              {(data.expiring ?? 0) > 0 && (
                <Badge className="bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 border-yellow-500/30 text-xs h-5">
                  {t("dash.sslExpiringBadge")}: {data.expiring}
                </Badge>
              )}
              {(data.invalid ?? 0) > 0 && (
                <Badge className="bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 border-orange-500/30 text-xs h-5">
                  {t("dash.sslInvalidBadge")}: {data.invalid}
                </Badge>
              )}
            </>
          )}
          {(data.unchecked ?? 0) > 0 && (
            <span className="text-muted-foreground text-xs">{data.unchecked} {t("dash.sslUnchecked")}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

// ── Critical / Down Sites Banner ──────────────────────────────────────────────
function CriticalBanner({
  sites,
  liveState,
  onRefetch,
  t,
}: {
  sites: SiteRecord[];
  liveState: LiveState | null;
  onRefetch: () => void;
  t: (k: string) => string;
}) {
  if (sites.length === 0) return null;
  const isRecheckRunning = liveState?.currentPhase === "final_recheck";
  const currentCheckId = liveState?.currentSiteId;

  return (
    <div className="rounded-lg border-2 border-red-300 dark:border dark:border-red-500/40 bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-red-100 dark:bg-red-950/40 border-b border-red-300 dark:border-red-500/30">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
          <ShieldAlert className="h-4 w-4" />
          <span className="font-bold text-sm">{t("dash.criticalBanner")}</span>
          <Badge variant="destructive" className="text-xs h-5">{sites.length}</Badge>
        </div>
        {isRecheckRunning && (
          <span className="flex items-center gap-1.5 text-xs text-red-300 animate-pulse">
            <Radio className="h-3.5 w-3.5" />
            {t("dash.phase.final_recheck")}
          </span>
        )}
      </div>
      <div className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1.5">
        {sites.map((site) => {
          const isCurrentlyChecking = currentCheckId === site.id;
          const reason = shortFailureReason(site, t);
          return (
            <SiteContextMenu key={site.id} site={site} onRefetch={onRefetch} t={t}>
              <Link href={`/sites/${site.id}`}>
                <div
                  className={cn(
                    "group flex flex-col gap-1 px-2.5 py-2 rounded-md border cursor-pointer transition-colors select-none",
                    isCurrentlyChecking
                      ? "border-blue-400/50 bg-blue-900/30 hover:bg-blue-900/40"
                      : "border-red-300 dark:border-red-500/30 bg-muted/40 hover:bg-muted/80",
                  )}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {site.monitoringPaused && !isCurrentlyChecking ? (
                      <Pause className="h-2.5 w-2.5 text-yellow-400 flex-shrink-0" />
                    ) : (
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full flex-shrink-0",
                          isCurrentlyChecking ? "bg-blue-400 animate-pulse" : "bg-red-500 animate-pulse",
                        )}
                      />
                    )}
                    <span className={cn(
                      "text-xs font-medium truncate",
                      isCurrentlyChecking ? "text-blue-500 dark:text-blue-200" : "text-red-700 dark:text-red-200",
                    )}>
                      {site.name}
                    </span>
                    {site.monitoringPaused && !isCurrentlyChecking && (
                      <span className="text-[9px] text-yellow-500/70 ml-auto flex-shrink-0">{t("dash.sitePausedLabel")}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-1 pl-3.5">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate" dir="ltr">{site.host}</span>
                    {site.serverCode && (
                      <span
                        className="inline-block text-[9px] font-bold px-1 rounded text-white flex-shrink-0"
                        style={{ backgroundColor: site.serverColor ?? "#666" }}
                      >
                        {site.serverCode}
                      </span>
                    )}
                  </div>
                  {/* Always render reason line for consistent card height */}
                  <div className="pl-3.5">
                    {reason ? (
                      <span className="text-[9px] text-orange-500 dark:text-orange-400/80 truncate block leading-tight">{reason}</span>
                    ) : (
                      <span className="text-[9px] invisible block leading-tight">—</span>
                    )}
                  </div>
                  {/* Always render consecutive failures line */}
                  <div className="pl-3.5">
                    {site.consecutiveFailures > 1 ? (
                      <span className="text-[9px] text-red-600 dark:text-red-400 font-bold font-mono">
                        {site.consecutiveFailures}× {t("dash.consecutiveFails")}
                      </span>
                    ) : (
                      <span className="text-[9px] invisible font-mono">—</span>
                    )}
                  </div>
                </div>
              </Link>
            </SiteContextMenu>
          );
        })}
      </div>
    </div>
  );
}

function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Live Sweep State Bar ──────────────────────────────────────────────────────
function LiveSweepBar({
  liveState,
  monitorPaused,
  onPause,
  onResume,
  onRunSweep,
  onSkipSweep,
  isSweeping,
  isSkipping,
  t,
}: {
  liveState: LiveState | null;
  monitorPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  onRunSweep: () => void;
  onSkipSweep: () => void;
  isSweeping: boolean;
  isSkipping: boolean;
  t: (k: string) => string;
}) {
  const { dir, lang } = useT();
  const phase = liveState?.currentPhase ?? "idle";
  const isActive = phase !== "idle" && phase !== "blocked";
  const lastCompleted = liveState?.lastSweepCompletedAt;

  // Countdown to next sweep
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (isActive || monitorPaused || !lastCompleted || !liveState?.monitorIntervalMs) {
      setCountdown(null);
      return;
    }
    const nextAt = new Date(lastCompleted).getTime() + liveState.monitorIntervalMs;
    const tick = () => {
      const rem = nextAt - Date.now();
      setCountdown(rem > 0 ? rem : 0);
    };
    tick();
    countdownRef.current = setInterval(tick, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [isActive, monitorPaused, lastCompleted, liveState?.monitorIntervalMs]);

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border text-sm",
        monitorPaused
          ? "border-yellow-500/40 bg-yellow-50 dark:bg-yellow-950/20"
          : phase === "blocked"
          ? "border-orange-500/40 bg-orange-50 dark:bg-orange-950/20"
          : isActive
          ? "border-blue-500/40 bg-blue-50 dark:bg-blue-950/20"
          : "border-border bg-card",
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        {monitorPaused ? (
          <>
            <Pause className="h-4 w-4 text-yellow-600 dark:text-yellow-500 flex-shrink-0" />
            <span className="text-yellow-700 dark:text-yellow-400 font-medium">{t("dash.monitorPaused")}</span>
          </>
        ) : phase === "blocked" ? (
          <>
            <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-500 flex-shrink-0" />
            <span className="text-orange-700 dark:text-orange-400 font-medium">{t("dash.phase.blocked")}</span>
          </>
        ) : isActive ? (
          <>
            <Radio className="h-4 w-4 text-blue-600 dark:text-blue-400 animate-pulse flex-shrink-0" />
            <span className="text-blue-700 dark:text-blue-300 font-medium">
              {fmtPhase(phase, liveState?.currentServerName ?? null, t)}
            </span>
            {liveState?.currentPhaseTotal != null && liveState.currentPhaseTotal > 0 && (
              <Badge variant="secondary" className="text-xs h-5 ml-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-400/30 dark:border-blue-500/20 font-mono">
                {t("dash.sweepPhaseProgress").replace("{done}", String(liveState.currentPhaseDone)).replace("{total}", String(liveState.currentPhaseTotal))}
              </Badge>
            )}
            {liveState?.currentSiteName && (
              <span className="text-blue-600/70 dark:text-blue-400/60 text-xs truncate max-w-[200px]">
                — {liveState.currentSiteName}
              </span>
            )}
            {liveState?.lastSweepCheckedCount != null && liveState.lastSweepCheckedCount > 0 && (
              <Badge variant="secondary" className="text-xs h-5 ml-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-400/30 dark:border-blue-500/20">
                {t("dash.lastSweepSites").replace("{count}", String(liveState.lastSweepCheckedCount))}
              </Badge>
            )}
          </>
        ) : (
          <>
            <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="text-muted-foreground">
              {lastCompleted
                ? `${t("dash.lastSweep")} ${formatDistanceToNow(new Date(lastCompleted), { addSuffix: true, locale: dir === "rtl" ? faIR : undefined })}`
                : t("dash.noSweepRunning")}
            </span>
            {liveState?.lastSweepDurationMs != null && (
              <span className="text-muted-foreground/50 text-xs">
                ({t("dash.lastSweepDuration").replace("{dur}", fmtSweepDuration(liveState.lastSweepDurationMs, lang))})
              </span>
            )}
            {countdown !== null && (
              <Badge variant="secondary" className="text-xs h-5 ml-1 bg-muted/60 text-muted-foreground border-border/40 font-mono">
                {t("dash.nextSweepIn").replace("{time}", fmtCountdown(countdown))}
              </Badge>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {isActive && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-orange-500/40 text-orange-400 hover:bg-orange-900/20"
            onClick={onSkipSweep}
            disabled={isSkipping || monitorPaused}
          >
            {isSkipping ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <SkipForward className="h-3.5 w-3.5 mr-1" />
            )}
            {isSkipping ? t("dash.skipping") : t("dash.skipSweep")}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={monitorPaused ? onResume : onPause}
        >
          {monitorPaused ? (
            <><Play className="h-3.5 w-3.5 mr-1" />{t("dash.resumeMonitoring")}</>
          ) : (
            <><Pause className="h-3.5 w-3.5 mr-1" />{t("dash.pauseMonitoring")}</>
          )}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={onRunSweep}
          disabled={isSweeping || monitorPaused}
        >
          {isSweeping ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <PlayCircle className="h-3.5 w-3.5 mr-1" />
          )}
          {t("dash.sweepNow")}
        </Button>
      </div>
    </div>
  );
}

// ── Stats Bar ─────────────────────────────────────────────────────────────────
function StatsBar({ sites, t }: { sites: SiteRecord[]; t: (k: string) => string }) {
  const total = sites.length;
  const fine = sites.filter((s) => s.currentlyFine).length;
  const paused = sites.filter((s) => !s.currentlyFine && s.monitoringPaused).length;
  const active = sites.filter((s) => !s.currentlyFine && !s.monitoringPaused);
  const up = active.filter((s) => s.overallStatus === "up").length;
  const slow = active.filter((s) => s.overallStatus === "slow").length;
  const degraded = active.filter((s) => s.overallStatus === "degraded" || s.overallStatus === "blocked").length;
  const down = active.filter((s) => s.overallStatus === "down" || s.overallStatus === "not_stable").length;
  const unknown = active.filter((s) => s.overallStatus === "unknown").length;

  const statItems = [
    { label: t("dash.totalSites"), value: total, color: "text-foreground" },
    { label: t("status.up"), value: up, color: "text-green-500 dark:text-green-400" },
    { label: t("status.slow"), value: slow, color: "text-yellow-600 dark:text-yellow-400" },
    { label: t("status.degraded"), value: degraded, color: "text-orange-600 dark:text-orange-400" },
    { label: t("status.down"), value: down, color: "text-red-600 dark:text-red-400" },
    { label: t("status.unknown"), value: unknown, color: unknown > 0 ? "text-muted-foreground" : "text-muted-foreground/40" },
    { label: t("dash.currentlyFineCount"), value: fine, color: fine > 0 ? "text-teal-600 dark:text-teal-400" : "text-muted-foreground/40" },
    { label: t("dash.pausedCount"), value: paused, color: paused > 0 ? "text-yellow-600 dark:text-yellow-400" : "text-muted-foreground/40" },
  ];

  return (
    <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
      {statItems.map((item) => (
        <div
          key={item.label}
          className="flex flex-col items-center justify-center py-3 px-2 rounded-lg border border-border bg-card"
        >
          <span className={cn("text-2xl font-bold font-mono", item.color)}>{item.value}</span>
          <span className="text-xs text-muted-foreground mt-0.5 text-center leading-tight">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Unassigned Sites Alert ────────────────────────────────────────────────────
function UnassignedAlert({ count, t }: { count: number; t: (k: string) => string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-950/10">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
        <div>
          <p className="text-amber-300 font-semibold text-sm">{t("dash.unassignedSkipping")}</p>
          <p className="text-amber-400/70 text-xs">
            {t("dash.unassignedSkippingHint").replace("{count}", String(count))}
          </p>
        </div>
      </div>
      <Link href="/servers">
        <Button
          size="sm"
          variant="outline"
          className="border-amber-500/40 text-amber-300 hover:bg-amber-900/30 flex-shrink-0"
        >
          <Server className="h-3.5 w-3.5 mr-1.5" />
          {t("dash.goToServers")}
        </Button>
      </Link>
    </div>
  );
}

// ── Compact view helpers ──────────────────────────────────────────────────────
function extractCompactLabel(site: SiteRecord, allSites: SiteRecord[]): string {
  let host = site.host || site.url || site.name;
  host = host.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  host = host.replace(/^www\./, "");
  const parts = host.split(".");
  if (parts.length < 2) return site.name;
  const tld = parts[parts.length - 1];
  const baseName = parts[parts.length - 2];
  const hasDuplicate = allSites.some((s) => {
    if (s.id === site.id) return false;
    let h = s.host || s.url || s.name;
    h = h.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
    h = h.replace(/^www\./, "");
    const p = h.split(".");
    if (p.length < 2) return false;
    return p[p.length - 2] === baseName;
  });
  return hasDuplicate ? `${baseName}.${tld}` : baseName;
}

// ── Compact View ──────────────────────────────────────────────────────────────
function CompactView({
  sites,
  servers,
  onRefetch,
  t,
}: {
  sites: SiteRecord[];
  servers: ServerRecord[];
  onRefetch: () => void;
  t: (k: string) => string;
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const sitesByServer = useMemo(() => {
    const map = new Map<number | null, SiteRecord[]>();
    for (const s of sites) {
      const arr = map.get(s.serverId) ?? [];
      arr.push(s);
      map.set(s.serverId, arr);
    }
    return map;
  }, [sites]);

  function toggleFullscreen() {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "space-y-4",
        isFullscreen && "bg-background p-6 overflow-auto",
      )}
    >
      <div className="flex justify-end mb-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={toggleFullscreen}>
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isFullscreen ? t("dash.compactExitFullscreen") : t("dash.compactFullscreen")}</TooltipContent>
        </Tooltip>
      </div>
      {servers.map((server) => {
        const serverSites = sitesByServer.get(server.id) ?? [];
        if (serverSites.length === 0) return null;
        return (
          <div key={server.id}>
            <div
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-white text-xs font-bold mb-2"
              style={{ backgroundColor: server.color }}
            >
              {server.code} {server.name}
            </div>
            <div className="flex flex-wrap gap-1">
              {serverSites.map((site) => (
                <SiteContextMenu key={site.id} site={site} onRefetch={onRefetch} t={t}>
                  <Link href={`/sites/${site.id}`}>
                    <div
                      className={cn(
                        "px-2.5 py-1.5 rounded text-white text-xs font-medium cursor-pointer transition-colors truncate max-w-[160px] select-none",
                        statusTileClass(site.overallStatus),
                        site.monitoringPaused ? "opacity-60" : "",
                      )}
                      title={site.name}
                    >
                      {site.monitoringPaused && <Pause className="h-2.5 w-2.5 inline mr-1" />}
                      {extractCompactLabel(site, sites)}
                    </div>
                  </Link>
                </SiteContextMenu>
              ))}
            </div>
          </div>
        );
      })}
      {/* Unassigned */}
      {(sitesByServer.get(null) ?? []).length > 0 && (
        <div>
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-muted text-muted-foreground text-xs font-bold mb-2">
            {t("servers.unassignedTitle")}
          </div>
          <div className="flex flex-wrap gap-1">
            {(sitesByServer.get(null) ?? []).map((site) => (
              <SiteContextMenu key={site.id} site={site} onRefetch={onRefetch} t={t}>
                <Link href={`/sites/${site.id}`}>
                  <div
                    className={cn(
                      "px-2.5 py-1.5 rounded text-white text-xs font-medium cursor-pointer transition-colors truncate max-w-[160px] select-none",
                      statusTileClass(site.overallStatus),
                    )}
                    title={site.name}
                  >
                    {extractCompactLabel(site, sites)}
                  </div>
                </Link>
              </SiteContextMenu>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── List View ─────────────────────────────────────────────────────────────────
function ListView({
  sites,
  onRefetch,
  t,
}: {
  sites: SiteRecord[];
  onRefetch: () => void;
  t: (k: string) => string;
}) {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState<string | null>(null);

  const allSelected = sites.length > 0 && selectedIds.size === sites.length;
  const someSelected = selectedIds.size > 0;

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(sites.map((s) => s.id)));
  }

  async function handleBulkDelete() {
    if (!window.confirm(t("dash.bulkDeleteConfirmTitle").replace("{count}", String(selectedIds.size)))) return;
    setBulkLoading("delete");
    try {
      await Promise.all(
        [...selectedIds].map((id) =>
          fetch(`/api/sites/${id}`, { method: "DELETE", credentials: "include" }),
        ),
      );
      toast({ title: t("dash.bulkDeleteSuccess"), description: t("dash.bulkDeleteSuccessDesc").replace("{count}", String(selectedIds.size)) });
      setSelectedIds(new Set());
      onRefetch();
    } catch {
      toast({ title: t("dash.bulkDeleteError"), variant: "destructive" });
    } finally {
      setBulkLoading(null);
    }
  }

  async function handleBulkPause() {
    setBulkLoading("pause");
    try {
      const r = await fetch("/api/sites/bulk-pause", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selectedIds] }),
      });
      if (!r.ok) throw new Error();
      toast({ title: t("dash.bulkPauseSuccess") });
      setSelectedIds(new Set());
      onRefetch();
    } catch {
      toast({ title: t("dash.bulkPauseError"), variant: "destructive" });
    } finally {
      setBulkLoading(null);
    }
  }

  async function handleBulkResume() {
    setBulkLoading("resume");
    try {
      const r = await fetch("/api/sites/bulk-resume", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selectedIds] }),
      });
      if (!r.ok) throw new Error();
      toast({ title: t("dash.bulkResumeSuccess") });
      setSelectedIds(new Set());
      onRefetch();
    } catch {
      toast({ title: t("dash.bulkResumeError"), variant: "destructive" });
    } finally {
      setBulkLoading(null);
    }
  }

  async function handleBulkRunCheck() {
    setBulkLoading("check");
    try {
      await Promise.all(
        [...selectedIds].map((id) =>
          fetch(`/api/sites/${id}/run-check`, { method: "POST", credentials: "include" }),
        ),
      );
      toast({ title: t("dash.runCheckAllSuccess").replace("{count}", String(selectedIds.size)) });
      setSelectedIds(new Set());
      setTimeout(onRefetch, 2000);
    } catch {
      toast({ title: t("dash.runCheckAllError"), variant: "destructive" });
    } finally {
      setBulkLoading(null);
    }
  }

  return (
    <div className="space-y-2">
      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-primary/30 bg-primary/5">
          <span className="text-sm font-medium text-primary mr-1">
            {t("dash.selected").replace("{count}", String(selectedIds.size))}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={handleBulkRunCheck}
            disabled={bulkLoading !== null}
          >
            {bulkLoading === "check" ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
            )}
            {t("dash.bulkRunCheck")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={handleBulkPause}
            disabled={bulkLoading !== null}
          >
            {bulkLoading === "pause" ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Pause className="h-3.5 w-3.5 mr-1" />
            )}
            {t("dash.bulkPause")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={handleBulkResume}
            disabled={bulkLoading !== null}
          >
            {bulkLoading === "resume" ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 mr-1" />
            )}
            {t("dash.bulkResume")}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-7 text-xs ml-auto"
            onClick={handleBulkDelete}
            disabled={bulkLoading !== null}
          >
            {bulkLoading === "delete" ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5 mr-1" />
            )}
            {t("dash.bulkDelete")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setSelectedIds(new Set())}
          >
            <XCircle className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8 pl-3">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label={t("dash.selectAll")}
                />
              </TableHead>
              <TableHead className="w-8">{t("table.status")}</TableHead>
              <TableHead>{t("table.site")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("table.host")}</TableHead>
              <TableHead className="hidden sm:table-cell">Server</TableHead>
              <TableHead className="hidden lg:table-cell">{t("table.cause")}</TableHead>
              <TableHead className="text-right">{t("table.response")}</TableHead>
              <TableHead className="hidden lg:table-cell text-right">{t("table.uptime24h")}</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sites.map((site) => {
              const reason = shortFailureReason(site, t);
              const isSelected = selectedIds.has(site.id);
              return (
                <SiteContextMenu key={site.id} site={site} onRefetch={onRefetch} t={t}>
                  <TableRow
                    className={cn(
                      "group cursor-default",
                      isSelected ? "bg-primary/5" : "",
                      site.monitoringPaused ? "opacity-70" : "",
                    )}
                  >
                    <TableCell className="pl-3" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(site.id)}
                        aria-label={site.name}
                      />
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-block h-2.5 w-2.5 rounded-full",
                          site.monitoringPaused ? "bg-yellow-400" : statusDotClass(site.overallStatus),
                        )}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <Link href={`/sites/${site.id}`}>
                            <span className="font-medium text-sm hover:underline cursor-pointer">{site.name}</span>
                          </Link>
                          {site.monitoringPaused && (
                            <Badge variant="outline" className="text-[9px] h-4 px-1 text-yellow-400 border-yellow-500/30">
                              {t("dash.sitePausedLabel")}
                            </Badge>
                          )}
                          {site.openIncidentId && (
                            <Badge variant="destructive" className="text-[9px] h-4 px-1">
                              {t("dash.openIncidentsBadge").replace("{count}", "1")}
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground md:hidden" dir="ltr">{site.host}</span>
                        {reason && <span className="text-[10px] text-orange-400/80 lg:hidden mt-0.5">{reason}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground" dir="ltr">
                      {site.host}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {site.serverCode ? (
                        <span
                          className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded text-white"
                          style={{ backgroundColor: site.serverColor ?? "#666" }}
                        >
                          {site.serverCode}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell max-w-[200px]">
                      {reason ? (
                        <Tooltip>
                          <TooltipTrigger>
                            <span className="text-xs text-orange-400/80 truncate block max-w-[180px]">{reason}</span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs text-xs">{site.errorMessage ?? reason}</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-xs text-muted-foreground/30">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtMs(site.responseTimeMs)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-right text-xs">
                      {site.uptime24h.toFixed(1)}%
                    </TableCell>
                    <TableCell>
                      <Link href={`/sites/${site.id}`}>
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </Link>
                    </TableCell>
                  </TableRow>
                </SiteContextMenu>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── Generate Report Modal ─────────────────────────────────────────────────────
function GenerateReportModal({
  open,
  onClose,
  sites,
  liveState,
  t,
}: {
  open: boolean;
  onClose: () => void;
  sites: SiteRecord[];
  liveState: LiveState | null;
  t: (k: string) => string;
}) {
  const [language, setLanguage] = useState<"en" | "fa">("fa");
  const [timeRange, setTimeRange] = useState<string>("24h");
  const [reportText, setReportText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generateReport() {
    setIsGenerating(true);
    try {
      const hoursMap: Record<string, number> = { "1h": 1, "6h": 6, "24h": 24, "7d": 168, "30d": 720 };
      const rangeHours = hoursMap[timeRange];
      const incQuery = rangeHours
        ? `/api/incidents?status=open&limit=20&since=${new Date(Date.now() - rangeHours * 3600000).toISOString()}`
        : "/api/incidents?status=open&limit=20";
      const [sslRes, gwRes, incRes] = await Promise.allSettled([
        fetch("/api/ssl-targets/summary", { credentials: "include" }).then((r) => r.ok ? r.json() : null),
        fetch("/api/gateways", { credentials: "include" }).then((r) => r.ok ? r.json() : null),
        fetch(incQuery, { credentials: "include" }).then((r) => r.ok ? r.json() : null),
      ]);
      const ssl = sslRes.status === "fulfilled" ? sslRes.value : null;
      const gw: SiteRecord[] | null = gwRes.status === "fulfilled" ? gwRes.value : null;
      const incidents: { title: string; severity: string }[] | null = incRes.status === "fulfilled" ? (Array.isArray(incRes.value) ? incRes.value : incRes.value?.incidents ?? null) : null;

      const now = new Intl.DateTimeFormat(language === "fa" ? "fa-IR" : "en-US", {
        timeZone: "Asia/Tehran",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false,
      }).format(new Date()) + (language === "en" ? " (Tehran)" : " (تهران)");

      const fine = sites.filter((s) => s.currentlyFine);
      const paused = sites.filter((s) => !s.currentlyFine && s.monitoringPaused);
      const active = sites.filter((s) => !s.currentlyFine && !s.monitoringPaused);
      const up = active.filter((s) => s.overallStatus === "up");
      const slow = active.filter((s) => s.overallStatus === "slow");
      const degraded = active.filter((s) => s.overallStatus === "degraded" || s.overallStatus === "blocked");
      const down = active.filter((s) => s.overallStatus === "down" || s.overallStatus === "not_stable");
      const unknown = active.filter((s) => s.overallStatus === "unknown");
      const critical = active.filter((s) => s.overallStatus === "down" || s.overallStatus === "not_stable");

      const phase = liveState?.currentPhase ?? "idle";
      const sweepStatus = liveState?.paused
        ? (language === "fa" ? "متوقف شده" : "Paused")
        : phase !== "idle"
        ? (language === "fa" ? "در حال اجرا" : "Running")
        : (language === "fa" ? "آماده" : "Idle");

      let r = "";
      if (language === "fa") {
        r = [
          "══════════════════════════════════════════",
          "       گزارش وضعیت NOC Monitor",
          "══════════════════════════════════════════",
          `تاریخ تهیه: ${now}`,
          "",
          "── خلاصه ──────────────────────────────────",
          `کل سایت‌ها: ${sites.length}`,
          `فعال: ${active.length}  |  تایید شده سالم: ${fine.length}  |  متوقف: ${paused.length}`,
          "",
          "── وضعیت سایت‌های فعال ──────────────────────",
          `  ✅ بالاست (UP):         ${String(up.length).padStart(3)}`,
          `  🟡 کند (SLOW):          ${String(slow.length).padStart(3)}`,
          `  🟠 نزول کیفیت:          ${String(degraded.length).padStart(3)}`,
          `  🔴 از دسترس خارج (DOWN): ${String(down.length).padStart(3)}`,
          `  ❓ نامشخص:               ${String(unknown.length).padStart(3)}`,
          "",
          ...(critical.length > 0 ? [
            "── سایت‌های بحرانی ──────────────────────────",
            ...critical.map((s) => {
              const reason = s.errorMessage ? (s.errorMessage.length > 60 ? s.errorMessage.slice(0, 57) + "…" : s.errorMessage) : "خطای نامشخص";
              const fails = s.consecutiveFailures > 1 ? ` (${s.consecutiveFailures}× خرابی)` : "";
              return `  ❌ ${s.host || s.name}${fails}\n     علت: ${reason}`;
            }),
            "",
          ] : []),
          ...(fine.length > 0 ? [
            "── سایت‌های تایید شده سالم ─────────────────",
            ...fine.map((s) => `  ✅ ${s.host || s.name}`),
            "",
          ] : []),
          ...(paused.length > 0 ? [
            "── سایت‌های متوقف ───────────────────────────",
            ...paused.map((s) => `  ⏸ ${s.host || s.name}`),
            "",
          ] : []),
          ...(ssl && ssl.total > 0 ? [
            "── وضعیت SSL ────────────────────────────────",
            `  کل: ${ssl.total}  |  معتبر: ${ssl.valid}  |  در حال انقضا: ${ssl.expiring}  |  منقضی: ${ssl.expired}  |  نامعتبر: ${ssl.invalid}`,
            "",
          ] : []),
          ...(gw && Array.isArray(gw) && gw.length > 0 ? [
            "── درگاه‌های پرداخت ──────────────────────────",
            ...gw.slice(0, 10).map((g: any) => `  ${g.status === "up" ? "✅" : g.status === "degraded" ? "🟡" : "❌"} ${g.name ?? g.host ?? "ناشناس"}: ${g.status ?? "نامشخص"}`),
            "",
          ] : []),
          ...(incidents && incidents.length > 0 ? [
            "── حوادث باز ────────────────────────────────",
            ...incidents.slice(0, 5).map((i: any) => `  🚨 ${i.title} (${i.severity})`),
            "",
          ] : []),
          "── وضعیت پایش ──────────────────────────────",
          `  وضعیت sweep: ${sweepStatus}`,
          liveState?.lastSweepCompletedAt ? `  آخرین sweep: ${new Intl.DateTimeFormat("fa-IR", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(liveState.lastSweepCompletedAt))}` : null,
          "",
          "══════════════════════════════════════════",
          "            پایان گزارش",
          "══════════════════════════════════════════",
        ].filter(Boolean).join("\n");
      } else {
        r = [
          "==========================================",
          "       NOC Monitor Status Report",
          "==========================================",
          `Generated: ${now}`,
          "",
          "── SUMMARY ────────────────────────────────",
          `Total Sites: ${sites.length}`,
          `Active: ${active.length}  |  Currently Fine: ${fine.length}  |  Paused: ${paused.length}`,
          "",
          "── STATUS BREAKDOWN (ACTIVE) ──────────────",
          `  ✅ UP:        ${String(up.length).padStart(4)}`,
          `  🟡 SLOW:      ${String(slow.length).padStart(4)}`,
          `  🟠 DEGRADED:  ${String(degraded.length).padStart(4)}`,
          `  🔴 DOWN:      ${String(down.length).padStart(4)}`,
          `  ❓ UNKNOWN:   ${String(unknown.length).padStart(4)}`,
          "",
          ...(critical.length > 0 ? [
            "── CRITICAL SITES ─────────────────────────",
            ...critical.map((s) => {
              const reason = s.errorMessage ? (s.errorMessage.length > 60 ? s.errorMessage.slice(0, 57) + "…" : s.errorMessage) : "Unknown error";
              const fails = s.consecutiveFailures > 1 ? ` (${s.consecutiveFailures}× failures)` : "";
              return `  ❌ ${s.host || s.name}${fails}\n     Reason: ${reason}`;
            }),
            "",
          ] : []),
          ...(fine.length > 0 ? [
            "── CURRENTLY FINE (Operator-Flagged) ──────",
            ...fine.map((s) => `  ✅ ${s.host || s.name}`),
            "",
          ] : []),
          ...(paused.length > 0 ? [
            "── PAUSED SITES ───────────────────────────",
            ...paused.map((s) => `  ⏸ ${s.host || s.name}`),
            "",
          ] : []),
          ...(ssl && ssl.total > 0 ? [
            "── SSL CERTIFICATE STATUS ─────────────────",
            `  Total: ${ssl.total}  |  Valid: ${ssl.valid}  |  Expiring: ${ssl.expiring}  |  Expired: ${ssl.expired}  |  Invalid: ${ssl.invalid}`,
            "",
          ] : []),
          ...(gw && Array.isArray(gw) && gw.length > 0 ? [
            "── PAYMENT GATEWAYS ───────────────────────",
            ...gw.slice(0, 10).map((g: any) => `  ${g.status === "up" ? "✅" : g.status === "degraded" ? "🟡" : "❌"} ${g.name ?? g.host ?? "Unknown"}: ${g.status ?? "unknown"}`),
            "",
          ] : []),
          ...(incidents && incidents.length > 0 ? [
            "── OPEN INCIDENTS ─────────────────────────",
            ...incidents.slice(0, 5).map((i: any) => `  🚨 ${i.title} (${i.severity})`),
            "",
          ] : []),
          "── MONITORING ENGINE ──────────────────────",
          `  Sweep status: ${sweepStatus}`,
          liveState?.lastSweepCompletedAt ? `  Last sweep: ${new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(liveState.lastSweepCompletedAt))} (Tehran)` : null,
          "",
          "==========================================",
          "             END OF REPORT",
          "==========================================",
        ].filter(Boolean).join("\n");
      }
      setReportText(r);
    } catch {
      setReportText("Report generation failed. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(reportText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {t("dash.report.title")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{t("dash.report.language")}</span>
              <Select value={language} onValueChange={(v) => setLanguage(v as "en" | "fa")}>
                <SelectTrigger className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fa">فارسی</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{t("dash.report.rangeLabel")}</span>
              <Select value={timeRange} onValueChange={setTimeRange}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1h">{t("dash.report.range.1h")}</SelectItem>
                  <SelectItem value="6h">{t("dash.report.range.6h")}</SelectItem>
                  <SelectItem value="24h">{t("dash.report.range.24h")}</SelectItem>
                  <SelectItem value="7d">{t("dash.report.range.7d")}</SelectItem>
                  <SelectItem value="30d">{t("dash.report.range.30d")}</SelectItem>
                  <SelectItem value="all">{t("dash.report.range.all")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" className="h-8 text-xs" onClick={generateReport} disabled={isGenerating}>
              {isGenerating ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />{t("dash.report.generating")}</>
              ) : (
                <><PlayCircle className="h-3.5 w-3.5 mr-1.5" />{t("dash.report.generate")}</>
              )}
            </Button>
            {reportText && (
              <Button size="sm" variant="outline" className="h-8 text-xs ml-auto" onClick={handleCopy}>
                {copied ? (
                  <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-green-500" />{t("dash.report.copied")}</>
                ) : (
                  <><ClipboardCopy className="h-3.5 w-3.5 mr-1.5" />{t("dash.report.copy")}</>
                )}
              </Button>
            )}
          </div>
          <Textarea
            readOnly
            value={reportText || t("dash.report.empty")}
            className={cn(
              "font-mono text-xs h-[420px] resize-none",
              !reportText && "text-muted-foreground",
              language === "fa" && reportText && "text-right",
            )}
            dir={language === "fa" && reportText ? "rtl" : "ltr"}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { t } = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [view, setView] = useState<"grid" | "compact" | "list">("grid");
  const [openServers, setOpenServers] = useState<Set<number> | "all">("all");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);

  // Data fetching
  const { data: sitesData, isLoading: sitesLoading } = useListSites({
    query: { queryKey: getListSitesQueryKey(), refetchInterval: 30000, staleTime: 20000 },
  });
  const sites = (sitesData as unknown as SiteRecord[] | undefined) ?? [];

  const { data: serversData } = useQuery<ServerRecord[]>({
    queryKey: ["servers"],
    queryFn: () =>
      fetch("/api/servers", { credentials: "include" }).then((r) => r.ok ? r.json() : []),
    refetchInterval: 30000,
    staleTime: 20000,
  });
  const servers = serversData ?? [];

  const { data: liveState } = useGetMonitorLiveState({
    query: { queryKey: getGetMonitorLiveStateQueryKey(), refetchInterval: 2000, staleTime: 1500 },
  }) as { data: LiveState | undefined };

  const { data: monitorStatus } = useGetMonitorStatus({
    query: { queryKey: getGetMonitorStatusQueryKey(), refetchInterval: 5000 },
  });

  const pauseMonitor = usePauseMonitoring();
  const resumeMonitor = useResumeMonitoring();

  const [isSweeping, setIsSweeping] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);

  function onRefetch() {
    queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
  }

  async function handleRunSweep() {
    setIsSweeping(true);
    try {
      await fetch("/api/monitor/run-next-cycle", { method: "POST", credentials: "include" });
      queryClient.invalidateQueries({ queryKey: getGetMonitorLiveStateQueryKey() });
      toast({ title: t("dash.sweepRunning") });
    } catch {
      toast({ title: "Failed to trigger sweep", variant: "destructive" });
    } finally {
      setTimeout(() => setIsSweeping(false), 3000);
    }
  }

  async function handleSkipSweep() {
    setIsSkipping(true);
    try {
      const r = await fetch("/api/monitor/skip-sweep", { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error();
      queryClient.invalidateQueries({ queryKey: getGetMonitorLiveStateQueryKey() });
      toast({ title: t("dash.sweepSkipped") });
    } catch {
      toast({ title: t("dash.sweepSkipError"), variant: "destructive" });
    } finally {
      setTimeout(() => setIsSkipping(false), 2000);
    }
  }

  async function handleToggleMonitor() {
    const paused = monitorStatus?.paused;
    try {
      if (paused) await resumeMonitor.mutateAsync({});
      else await pauseMonitor.mutateAsync({});
      queryClient.invalidateQueries({ queryKey: getGetMonitorStatusQueryKey() });
    } catch {
      // ignore
    }
  }

  // Derive dashboard data
  const confirmedDownIds: number[] =
    (liveState as unknown as LiveState | null)?.confirmedDownSiteIds ?? [];
  const phase: SweepPhase =
    (liveState as unknown as LiveState | null)?.currentPhase ?? "idle";
  const currentSiteId: number | null =
    (liveState as unknown as LiveState | null)?.currentSiteId ?? null;

  const unassignedSites = sites.filter((s) => !s.serverId);

  // Critical sites: confirmed down OR overall status is down — exclude currentlyFine sites
  const criticalSites = sites.filter(
    (s) => !s.currentlyFine && (confirmedDownIds.includes(s.id) || s.overallStatus === "down"),
  );
  const criticalSiteIds = useMemo(
    () => new Set(criticalSites.map((s) => s.id)),
    [criticalSites],
  );

  // Group sites by server
  const sitesByServer = useMemo(() => {
    const map = new Map<number, SiteRecord[]>();
    for (const site of sites) {
      if (site.serverId != null) {
        const arr = map.get(site.serverId) ?? [];
        arr.push(site);
        map.set(site.serverId, arr);
      }
    }
    return map;
  }, [sites]);

  // Sort servers by displayOrder
  const sortedServers = useMemo(
    () => [...servers].sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id),
    [servers],
  );

  function isServerOpen(serverId: number): boolean {
    if (openServers === "all") return true;
    return openServers.has(serverId);
  }

  function toggleServer(serverId: number) {
    setOpenServers((prev) => {
      const set = prev === "all" ? new Set(servers.map((s) => s.id)) : new Set(prev);
      if (set.has(serverId)) set.delete(serverId);
      else set.add(serverId);
      return set;
    });
  }

  const monitorPaused = monitorStatus?.paused ?? false;

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Top bar */}
        <div className="flex-shrink-0 px-4 pt-4 pb-2 flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            {t("dash.monitoredSites")}
          </h1>
          <div className="flex items-center gap-2">
            {/* View switcher */}
            <div className="flex items-center gap-0.5 border border-border rounded-lg p-0.5 bg-card">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant={view === "grid" ? "secondary" : "ghost"}
                    className="h-7 w-7 p-0"
                    onClick={() => setView("grid")}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("dash.viewGrid")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant={view === "compact" ? "secondary" : "ghost"}
                    className="h-7 w-7 p-0"
                    onClick={() => setView("compact")}
                  >
                    <AlignJustify className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Compact</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant={view === "list" ? "secondary" : "ghost"}
                    className="h-7 w-7 p-0"
                    onClick={() => setView("list")}
                  >
                    <List className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("dash.viewList")}</TooltipContent>
              </Tooltip>
            </div>

            {/* Generate Report */}
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReportModalOpen(true)}>
              <FileText className="h-3.5 w-3.5 mr-1" />
              {t("dash.generateReport")}
            </Button>

            {/* Add site shortcut */}
            <Link href="/add-site">
              <Button size="sm" variant="outline" className="h-7 text-xs">
                <Globe className="h-3.5 w-3.5 mr-1" />
                {t("nav.addSite")}
              </Button>
            </Link>

            {/* Fullscreen */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => {
                    if (!document.fullscreenElement) {
                      document.documentElement.requestFullscreen().catch(() => {});
                      setIsFullscreen(true);
                    } else {
                      document.exitFullscreen().catch(() => {});
                      setIsFullscreen(false);
                    }
                  }}
                >
                  {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Fullscreen (F)</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
          {/* Stats bar */}
          {sitesLoading ? (
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : (
            <StatsBar sites={sites} t={t} />
          )}

          {/* SSL Summary Card */}
          <div className="pt-0.5 pb-0.5">
            <SslSummaryCard t={t} />
          </div>

          {/* Live sweep bar */}
          <LiveSweepBar
            liveState={liveState as unknown as LiveState | null}
            monitorPaused={monitorPaused}
            onPause={handleToggleMonitor}
            onResume={handleToggleMonitor}
            onRunSweep={handleRunSweep}
            onSkipSweep={handleSkipSweep}
            isSweeping={isSweeping}
            isSkipping={isSkipping}
            t={t}
          />

          {/* Unassigned sites blocking alert */}
          {unassignedSites.length > 0 && (
            <UnassignedAlert count={unassignedSites.length} t={t} />
          )}

          {/* No sites state */}
          {!sitesLoading && sites.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 space-y-4 text-muted-foreground">
              <Globe className="h-16 w-16 opacity-20" />
              <div className="text-center space-y-1">
                <p className="text-lg font-medium">{t("dash.noSites")}</p>
                <p className="text-sm">{t("dash.noSitesHint")}</p>
              </div>
              <Link href="/add-site">
                <Button variant="outline">{t("nav.addSite")}</Button>
              </Link>
            </div>
          )}

          {/* No servers state */}
          {!sitesLoading && sites.length > 0 && servers.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 space-y-3 text-muted-foreground">
              <Server className="h-12 w-12 opacity-20" />
              <div className="text-center space-y-1">
                <p className="text-base font-medium">{t("dash.noServers")}</p>
                <p className="text-sm">{t("dash.noServersHint")}</p>
              </div>
              <Link href="/servers">
                <Button variant="outline">
                  <Server className="h-4 w-4 mr-2" />
                  {t("servers.addServer")}
                </Button>
              </Link>
            </div>
          )}

          {/* Grid view: critical banner + server accordions */}
          {!sitesLoading && sites.length > 0 && view === "grid" && (
            <>
              {/* Critical / Down Banner — shows confirmed-down & down sites */}
              {criticalSites.length > 0 && (
                <CriticalBanner
                  sites={criticalSites}
                  liveState={liveState as unknown as LiveState | null}
                  onRefetch={onRefetch}
                  t={t}
                />
              )}

              {/* Server Accordions — critical sites are excluded to avoid duplication */}
              <div className="space-y-2">
                {sortedServers.map((server) => {
                  const serverSites = sitesByServer.get(server.id) ?? [];
                  return (
                    <ServerAccordion
                      key={server.id}
                      server={server}
                      sites={serverSites}
                      criticalSiteIds={criticalSiteIds}
                      isChecking={
                        (liveState as unknown as LiveState | null)?.currentServerId === server.id
                      }
                      currentSiteId={currentSiteId}
                      currentPhase={phase}
                      isOpen={isServerOpen(server.id)}
                      onToggle={() => toggleServer(server.id)}
                      onRefetch={onRefetch}
                      t={t}
                    />
                  );
                })}

                {/* Unassigned sites section */}
                {unassignedSites.length > 0 && (
                  <div className="rounded-lg overflow-hidden border border-amber-500/30">
                    <div className="flex items-center justify-between px-4 py-2.5 bg-amber-900/30">
                      <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
                        <AlertTriangle className="h-4 w-4" />
                        {t("servers.unassignedTitle")} ({unassignedSites.length})
                      </div>
                    </div>
                    <div className="bg-background p-3">
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1.5">
                        {unassignedSites
                          .filter((s) => !criticalSiteIds.has(s.id))
                          .map((site) => (
                            <CompactSiteCard key={site.id} site={site} onRefetch={onRefetch} t={t} />
                          ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Compact view */}
          {!sitesLoading && sites.length > 0 && view === "compact" && (
            <CompactView sites={sites} servers={sortedServers} onRefetch={onRefetch} t={t} />
          )}

          {/* List view */}
          {!sitesLoading && sites.length > 0 && view === "list" && (
            <ListView sites={sites} onRefetch={onRefetch} t={t} />
          )}
        </div>

        {/* Generate Report Modal */}
        <GenerateReportModal
          open={reportModalOpen}
          onClose={() => setReportModalOpen(false)}
          sites={sites}
          liveState={liveState as unknown as LiveState | null}
          t={t}
        />
      </div>
    </TooltipProvider>
  );
}
