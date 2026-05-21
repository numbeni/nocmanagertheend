import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Globe,
  LayoutDashboard,
  Plus,
  ScrollText,
  TerminalSquare,
  Settings,
  Moon,
  Sun,
  Maximize,
  Minimize,
  HelpCircle,
  User,
  Users,
  LogOut,
  ChevronDown,
  ShieldCheck,
  Circle,
  Clock4,
  Coffee,
  Briefcase,
  Wifi,
  WifiOff,
  Pause,
  Play,
  PanelLeft,
  PanelRight,
  Lock,
  Server,
} from "lucide-react";
import { NotificationButton } from "@/components/notification-button";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/i18n/LanguageProvider";
import { LanguageToggle } from "@/components/language-toggle";
import { useTheme } from "@/theme/ThemeProvider";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { HelpModal, useAutoShowHelp } from "@/components/help-modal";
import { useAuth } from "@/contexts/auth";
import {
  useGetMonitorStatus,
  getGetMonitorStatusQueryKey,
  useGetMonitorLiveState,
  getGetMonitorLiveStateQueryKey,
  usePauseMonitoring,
  useResumeMonitoring,
  useGetDashboardSummary,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";

function fmtStr(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`,
  );
}

interface LayoutProps {
  children: React.ReactNode;
}

const SIDEBAR_COLLAPSED_KEY = "noc.sidebar.collapsed";

function readCollapsedFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

type PresenceStatus = "online" | "away" | "busy" | "offline";

const PRESENCE_COLORS: Record<PresenceStatus, string> = {
  online: "text-green-500",
  away: "text-yellow-500",
  busy: "text-red-500",
  offline: "text-muted-foreground",
};

const PRESENCE_ICONS: Record<PresenceStatus, React.ComponentType<{ className?: string }>> = {
  online: Circle,
  away: Clock4,
  busy: Briefcase,
  offline: WifiOff,
};

function fmtCd(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function LayoutStatusBar({
  monitorStatus,
  liveState,
  t,
}: {
  monitorStatus: { running?: boolean; paused?: boolean } | null | undefined;
  liveState: Record<string, unknown> | null | undefined;
  t: (k: string) => string;
}) {
  const { data: connStatus } = useQuery<{ status: string; nextRetryAt?: string | null }>({
    queryKey: ["connectivity-status-bar"],
    queryFn: () => fetch("/api/connectivity/status", { credentials: "include" }).then((r) => r.json()),
    refetchInterval: 5000,
    staleTime: 4000,
  });

  const { data: connSettings } = useQuery<{ connectivityOfflinePopupEnabled?: boolean }>({
    queryKey: ["connectivity-popup-settings"],
    queryFn: () => fetch("/api/settings", { credentials: "include" }).then((r) => r.ok ? r.json() : {}),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  // Offline modal open state
  const [offlineModalOpen, setOfflineModalOpen] = useState(false);

  const prevConnStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevConnStatusRef.current;
    const curr = connStatus?.status ?? null;
    if (prev !== null && prev !== "offline" && curr === "offline") {
      if ((connSettings as any)?.connectivityOfflinePopupEnabled !== false) {
        setOfflineModalOpen(true);
      }
    }
    if (curr !== "offline") setOfflineModalOpen(false);
    prevConnStatusRef.current = curr;
  }, [connStatus?.status, connSettings]);

  // Retry countdown
  const [retryCountdownMs, setRetryCountdownMs] = useState<number | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (retryTimerRef.current) clearInterval(retryTimerRef.current);
    const nextRetryAt = connStatus?.nextRetryAt;
    if (!nextRetryAt || connStatus?.status !== "offline") { setRetryCountdownMs(null); return; }
    const tick = () => {
      const remaining = new Date(nextRetryAt).getTime() - Date.now();
      setRetryCountdownMs(remaining > 0 ? remaining : 0);
    };
    tick();
    retryTimerRef.current = setInterval(tick, 1000);
    return () => { if (retryTimerRef.current) clearInterval(retryTimerRef.current); };
  }, [connStatus?.nextRetryAt, connStatus?.status]);
  const phase = (liveState?.currentPhase as string) ?? "idle";
  const isSweeping = phase !== "idle" && phase !== "blocked";
  const lastCompleted = liveState?.lastSweepCompletedAt as string | null | undefined;
  const intervalMs = (liveState?.monitorIntervalMs as number | undefined) ?? 120_000;

  const [countdown, setCountdown] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (isSweeping || monitorStatus?.paused || !lastCompleted) {
      setCountdown(null);
      return;
    }
    const nextAt = new Date(lastCompleted).getTime() + intervalMs;
    const tick = () => setCountdown(Math.max(0, nextAt - Date.now()));
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isSweeping, monitorStatus?.paused, lastCompleted, intervalMs]);

  return (
    <div className="flex items-center gap-2">
      {/* Running / Paused */}
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-muted/40">
        <span className={cn(
          "h-1.5 w-1.5 rounded-full flex-shrink-0",
          monitorStatus?.running ? "bg-green-500 animate-pulse" : "bg-amber-400",
        )} />
        <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">
          {monitorStatus?.running ? t("dash.monitorRunning") : t("dash.monitorPaused")}
        </span>
      </div>

      {/* On Sweep / On Rest */}
      {!monitorStatus?.paused && (
        <div className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 rounded-full border whitespace-nowrap",
          isSweeping
            ? "border-blue-500/40 bg-blue-950/30"
            : "border-border bg-muted/30",
        )}>
          <span className={cn(
            "h-1.5 w-1.5 rounded-full flex-shrink-0",
            isSweeping ? "bg-blue-400 animate-ping" : "bg-muted-foreground/30",
          )} />
          <span className="text-[11px] font-medium">
            {isSweeping ? (
              <span className="text-blue-300">{t("dash.onSweep")}</span>
            ) : (
              <span className="text-muted-foreground">
                {t("dash.onRest")}
                {countdown !== null && (
                  <span className="font-mono ml-1 tabular-nums">
                    — {t("dash.nextSweepIn").replace("{time}", fmtCd(countdown))}
                  </span>
                )}
              </span>
            )}
          </span>
        </div>
      )}

      {/* Internet connectivity indicator — always visible once status is known */}
      {offlineModalOpen && (
        <div className="fixed bottom-4 end-4 z-50 flex items-start gap-3 p-4 rounded-lg border border-red-500/50 bg-background shadow-lg max-w-sm animate-in fade-in slide-in-from-bottom-2">
          <WifiOff className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-400">{t("connectivity.offlineModal.title")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t("connectivity.offlineModal.desc")}</p>
            {retryCountdownMs !== null && retryCountdownMs > 0 && (
              <p className="text-xs text-muted-foreground/70 mt-1 tabular-nums font-mono" dir="ltr">
                {t("connectivity.retryIn")} {Math.ceil(retryCountdownMs / 1000)}s
              </p>
            )}
          </div>
          <button
            type="button"
            className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setOfflineModalOpen(false)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      <Link href="/connectivity">
        <div className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 rounded-full border whitespace-nowrap cursor-pointer transition-opacity hover:opacity-80",
          connStatus?.status === "offline"
            ? "border-red-500/50 bg-red-950/30"
            : connStatus?.status === "online"
              ? "border-green-500/20 bg-green-950/10"
              : "border-border bg-muted/30",
        )}>
          {connStatus?.status === "offline" ? (
            <>
              <WifiOff className="h-3 w-3 text-red-400 flex-shrink-0" />
              <span className="text-[11px] font-medium text-red-400">
                {t("connectivity.statusBar.offline")}
                {retryCountdownMs !== null && retryCountdownMs > 0 && (
                  <span className="font-mono ms-1" dir="ltr">
                    {Math.ceil(retryCountdownMs / 1000)}s
                  </span>
                )}
              </span>
            </>
          ) : connStatus?.status === "online" ? (
            <>
              <Wifi className="h-3 w-3 text-green-400 flex-shrink-0" />
              <span className="text-[11px] font-medium text-green-400">
                {t("connectivity.statusBar.online")}
              </span>
            </>
          ) : connStatus?.status === "checking" ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full flex-shrink-0 bg-blue-400 animate-ping" />
              <span className="text-[11px] font-medium text-muted-foreground">
                {t("connectivity.statusBar.checking")}
              </span>
            </>
          ) : (
            <>
              <Wifi className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
              <span className="text-[11px] font-medium text-muted-foreground/60">
                {t("connectivity.statusBar.unknown")}
              </span>
            </>
          )}
        </div>
      </Link>

      {/* Live engine target — only when sweeping */}
      {isSweeping && (liveState?.currentSiteName as string | null) && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/30 bg-primary/5">
          <span className="h-1.5 w-1.5 rounded-full flex-shrink-0 bg-primary animate-pulse" />
          <span className="text-[11px] font-medium whitespace-nowrap" dir="ltr">
            <span className="text-muted-foreground">{t("dash.liveTargetChecking")}: </span>
            <span className="text-primary font-semibold">{liveState?.currentSiteName as string}</span>
            {(liveState?.currentStep as string | null) && (
              <span className="text-muted-foreground"> · {liveState?.currentStep as string}</span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { t, dir, lang, setLang } = useT();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();

  const [collapsed, setCollapsed] = useState<boolean>(readCollapsedFromStorage);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [presenceStatus, setPresenceStatus] = useState<PresenceStatus>(
    (user?.presenceStatus as PresenceStatus) ?? "online",
  );

  const { data: monitorStatus } = useGetMonitorStatus({
    query: { queryKey: getGetMonitorStatusQueryKey(), refetchInterval: 5000 },
  });
  const { data: liveState } = useGetMonitorLiveState({
    query: {
      queryKey: getGetMonitorLiveStateQueryKey(),
      refetchInterval: 2000,
      staleTime: 1500,
    },
  });
  const pauseMonitor = usePauseMonitoring();
  const resumeMonitor = useResumeMonitoring();
  const { data: dashSummary } = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey(), refetchInterval: 30000, staleTime: 15000 },
  });
  const openIncidentCount = dashSummary?.openIncidents ?? 0;

  const { data: sslSummary } = useQuery<{ expired: number; expiring: number; total: number }>({
    queryKey: ["ssl-summary-sidebar"],
    queryFn: () => fetch("/api/ssl-targets/summary", { credentials: "include" }).then((r) => r.json()),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
  const sslIssueCount = (sslSummary?.expired ?? 0) + (sslSummary?.expiring ?? 0);

  async function handleToggleMonitoring() {
    const action = monitorStatus?.paused ? resumeMonitor : pauseMonitor;
    try {
      await action.mutateAsync({});
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (user?.presenceStatus) {
      setPresenceStatus(user.presenceStatus as PresenceStatus);
    }
  }, [user?.presenceStatus]);

  async function handleSetPresence(status: PresenceStatus) {
    setPresenceStatus(status);
    try {
      await fetch("/api/auth/presence", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presenceStatus: status }),
      });
    } catch {
      /* ignore — optimistic update already applied */
    }
  }
  const { showHelp, setShowHelp } = useAutoShowHelp();

  const isHelpOpen = helpOpen || showHelp;
  const handleHelpClose = () => { setHelpOpen(false); setShowHelp(false); };

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore quota errors */
    }
  }, [collapsed]);

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  const handleFullscreenToggle = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  useKeyboardShortcuts([
    { key: "f", handler: handleFullscreenToggle },
    { key: "?", shift: true, handler: () => setHelpOpen(true) },
    { key: "Escape", handler: () => { setHelpOpen(false); setShowHelp(false); } },
    { key: "s", handler: () => setCollapsed((c) => !c) },
    { key: "t", handler: () => setLang(lang === "fa" ? "en" : "fa") },
  ]);

  const navItems = [
    { href: "/", label: t("nav.dashboard"), icon: LayoutDashboard },
    { href: "/incidents", label: t("nav.incidents"), icon: AlertTriangle },
    { href: "/servers", label: t("nav.servers"), icon: Server },
    { href: "/dns-performance", label: t("nav.dnsPerformance"), icon: Globe },
    { href: "/ssl", label: t("nav.ssl"), icon: Lock },
    { href: "/gateways", label: t("nav.gateways"), icon: CreditCard },
    { href: "/connectivity", label: t("nav.connectivity"), icon: Wifi },
    { href: "/charts-status", label: t("nav.chartsStatus"), icon: BarChart3 },
    { href: "/logs", label: t("nav.logs"), icon: ScrollText },
    { href: "/console", label: t("nav.console"), icon: TerminalSquare },
  ];

  if (user?.role === "admin" || user?.role === "founder" || user?.role === "operator") {
    navItems.push({ href: "/users", label: t("nav.users"), icon: Users });
  }
  if (user?.role === "admin" || user?.role === "founder" || user?.role === "operator") {
    navItems.push({ href: "/audit-log", label: t("nav.auditLog"), icon: ShieldCheck });
  }
  navItems.push({ href: "/settings", label: t("nav.settings"), icon: Settings });

  const collapseLabel = collapsed ? t("sidebar.expand") : t("sidebar.collapse");
  const ToggleIcon = (() => {
    if (dir === "rtl") return collapsed ? ChevronLeft : ChevronRight;
    return collapsed ? ChevronRight : ChevronLeft;
  })();

  const displayName = user
    ? (user.displayName || `${user.firstName} ${user.lastName}`)
    : "";

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background" dir={dir}>
      <aside
        className={cn(
          "bg-sidebar flex flex-col transition-[width] duration-200 ease-out",
          collapsed ? "w-16" : "w-72",
          dir === "rtl" ? "border-l border-border" : "border-r border-border",
        )}
      >
        {/* Logo + collapse toggle */}
        <div
          className={cn(
            "px-3 border-b border-border flex items-center gap-2 h-10",
            collapsed ? "justify-center" : "justify-between",
          )}
        >
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/">
                  <button
                    type="button"
                    aria-label={t("brand.title")}
                    className="flex items-center justify-center h-8 w-8 rounded-md hover:bg-sidebar-accent/60 text-primary transition-colors cursor-pointer"
                  >
                    <Activity className="h-5 w-5" />
                  </button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side={dir === "rtl" ? "left" : "right"}>
                {t("brand.title")}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Link href="/" className="flex items-center gap-2 min-w-0 cursor-pointer group">
              <Activity className="h-6 w-6 text-primary flex-shrink-0 group-hover:text-primary/80 transition-colors" />
              <span className="font-bold tracking-tight text-sidebar-foreground truncate group-hover:text-sidebar-foreground/80 transition-colors">
                {t("brand.title")}
              </span>
            </Link>
          )}
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-3">
          <nav className={cn("space-y-1 px-2")}>
            {navItems.map((item) => {
              const isActive =
                location === item.href ||
                (item.href !== "/" && location.startsWith(item.href));
              const isIncidents = item.href === "/incidents";
              const isSsl = item.href === "/ssl";
              const incidentBadge = isIncidents && openIncidentCount > 0;
              const sslBadge = isSsl && sslIssueCount > 0;
              const itemBody = (
                <div
                  className={cn(
                    "flex items-center rounded-md transition-colors cursor-pointer text-sm font-medium",
                    collapsed ? "justify-center h-10 w-10 mx-auto relative" : "gap-3 px-3 py-2.5",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                  )}
                >
                  <span className="relative flex-shrink-0">
                    <item.icon className="h-4 w-4" />
                    {(incidentBadge || sslBadge) && collapsed && (
                      <span className="absolute -top-1 -end-1 h-2 w-2 rounded-full bg-destructive" />
                    )}
                  </span>
                  {!collapsed && (
                    <>
                      <span className="truncate flex-1">{item.label}</span>
                      {incidentBadge && (
                        <span className="ms-auto flex-shrink-0 text-[10px] font-bold bg-destructive text-destructive-foreground rounded-full px-1.5 py-0.5 leading-none">
                          {openIncidentCount}
                        </span>
                      )}
                      {sslBadge && (
                        <span className="ms-auto flex-shrink-0 text-[10px] font-bold bg-destructive text-destructive-foreground rounded-full px-1.5 py-0.5 leading-none">
                          {sslIssueCount}
                        </span>
                      )}
                    </>
                  )}
                </div>
              );

              return (
                <Link key={item.href} href={item.href}>
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{itemBody}</TooltipTrigger>
                      <TooltipContent side={dir === "rtl" ? "left" : "right"}>
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    itemBody
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer Actions */}
        <div
          className={cn(
            "border-t border-border",
            collapsed ? "p-2 space-y-1.5" : "p-3 space-y-2",
          )}
        >
          {/* Resume / Pause Monitoring */}
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  className="w-full text-white hover:opacity-90"
                  style={{ backgroundColor: "rgb(42, 106, 216)" }}
                  variant="ghost"
                  onClick={handleToggleMonitoring}
                  disabled={pauseMonitor.isPending || resumeMonitor.isPending}
                  aria-label={monitorStatus?.paused ? t("dash.resumeMonitoring") : t("dash.pauseMonitoring")}
                >
                  {monitorStatus?.paused
                    ? <Play className="h-4 w-4" />
                    : <Pause className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side={dir === "rtl" ? "left" : "right"}>
                {monitorStatus?.paused ? t("dash.resumeMonitoring") : t("dash.pauseMonitoring")}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button
              className="w-full justify-start gap-2 font-medium text-white hover:opacity-90"
              style={{ backgroundColor: "rgb(42, 106, 216)" }}
              variant="ghost"
              onClick={handleToggleMonitoring}
              disabled={pauseMonitor.isPending || resumeMonitor.isPending}
            >
              {monitorStatus?.paused
                ? <><Play className="h-4 w-4 flex-shrink-0" />{resumeMonitor.isPending ? t("dash.resuming") : t("dash.resumeMonitoring")}</>
                : <><Pause className="h-4 w-4 flex-shrink-0" />{pauseMonitor.isPending ? t("dash.pausing") : t("dash.pauseMonitoring")}</>}
            </Button>
          )}

          {/* Add Site */}
          <Link href="/add-site">
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-full text-white hover:opacity-90"
                    style={{ backgroundColor: "rgb(117, 126, 126)" }}
                    aria-label={t("nav.addSite")}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side={dir === "rtl" ? "left" : "right"}>
                  {t("nav.addSite")}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Button
                className="w-full justify-start gap-2 text-white hover:opacity-90"
                style={{ backgroundColor: "rgb(117, 126, 126)" }}
                variant="ghost"
              >
                <Plus className="h-4 w-4 flex-shrink-0" />
                {t("nav.addSite")}
              </Button>
            )}
          </Link>

          <Separator className="opacity-50" />

          {/* Language Toggle */}
          <LanguageToggle compact={collapsed} />
        </div>
      </aside>

      <main className="flex-1 overflow-hidden bg-background flex flex-col">
        <HelpModal open={isHelpOpen} onClose={handleHelpClose} />

        {/* Top bar */}
        <div className="h-10 flex-shrink-0 border-b border-border/50 bg-background/80 backdrop-blur-sm flex items-center px-3 relative z-50">
          {/* Sidebar toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setCollapsed((c) => !c)}
                aria-label={collapseLabel}
                className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors me-1"
              >
                {collapsed
                  ? (dir === "rtl" ? <PanelRight className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />)
                  : (dir === "rtl" ? <PanelLeft className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />)}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{collapseLabel}</TooltipContent>
          </Tooltip>

          {/* Left spacer */}
          <div className="flex-1" />

          {/* Center — live monitoring status indicators */}
          <LayoutStatusBar monitorStatus={monitorStatus} liveState={liveState} t={t} />

          {/* Right — action buttons */}
          <div className="flex-1 flex items-center justify-end gap-1">
            {/* Smart monitoring control — expands on hover */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleToggleMonitoring}
                  disabled={pauseMonitor.isPending || resumeMonitor.isPending}
                  aria-label={monitorStatus?.paused ? t("dash.resumeMonitoring") : t("dash.pauseMonitoring")}
                  className="group/mon flex items-center h-7 px-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors overflow-hidden"
                >
                  <span className="flex items-center justify-center w-4 h-4 flex-shrink-0">
                    {monitorStatus?.paused
                      ? <Play className="h-4 w-4 text-green-500" />
                      : <Pause className="h-4 w-4" />}
                  </span>
                  <span className="text-[11px] font-medium whitespace-nowrap max-w-0 overflow-hidden group-hover/mon:max-w-[140px] group-hover/mon:ms-1.5 opacity-0 group-hover/mon:opacity-100 transition-all duration-200">
                    {monitorStatus?.paused
                      ? (resumeMonitor.isPending ? t("dash.resuming") : t("dash.resumeMonitoring"))
                      : (pauseMonitor.isPending ? t("dash.pausing") : t("dash.pauseMonitoring"))}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {monitorStatus?.paused ? t("dash.resumeMonitoring") : t("dash.pauseMonitoring")}
              </TooltipContent>
            </Tooltip>

            <div className="w-px h-4 bg-border/50 mx-0.5" />

          <NotificationButton />

          <Tooltip>
            <TooltipTrigger asChild>
              <Link href="/settings">
                <button
                  type="button"
                  aria-label={t("nav.settings")}
                  className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                >
                  <Settings className="h-4 w-4" />
                </button>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("nav.settings")}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                aria-label={t("help.open")}
                className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("help.open")} (?)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={theme === "dark" ? t("layout.switchLight") : t("layout.switchDark")}
                className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {theme === "dark" ? t("layout.switchLight") : t("layout.switchDark")}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleFullscreenToggle}
                aria-label={isFullscreen ? t("layout.exitFullscreen") : t("layout.enterFullscreen")}
                className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {isFullscreen ? t("layout.exitFullscreen") : t("layout.enterFullscreen")}
            </TooltipContent>
          </Tooltip>

          {/* User menu */}
          {user && (
            <>
              <div className="w-px h-4 bg-border/60 mx-0.5" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 h-7 px-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors text-xs font-medium max-w-[160px]"
                  >
                    <User className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">{displayName}</span>
                    {(() => {
                      const PresIcon = PRESENCE_ICONS[presenceStatus] ?? Circle;
                      return <PresIcon className={cn("h-2.5 w-2.5 flex-shrink-0 fill-current", PRESENCE_COLORS[presenceStatus])} />;
                    })()}
                    <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-60" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={dir === "rtl" ? "start" : "end"} className="w-52">
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                    {user.email}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-normal px-2 py-1">
                      {t("presence.setStatus")}
                    </DropdownMenuLabel>
                    {(["online", "away", "busy", "offline"] as PresenceStatus[]).map((s) => {
                      const Icon = PRESENCE_ICONS[s];
                      return (
                        <DropdownMenuItem
                          key={s}
                          className="cursor-pointer gap-2"
                          onClick={() => handleSetPresence(s)}
                        >
                          <Icon className={cn("h-3.5 w-3.5 fill-current", PRESENCE_COLORS[s])} />
                          <span className={presenceStatus === s ? "font-semibold" : ""}>{t(`presence.${s}`)}</span>
                          {presenceStatus === s && <ShieldCheck className="h-3 w-3 ms-auto text-primary" />}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <Link href="/profile">
                      <DropdownMenuItem className="cursor-pointer">
                        <User className="h-4 w-4 me-2" />
                        {t("nav.profile")}
                      </DropdownMenuItem>
                    </Link>
                    {(user.role === "admin" || user.role === "founder") && (
                      <Link href="/users">
                        <DropdownMenuItem className="cursor-pointer">
                          <Users className="h-4 w-4 me-2" />
                          {t("nav.users")}
                        </DropdownMenuItem>
                      </Link>
                    )}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive cursor-pointer"
                    onClick={() => logout()}
                  >
                    <LogOut className="h-4 w-4 me-2" />
                    {t("auth.logout")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          </div>{/* end right action buttons */}
        </div>{/* end topbar */}

        {/* Page content */}
        <div className="flex-1 overflow-y-auto">
          <div className="min-h-full flex flex-col">
            <div className="flex-1">{children}</div>
            <footer className="flex items-center justify-center gap-2 py-2 px-4 border-t border-border/30 bg-background/60 backdrop-blur-md">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-muted-foreground/50 flex-shrink-0"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                <path d="M2 12h20" />
              </svg>
              <span className="text-[11px] text-muted-foreground/50 select-none">
                {t("footer.poweredBy")} ©
              </span>
            </footer>
          </div>
        </div>
      </main>
    </div>
  );
}
