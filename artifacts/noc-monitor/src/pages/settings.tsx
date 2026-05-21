import React, { useEffect, useState, useCallback } from "react";
import { useNotifications } from "@/contexts/notifications";
import { formatDistanceToNow } from "date-fns";
import {
  useGetNextcloudTalkStatus,
  getGetNextcloudTalkStatusQueryKey,
  useSendTestNextcloudTalk,
  useGetAppSettings,
  getGetAppSettingsQueryKey,
  useUpdateAppSettings,
  UpdateAppSettingsBodyAlertLanguage,
  useListDnsResolvers,
  useAddDnsResolvers,
  useDeleteDnsResolver,
  getListDnsResolversQueryKey,
  type AppSettings,
  type DnsResolverEntry,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/i18n/LanguageProvider";
import { useTheme } from "@/theme/ThemeProvider";
import {
  Bell,
  CheckCircle2,
  XCircle,
  AlertCircle,
  DoorOpen,
  Save,
  Palette,
  Activity,
  Eye,
  Lock,
  Plus,
  Server,
  Trash2,
  Loader2,
  Database,
  Play,
  Wifi,
  ExternalLink,
} from "lucide-react";
import { Link } from "wouter";
import { Textarea } from "@/components/ui/textarea";

type Severity = "info" | "warning" | "critical";

export default function SettingsPage() {
  const { t } = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { setTheme, theme } = useTheme();

  const { data: status, isLoading } = useGetNextcloudTalkStatus({
    query: {
      queryKey: getGetNextcloudTalkStatusQueryKey(),
      refetchInterval: 30_000,
    },
  });

  const testAlert = useSendTestNextcloudTalk();

  const { data: appSettings, isLoading: appSettingsLoading } = useGetAppSettings({
    query: {
      queryKey: getGetAppSettingsQueryKey(),
      refetchInterval: 60_000,
    },
  });
  const updateAppSettings = useUpdateAppSettings();

  // Local copies for numeric inputs (apply on click instead of blur).
  const [currentlyFineDuration, setCurrentlyFineDuration] = useState<string>(() => {
    try { return window.localStorage.getItem("noc.currentlyFine.defaultDurationMs") ?? "3600000"; } catch { return "3600000"; }
  });
  const [intervalSec, setIntervalSec] = useState<number>(120);
  const [failureThreshold, setFailureThreshold] = useState<number>(2);
  const [recoveryThreshold, setRecoveryThreshold] = useState<number>(2);
  const [requestTimeoutMs, setRequestTimeoutMs] = useState<number>(15_000);
  const [slowResponseMs, setSlowResponseMs] = useState<number>(2_000);
  const [alertCooldownSec, setAlertCooldownSec] = useState<number>(900);
  const [autoRefreshSec, setAutoRefreshSec] = useState<number>(30);
  const [sslExpiryAlertDays, setSslExpiryAlertDays] = useState<number>(30);

  const [connAutoChecks, setConnAutoChecks] = useState<boolean>(true);
  const [connPauseWhileOffline, setConnPauseWhileOffline] = useState<boolean>(true);
  const [connOfflinePopup, setConnOfflinePopup] = useState<boolean>(true);
  const [connNotifications, setConnNotifications] = useState<boolean>(false);
  const [connOfflineRetry, setConnOfflineRetry] = useState<number>(5);
  const [connPingTimeout, setConnPingTimeout] = useState<number>(3000);
  const [connPingAttempts, setConnPingAttempts] = useState<number>(1);
  const [connCheckAfterSweep, setConnCheckAfterSweep] = useState<boolean>(true);
  const [connEmergencyCheck, setConnEmergencyCheck] = useState<boolean>(true);
  const [connEmergencyThreshold, setConnEmergencyThreshold] = useState<number>(3);

  useEffect(() => {
    if (!appSettings) return;
    setIntervalSec(Math.round(appSettings.monitorIntervalMs / 1000));
    setFailureThreshold(appSettings.failureThreshold);
    setRecoveryThreshold(appSettings.recoveryThreshold);
    setRequestTimeoutMs(appSettings.requestTimeoutMs);
    setSlowResponseMs(appSettings.slowResponseMs);
    setAlertCooldownSec(appSettings.alertCooldownSec);
    setAutoRefreshSec(appSettings.autoRefreshSec);
    setSslExpiryAlertDays((appSettings as any).sslExpiryAlertDays ?? 30);
    setConnAutoChecks((appSettings as any).connectivityAutoChecksEnabled ?? true);
    setConnPauseWhileOffline((appSettings as any).connectivityPauseWhileOffline ?? true);
    setConnOfflinePopup((appSettings as any).connectivityOfflinePopupEnabled ?? true);
    setConnNotifications((appSettings as any).connectivityNotificationsEnabled ?? false);
    setConnOfflineRetry(Math.round(((appSettings as any).connectivityOfflineRetryMs ?? 5_000) / 1000));
    setConnPingTimeout((appSettings as any).connectivityPingTimeoutMs ?? 3000);
    setConnPingAttempts((appSettings as any).connectivityPingAttempts ?? 1);
    setConnCheckAfterSweep((appSettings as any).connectivityCheckAfterSweep ?? true);
    setConnEmergencyCheck((appSettings as any).connectivityEmergencyCheckEnabled ?? true);
    setConnEmergencyThreshold((appSettings as any).connectivityEmergencyDownThreshold ?? 3);
  }, [appSettings]);

  const handleTest = () => {
    testAlert.mutate(undefined, {
      onSuccess: (data) => {
        if (data.sent) {
          toast({
            title: t("settings.nc.testSentTitle"),
            description: t("settings.nc.testSentDesc"),
          });
        } else {
          toast({
            title: t("settings.nc.testFailedTitle"),
            description: data.reason ?? t("settings.nc.testFailedDesc"),
            variant: "destructive",
          });
        }
        queryClient.invalidateQueries({
          queryKey: getGetNextcloudTalkStatusQueryKey(),
        });
      },
      onError: () => {
        toast({
          title: t("settings.nc.testFailedTitle"),
          description: t("settings.nc.testFailedDesc"),
          variant: "destructive",
        });
      },
    });
  };

  const persistSettings = (patch: Partial<AppSettings>) => {
    updateAppSettings.mutate(
      { data: patch as Parameters<typeof updateAppSettings.mutate>[0]["data"] },
      {
        onSuccess: () => {
          toast({
            title: t("settings.app.saved"),
            description: t("settings.app.savedDesc"),
          });
          queryClient.invalidateQueries({ queryKey: getGetAppSettingsQueryKey() });
        },
        onError: (err) => {
          toast({
            title: t("settings.app.saveError"),
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
        },
      },
    );
  };

  const toggleSeverity = (sev: Severity) => {
    if (!appSettings) return;
    const cur = new Set(appSettings.alertSeverities ?? []);
    if (cur.has(sev)) cur.delete(sev);
    else cur.add(sev);
    if (cur.size === 0) cur.add("critical"); // never let it become empty
    persistSettings({ alertSeverities: Array.from(cur) as Severity[] });
  };

  const ALL_ALERT_TYPES_LIST = ["site_down", "site_recovered", "ssl_expiring", "dns_failure", "http_5xx", "tcp_unreachable", "incident_critical", "incident_resolved"] as const;
  type AlertTypeKey = typeof ALL_ALERT_TYPES_LIST[number];

  const toggleAlertType = (type: AlertTypeKey) => {
    if (!appSettings) return;
    const current = ((appSettings as any).alertTypes ?? [...ALL_ALERT_TYPES_LIST]) as AlertTypeKey[];
    const cur = new Set<AlertTypeKey>(current);
    if (cur.has(type)) {
      if (cur.size === 1) return;
      cur.delete(type);
    } else {
      cur.add(type);
    }
    persistSettings({ alertTypes: Array.from(cur) } as any);
  };

  const settingsReady = !appSettingsLoading && !!appSettings;

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  type NavItem = { id: string; labelKey: string; Icon: React.ElementType };
  const NAV_ITEMS: NavItem[] = [
    { id: "section-monitoring", labelKey: "settings.section.monitoring", Icon: Activity },
    { id: "section-alerts",     labelKey: "settings.section.alerts",     Icon: Bell },
    { id: "section-nextcloud",  labelKey: "settings.nc.title",           Icon: Bell },
    { id: "section-browser",    labelKey: "settings.notif.section",      Icon: Bell },
    { id: "section-display",    labelKey: "settings.section.display",    Icon: Eye },
    { id: "section-fine",       labelKey: "settings.currentlyFine.title",Icon: CheckCircle2 },
    { id: "section-theme",      labelKey: "settings.section.theme",      Icon: Palette },
    { id: "section-connectivity",labelKey: "settings.section.connectivity",Icon: Wifi },
    { id: "section-dns",        labelKey: "dns.resolvers.title",         Icon: Server },
    { id: "section-retention",  labelKey: "settings.section.retention",  Icon: Database },
  ];

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{t("settings.title")}</h2>
        <p className="text-muted-foreground mt-1">{t("settings.subtitle")}</p>
      </div>

      {/* ── Section shortcuts nav ────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 -mx-8 px-8 py-2 bg-background/90 backdrop-blur border-b border-border/50">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-0.5">
          {NAV_ITEMS.map(({ id, labelKey, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => scrollTo(id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex-shrink-0"
            >
              <Icon className="h-3.5 w-3.5" />
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Monitoring engine ───────────────────────────────────────────── */}
      <Card id="section-monitoring">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" /> {t("settings.section.monitoring")}
          </CardTitle>
          <CardDescription>{t("settings.section.monitoringDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!settingsReady ? (
            <Skeleton className="h-60 w-full" />
          ) : (
            <>
              <NumericRow
                label={t("settings.app.monitorInterval")}
                desc={t("settings.app.monitorIntervalDesc")}
                value={intervalSec}
                onChange={setIntervalSec}
                onApply={() =>
                  persistSettings({
                    monitorIntervalMs: Math.max(30_000, Math.round(intervalSec * 1000)),
                  })
                }
                disabled={
                  updateAppSettings.isPending ||
                  Math.round(appSettings.monitorIntervalMs / 1000) === intervalSec ||
                  intervalSec < 30
                }
                min={30}
                step={5}
                applyLabel={t("settings.app.monitorIntervalApply")}
              />

              <NumericRow
                label={t("settings.mon.failureThreshold")}
                desc={t("settings.mon.failureThresholdDesc")}
                value={failureThreshold}
                onChange={setFailureThreshold}
                onApply={() => persistSettings({ failureThreshold })}
                disabled={
                  updateAppSettings.isPending ||
                  appSettings.failureThreshold === failureThreshold ||
                  failureThreshold < 1 ||
                  failureThreshold > 10
                }
                min={1}
                max={10}
                step={1}
                applyLabel={t("common.save")}
              />

              <NumericRow
                label={t("settings.mon.recoveryThreshold")}
                desc={t("settings.mon.recoveryThresholdDesc")}
                value={recoveryThreshold}
                onChange={setRecoveryThreshold}
                onApply={() => persistSettings({ recoveryThreshold })}
                disabled={
                  updateAppSettings.isPending ||
                  appSettings.recoveryThreshold === recoveryThreshold ||
                  recoveryThreshold < 1 ||
                  recoveryThreshold > 10
                }
                min={1}
                max={10}
                step={1}
                applyLabel={t("common.save")}
              />

              <NumericRow
                label={t("settings.mon.requestTimeout")}
                desc={t("settings.mon.requestTimeoutDesc")}
                value={requestTimeoutMs}
                onChange={setRequestTimeoutMs}
                onApply={() => persistSettings({ requestTimeoutMs })}
                disabled={
                  updateAppSettings.isPending ||
                  appSettings.requestTimeoutMs === requestTimeoutMs ||
                  requestTimeoutMs < 2_000 ||
                  requestTimeoutMs > 60_000
                }
                min={2_000}
                max={60_000}
                step={500}
                applyLabel={t("common.save")}
              />

              <NumericRow
                label={t("settings.mon.slowResponse")}
                desc={t("settings.mon.slowResponseDesc")}
                value={slowResponseMs}
                onChange={setSlowResponseMs}
                onApply={() => persistSettings({ slowResponseMs })}
                disabled={
                  updateAppSettings.isPending ||
                  appSettings.slowResponseMs === slowResponseMs ||
                  slowResponseMs < 200 ||
                  slowResponseMs > 30_000
                }
                min={200}
                max={30_000}
                step={100}
                applyLabel={t("common.save")}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Alerts ──────────────────────────────────────────────────────── */}
      <Card id="section-alerts">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" /> {t("settings.section.alerts")}
          </CardTitle>
          <CardDescription>{t("settings.section.alertsDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!settingsReady ? (
            <Skeleton className="h-60 w-full" />
          ) : (
            <>
              {/* Master alerts switch */}
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 max-w-xl">
                  <Label className="text-sm font-medium">{t("settings.app.alertsEnabled")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.app.alertsEnabledDesc")}
                  </p>
                </div>
                <Switch
                  checked={appSettings.nextcloudAlertsEnabled}
                  disabled={updateAppSettings.isPending}
                  onCheckedChange={(v) => persistSettings({ nextcloudAlertsEnabled: v })}
                />
              </div>

              <div className="flex items-start justify-between gap-4 border-t pt-6">
                <div className="space-y-1 max-w-xl">
                  <Label className="text-sm font-medium">{t("settings.app.suppressResolved")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.app.suppressResolvedDesc")}
                  </p>
                </div>
                <Switch
                  checked={appSettings.suppressResolvedAlerts}
                  disabled={updateAppSettings.isPending}
                  onCheckedChange={(v) => persistSettings({ suppressResolvedAlerts: v })}
                />
              </div>

              <div className="flex items-start justify-between gap-4 border-t pt-6">
                <div className="space-y-1 max-w-xl">
                  <Label className="text-sm font-medium">{t("settings.app.alertLanguage")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.app.alertLanguageDesc")}
                  </p>
                </div>
                <Select
                  value={appSettings.alertLanguage}
                  disabled={updateAppSettings.isPending}
                  onValueChange={(v) =>
                    persistSettings({
                      alertLanguage: v as typeof UpdateAppSettingsBodyAlertLanguage[keyof typeof UpdateAppSettingsBodyAlertLanguage],
                    })
                  }
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fa">{t("settings.app.alertLanguage.fa")}</SelectItem>
                    <SelectItem value="en">{t("settings.app.alertLanguage.en")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Severity gating */}
              <div className="border-t pt-6 space-y-3">
                <div className="space-y-1 max-w-xl">
                  <Label className="text-sm font-medium">{t("settings.alert.severities")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.alert.severitiesDesc")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["info", "warning", "critical"] as const).map((sev) => {
                    const active = (appSettings.alertSeverities ?? []).includes(sev);
                    const labelKey =
                      sev === "info"
                        ? "settings.alert.severityInfo"
                        : sev === "warning"
                          ? "settings.alert.severityWarning"
                          : "settings.alert.severityCritical";
                    return (
                      <Button
                        key={sev}
                        size="sm"
                        variant={active ? "default" : "outline"}
                        onClick={() => toggleSeverity(sev)}
                        disabled={updateAppSettings.isPending}
                      >
                        {t(labelKey)}
                      </Button>
                    );
                  })}
                </div>
              </div>

              {/* Alert type filter */}
              <div className="border-t pt-6 space-y-3">
                <div className="space-y-1 max-w-xl">
                  <Label className="text-sm font-medium">{t("settings.alert.types")}</Label>
                  <p className="text-xs text-muted-foreground">{t("settings.alert.typesDesc")}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {ALL_ALERT_TYPES_LIST.map((type) => {
                    const active = (((appSettings as any).alertTypes ?? [...ALL_ALERT_TYPES_LIST]) as string[]).includes(type);
                    return (
                      <Button
                        key={type}
                        size="sm"
                        variant={active ? "default" : "outline"}
                        onClick={() => toggleAlertType(type)}
                        disabled={updateAppSettings.isPending}
                      >
                        {t(`settings.alert.type.${type}`)}
                      </Button>
                    );
                  })}
                </div>
              </div>

              {/* SSL expiry alert threshold */}
              <div className="border-t pt-6">
                <NumericRow
                  label={t("settings.alert.sslExpiryDays")}
                  desc={t("settings.alert.sslExpiryDaysDesc")}
                  value={sslExpiryAlertDays}
                  onChange={setSslExpiryAlertDays}
                  onApply={() => persistSettings({ sslExpiryAlertDays } as any)}
                  disabled={
                    updateAppSettings.isPending ||
                    ((appSettings as any).sslExpiryAlertDays ?? 30) === sslExpiryAlertDays ||
                    sslExpiryAlertDays < 1 ||
                    sslExpiryAlertDays > 90
                  }
                  min={1}
                  max={90}
                  step={1}
                  applyLabel={t("common.save")}
                />
              </div>

              {/* Post-sweep persistent-down alert */}
              <div className="flex items-start justify-between gap-4 border-t pt-6">
                <div className="space-y-1 max-w-xl">
                  <Label className="text-sm font-medium">{t("settings.alert.persistentDown")}</Label>
                  <p className="text-xs text-muted-foreground">{t("settings.alert.persistentDownDesc")}</p>
                </div>
                <Switch
                  checked={!!((appSettings as any).alertPersistentDown)}
                  disabled={updateAppSettings.isPending}
                  onCheckedChange={(v) => persistSettings({ alertPersistentDown: v } as any)}
                />
              </div>

              <div className="border-t pt-6">
                <NumericRow
                  label={t("settings.alert.cooldown")}
                  desc={t("settings.alert.cooldownDesc")}
                  value={alertCooldownSec}
                  onChange={setAlertCooldownSec}
                  onApply={() => persistSettings({ alertCooldownSec })}
                  disabled={
                    updateAppSettings.isPending ||
                    appSettings.alertCooldownSec === alertCooldownSec ||
                    alertCooldownSec < 30 ||
                    alertCooldownSec > 86_400
                  }
                  min={30}
                  max={86_400}
                  step={30}
                  applyLabel={t("common.save")}
                />
              </div>

              <p className="text-xs text-muted-foreground border-t pt-4">
                {t("settings.app.consecutiveDownNote")}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Nextcloud Talk integration ──────────────────────────────────── */}
      <Card id="section-nextcloud">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" /> {t("settings.nc.title")}
          </CardTitle>
          <CardDescription>{t("settings.nc.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                {status?.configured ? (
                  <Badge className="bg-success text-success-foreground">
                    <CheckCircle2 className="h-3 w-3 mr-1" />{" "}
                    {t("settings.nc.statusConfigured")}
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <XCircle className="h-3 w-3 mr-1" /> {t("settings.nc.statusUnconfigured")}
                  </Badge>
                )}
                {status && status.roomCount > 0 && (
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <DoorOpen className="h-3.5 w-3.5" />
                    {t("settings.nc.roomCount")}: {status.roomCount}
                  </span>
                )}
              </div>

              {!status?.configured && (
                <div className="text-sm text-muted-foreground border rounded-md p-3 bg-muted/30 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                    <div className="space-y-2 w-full">
                      <p>{t("settings.nc.setupHelp")}</p>
                      <div className="space-y-1 font-mono text-xs" dir="ltr">
                        {[
                          { label: "NEXTCLOUD_TALK_URL", ok: status?.hasUrl },
                          { label: "NEXTCLOUD_TALK_USER", ok: status?.hasUser },
                          { label: "NEXTCLOUD_TALK_PASSWORD", ok: status?.hasPassword },
                          {
                            label: "NEXTCLOUD_TALK_ROOM  (or NEXTCLOUD_TALK_ROOMS)",
                            ok: status ? status.roomCount > 0 : false,
                          },
                        ].map(({ label, ok }) => (
                          <div key={label} className="flex items-center gap-2">
                            {ok ? (
                              <CheckCircle2 className="h-3 w-3 text-success shrink-0" />
                            ) : (
                              <XCircle className="h-3 w-3 text-destructive shrink-0" />
                            )}
                            <span className={ok ? "line-through opacity-50" : ""}>{label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-1">
                  <div className="text-muted-foreground">{t("settings.nc.lastAlertAt")}</div>
                  <div dir="ltr">
                    {status?.lastAlertAt
                      ? formatDistanceToNow(new Date(status.lastAlertAt), { addSuffix: true })
                      : t("common.never")}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-muted-foreground">{t("settings.nc.lastAlertType")}</div>
                  <div dir="ltr" className="font-mono text-xs">
                    {status?.lastAlertType ?? "—"}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-muted-foreground">{t("settings.nc.lastAlertResult")}</div>
                  <div>
                    {status?.lastAlertSuccess === true ? (
                      <Badge className="bg-success text-success-foreground">OK</Badge>
                    ) : status?.lastAlertSuccess === false ? (
                      <Badge variant="destructive">FAIL</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
                {status?.lastAlertError && (
                  <div className="space-y-1">
                    <div className="text-muted-foreground">{t("settings.nc.lastAlertError")}</div>
                    <div className="font-mono text-xs text-destructive break-all" dir="ltr">
                      {status.lastAlertError}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <Button
                  onClick={handleTest}
                  disabled={!status?.configured || testAlert.isPending}
                  className="gap-2"
                >
                  <Bell className="h-4 w-4" />
                  {testAlert.isPending
                    ? t("settings.nc.sending")
                    : t("settings.nc.sendTest")}
                </Button>
                {!status?.configured && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {t("settings.nc.testDisabledHint")}
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Browser Notifications ────────────────────────────────────────── */}
      <div id="section-browser"><BrowserNotificationsSection /></div>

      {/* ── Display ─────────────────────────────────────────────────────── */}
      <Card id="section-display">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" /> {t("settings.section.display")}
          </CardTitle>
          <CardDescription>{t("settings.section.displayDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!settingsReady ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <NumericRow
                label={t("settings.display.autoRefresh")}
                desc={t("settings.display.autoRefreshDesc")}
                value={autoRefreshSec}
                onChange={setAutoRefreshSec}
                onApply={() => persistSettings({ autoRefreshSec })}
                disabled={
                  updateAppSettings.isPending ||
                  appSettings.autoRefreshSec === autoRefreshSec ||
                  autoRefreshSec < 5 ||
                  autoRefreshSec > 600
                }
                min={5}
                max={600}
                step={5}
                applyLabel={t("common.save")}
              />

              <div className="flex items-start justify-between gap-4 border-t pt-6">
                <div className="space-y-1 max-w-xl">
                  <Label className="text-sm font-medium">{t("settings.display.dateFormat")}</Label>
                </div>
                <Select
                  value={appSettings.dateFormat}
                  disabled={updateAppSettings.isPending}
                  onValueChange={(v) =>
                    persistSettings({ dateFormat: v as AppSettings["dateFormat"] })
                  }
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="relative">
                      {t("settings.display.dateFormatRelative")}
                    </SelectItem>
                    <SelectItem value="local">{t("settings.display.dateFormatLocal")}</SelectItem>
                    <SelectItem value="iso">{t("settings.display.dateFormatIso")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-start justify-between gap-4 border-t pt-6">
                <div className="space-y-1 max-w-xl">
                  <Label className="text-sm font-medium">{t("settings.defaultView")}</Label>
                  <p className="text-xs text-muted-foreground">{t("settings.defaultViewDesc")}</p>
                </div>
                <Select
                  value={appSettings.defaultDashboardView ?? "list"}
                  disabled={updateAppSettings.isPending}
                  onValueChange={(v) => {
                    const mode = v as AppSettings["defaultDashboardView"];
                    persistSettings({ defaultDashboardView: mode });
                    try {
                      window.localStorage.setItem("noc.sites.viewMode", v);
                    } catch { /* ignore */ }
                  }}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="list">{t("settings.defaultViewList")}</SelectItem>
                    <SelectItem value="grid">{t("settings.defaultViewGrid")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Currently Fine Duration ─────────────────────────────────── */}
      <Card id="section-fine">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" /> {t("settings.currentlyFine.title")}
          </CardTitle>
          <CardDescription>{t("settings.currentlyFine.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1 max-w-xl">
              <Label className="text-sm font-medium">{t("settings.currentlyFine.title")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.currentlyFine.desc")}</p>
            </div>
            <Select
              value={currentlyFineDuration}
              onValueChange={(v) => {
                setCurrentlyFineDuration(v);
                try { window.localStorage.setItem("noc.currentlyFine.defaultDurationMs", v); } catch { /* ignore */ }
              }}
            >
              <SelectTrigger className="w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3600000">{t("settings.currentlyFine.1h")}</SelectItem>
                <SelectItem value="21600000">{t("settings.currentlyFine.6h")}</SelectItem>
                <SelectItem value="43200000">{t("settings.currentlyFine.12h")}</SelectItem>
                <SelectItem value="86400000">{t("settings.currentlyFine.1d")}</SelectItem>
                <SelectItem value="0">{t("settings.currentlyFine.permanent")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── Appearance / Theme ──────────────────────────────────────────── */}
      <Card id="section-theme">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" /> {t("settings.section.theme")}
          </CardTitle>
          <CardDescription>{t("settings.section.themeDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!settingsReady ? (
            <Skeleton className="h-12 w-full" />
          ) : (
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1 max-w-xl">
                <Label className="text-sm font-medium">{t("settings.theme.mode")}</Label>
              </div>
              <Select
                value={theme}
                disabled={updateAppSettings.isPending}
                onValueChange={(v) => {
                  if (v === "system") {
                    setTheme("system");
                  } else {
                    const mode = v === "light" ? "light" : "dark";
                    setTheme(mode);
                    persistSettings({ themeMode: mode });
                  }
                }}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">{t("settings.theme.system")}</SelectItem>
                  <SelectItem value="dark">{t("settings.theme.dark")}</SelectItem>
                  <SelectItem value="light">{t("settings.theme.light")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Network Connectivity ──────────────────────────────────────────── */}
      <Card id="section-connectivity">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wifi className="h-5 w-5" /> {t("settings.section.connectivity")}
          </CardTitle>
          <CardDescription>{t("settings.section.connectivityDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!settingsReady ? (
            <Skeleton className="h-56 w-full" />
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 max-w-xl">
                  <Label className="text-sm font-medium">{t("settings.conn.autoChecks")}</Label>
                  <p className="text-xs text-muted-foreground">{t("settings.conn.autoChecksDesc")}</p>
                </div>
                <Switch
                  checked={connAutoChecks}
                  disabled={updateAppSettings.isPending}
                  onCheckedChange={(v) => {
                    setConnAutoChecks(v);
                    persistSettings({ connectivityAutoChecksEnabled: v } as any);
                  }}
                />
              </div>

              <div className="flex items-start justify-between gap-4 border-t pt-6">
                <div className="space-y-1 max-w-xl">
                  <Label className="text-sm font-medium">{t("settings.conn.pauseWhileOffline")}</Label>
                  <p className="text-xs text-muted-foreground">{t("settings.conn.pauseWhileOfflineDesc")}</p>
                </div>
                <Switch
                  checked={connPauseWhileOffline}
                  disabled={updateAppSettings.isPending}
                  onCheckedChange={(v) => {
                    setConnPauseWhileOffline(v);
                    persistSettings({ connectivityPauseWhileOffline: v } as any);
                  }}
                />
              </div>

              <div className="flex items-start justify-between gap-4 border-t pt-6">
                <div className="space-y-1 max-w-xl">
                  <Label className="text-sm font-medium">{t("settings.conn.offlinePopup")}</Label>
                  <p className="text-xs text-muted-foreground">{t("settings.conn.offlinePopupDesc")}</p>
                </div>
                <Switch
                  checked={connOfflinePopup}
                  disabled={updateAppSettings.isPending}
                  onCheckedChange={(v) => {
                    setConnOfflinePopup(v);
                    persistSettings({ connectivityOfflinePopupEnabled: v } as any);
                  }}
                />
              </div>

              <div className="flex items-start justify-between gap-4 border-t pt-6">
                <div className="space-y-1 max-w-xl">
                  <Label className="text-sm font-medium">{t("settings.conn.checkAfterSweep")}</Label>
                  <p className="text-xs text-muted-foreground">{t("settings.conn.checkAfterSweepDesc")}</p>
                </div>
                <Switch
                  checked={connCheckAfterSweep}
                  disabled={updateAppSettings.isPending}
                  onCheckedChange={(v) => {
                    setConnCheckAfterSweep(v);
                    persistSettings({ connectivityCheckAfterSweep: v } as any);
                  }}
                />
              </div>

              <div className="flex items-start justify-between gap-4 border-t pt-6">
                <div className="space-y-1 max-w-xl">
                  <Label className="text-sm font-medium">{t("settings.conn.emergencyCheck")}</Label>
                  <p className="text-xs text-muted-foreground">{t("settings.conn.emergencyCheckDesc")}</p>
                </div>
                <Switch
                  checked={connEmergencyCheck}
                  disabled={updateAppSettings.isPending}
                  onCheckedChange={(v) => {
                    setConnEmergencyCheck(v);
                    persistSettings({ connectivityEmergencyCheckEnabled: v } as any);
                  }}
                />
              </div>

              <div className="border-t pt-6">
                <NumericRow
                  label={t("settings.conn.emergencyThreshold")}
                  desc={t("settings.conn.emergencyThresholdDesc")}
                  value={connEmergencyThreshold}
                  onChange={setConnEmergencyThreshold}
                  onApply={() => persistSettings({ connectivityEmergencyDownThreshold: connEmergencyThreshold } as any)}
                  disabled={
                    updateAppSettings.isPending ||
                    ((appSettings as any).connectivityEmergencyDownThreshold ?? 3) === connEmergencyThreshold ||
                    connEmergencyThreshold < 1 || connEmergencyThreshold > 20
                  }
                  min={1}
                  max={20}
                  step={1}
                  applyLabel={t("common.save")}
                />
              </div>

              <div className="border-t pt-6">
                <NumericRow
                  label={t("settings.conn.offlineRetry")}
                  desc={t("settings.conn.offlineRetryDesc")}
                  value={connOfflineRetry}
                  onChange={setConnOfflineRetry}
                  onApply={() => persistSettings({ connectivityOfflineRetryMs: connOfflineRetry * 1000 } as any)}
                  disabled={
                    updateAppSettings.isPending ||
                    ((appSettings as any).connectivityOfflineRetryMs ?? 5_000) === connOfflineRetry * 1000 ||
                    connOfflineRetry < 2 || connOfflineRetry > 60
                  }
                  min={2}
                  max={60}
                  step={1}
                  applyLabel={t("common.save")}
                />
              </div>

              <div className="border-t pt-6">
                <NumericRow
                  label={t("settings.conn.pingTimeout")}
                  desc={t("settings.conn.pingTimeoutDesc")}
                  value={connPingTimeout}
                  onChange={setConnPingTimeout}
                  onApply={() => persistSettings({ connectivityPingTimeoutMs: connPingTimeout } as any)}
                  disabled={
                    updateAppSettings.isPending ||
                    ((appSettings as any).connectivityPingTimeoutMs ?? 3_000) === connPingTimeout ||
                    connPingTimeout < 1000 || connPingTimeout > 10_000
                  }
                  min={1000}
                  max={10000}
                  step={500}
                  applyLabel={t("common.save")}
                />
              </div>

              <div className="border-t pt-6">
                <NumericRow
                  label={t("settings.conn.pingAttempts")}
                  desc={t("settings.conn.pingAttemptsDesc")}
                  value={connPingAttempts}
                  onChange={setConnPingAttempts}
                  onApply={() => persistSettings({ connectivityPingAttempts: connPingAttempts } as any)}
                  disabled={
                    updateAppSettings.isPending ||
                    ((appSettings as any).connectivityPingAttempts ?? 1) === connPingAttempts ||
                    connPingAttempts < 1 || connPingAttempts > 5
                  }
                  min={1}
                  max={5}
                  step={1}
                  applyLabel={t("common.save")}
                />
              </div>

              <div className="border-t pt-6">
                <Link href="/connectivity">
                  <Button variant="outline" size="sm" className="gap-2">
                    <ExternalLink className="h-4 w-4" />
                    {t("settings.conn.viewPage")}
                  </Button>
                </Link>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── DNS Resolvers ────────────────────────────────────────────────── */}
      <div id="section-dns"><DnsResolversSection /></div>

      {/* ── Data Retention ──────────────────────────────────────────────── */}
      <div id="section-retention"><DataRetentionSection /></div>
    </div>
  );
}

function BrowserNotificationsSection() {
  const { t } = useT();
  const { prefs, setPrefs, permission, requestPermission, sendTestNotification } = useNotifications();
  const { toast } = useToast();

  type Sev = "critical" | "warning" | "info";
  const severities: Sev[] = ["critical", "warning", "info"];

  type EvType = "incident_new" | "incident_resolved" | "sweep_started" | "sweep_completed" | "connectivity_lost" | "connectivity_restored";
  const eventTypes: { key: EvType; label: string; labelFa?: string }[] = [
    { key: "incident_new", label: t("settings.notif.type.incident_new") },
    { key: "incident_resolved", label: t("settings.notif.type.incident_resolved") },
    { key: "sweep_started", label: t("settings.notif.type.sweep_started") },
    { key: "sweep_completed", label: t("settings.notif.type.sweep_completed") },
    { key: "connectivity_lost", label: t("settings.notif.type.connectivity_lost") },
    { key: "connectivity_restored", label: t("settings.notif.type.connectivity_restored") },
  ];

  const toggleSev = (sev: Sev) => {
    const cur = new Set<Sev>(prefs.severity as Sev[]);
    if (cur.has(sev)) {
      if (cur.size === 1) return;
      cur.delete(sev);
    } else {
      cur.add(sev);
    }
    setPrefs({ ...prefs, severity: Array.from(cur) });
  };

  const toggleType = (evType: EvType) => {
    const cur = new Set<EvType>(prefs.types as EvType[]);
    if (cur.has(evType)) {
      if (cur.size === 1) return;
      cur.delete(evType);
    } else {
      cur.add(evType);
    }
    setPrefs({ ...prefs, types: Array.from(cur) });
  };

  const handleTestNotif = () => {
    if (permission !== "granted") {
      toast({ title: t("settings.notif.testNoPermission"), variant: "destructive" });
      return;
    }
    sendTestNotification();
    toast({ title: t("settings.notif.testSent") });
  };

  const permissionLabel = () => {
    if (permission === "unsupported") return t("settings.notif.permissionUnsupported");
    if (permission === "granted") return t("settings.notif.permissionGranted");
    if (permission === "denied") return t("settings.notif.permissionDenied");
    return t("settings.notif.permissionDefault");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" /> {t("settings.notif.section")}
        </CardTitle>
        <CardDescription>{t("settings.notif.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">{t("settings.notif.enable")}</Label>
            <p className="text-xs text-muted-foreground">{t("settings.notif.desc")}</p>
          </div>
          <Switch
            checked={prefs.enabled}
            onCheckedChange={(v) => setPrefs({ ...prefs, enabled: v })}
            disabled={permission === "unsupported"}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">{t("settings.notif.permission")}</Label>
              <p className="text-xs text-muted-foreground">{permissionLabel()}</p>
            </div>
            {permission !== "unsupported" && permission !== "granted" && permission !== "denied" && (
              <Button size="sm" variant="outline" onClick={requestPermission}>
                {t("settings.notif.requestBtn")}
              </Button>
            )}
            {permission === "granted" && (
              <Badge className="bg-green-500/15 text-green-600 dark:text-green-400 border-0">
                <CheckCircle2 className="h-3 w-3 me-1" />
                {t("settings.notif.permissionGranted")}
              </Badge>
            )}
            {permission === "denied" && (
              <Badge variant="destructive" className="border-0">
                <XCircle className="h-3 w-3 me-1" />
                {t("settings.notif.permissionDenied")}
              </Badge>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">{t("settings.notif.severities")}</Label>
          <div className="flex gap-2 flex-wrap">
            {severities.map((sev) => {
              const active = (prefs.severity as string[]).includes(sev);
              return (
                <button
                  key={sev}
                  type="button"
                  onClick={() => toggleSev(sev)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    active
                      ? sev === "critical"
                        ? "bg-destructive/20 text-destructive border-destructive/40"
                        : sev === "warning"
                          ? "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/40"
                          : "bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/40"
                      : "bg-muted text-muted-foreground border-border"
                  }`}
                >
                  {t(`severity.${sev}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">{t("settings.notif.types")}</Label>
          <div className="flex gap-2 flex-wrap">
            {eventTypes.map(({ key, label }) => {
              const active = (prefs.types as string[]).includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleType(key)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    active
                      ? "bg-primary/15 text-primary border-primary/40"
                      : "bg-muted text-muted-foreground border-border"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">{t("settings.notif.sound")}</Label>
          </div>
          <Switch
            checked={prefs.sound}
            onCheckedChange={(v) => setPrefs({ ...prefs, sound: v })}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">{t("settings.notif.requireInteraction")}</Label>
            <p className="text-xs text-muted-foreground">{t("settings.notif.requireInteractionDesc")}</p>
          </div>
          <Switch
            checked={prefs.requireInteraction}
            onCheckedChange={(v) => setPrefs({ ...prefs, requireInteraction: v })}
            disabled={permission === "unsupported"}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">{t("settings.notif.onlyWhenHidden")}</Label>
            <p className="text-xs text-muted-foreground">{t("settings.notif.onlyWhenHiddenDesc")}</p>
          </div>
          <Switch
            checked={prefs.onlyWhenHidden}
            onCheckedChange={(v) => setPrefs({ ...prefs, onlyWhenHidden: v })}
            disabled={permission === "unsupported"}
          />
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">{t("settings.notif.testBtn")}</Label>
            <p className="text-xs text-muted-foreground">{t("settings.notif.testDesc")}</p>
          </div>
          <Button size="sm" variant="outline" onClick={handleTestNotif}>
            <Bell className="h-4 w-4 me-2" />
            {t("settings.notif.testBtn")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DnsResolversSection() {
  const { t } = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");

  const { data, isLoading } = useListDnsResolvers();
  const addMut = useAddDnsResolvers();
  const delMut = useDeleteDnsResolver();

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getListDnsResolversQueryKey() });

  function handleAdd() {
    if (!text.trim()) return;
    addMut.mutate(
      { data: { text } },
      {
        onSuccess: (res) => {
          const addedCount = res.added.length;
          const skippedCount = res.skipped.length;
          toast({
            title: addedCount > 0
              ? t("dns.resolvers.added").replace("{count}", String(addedCount))
              : t("dns.resolvers.nothingAdded"),
            description: skippedCount > 0
              ? t("dns.resolvers.skipped").replace("{count}", String(skippedCount))
              : undefined,
            variant: addedCount === 0 && skippedCount > 0 ? "destructive" : "default",
          });
          setText("");
          refresh();
        },
        onError: () => toast({ title: t("dns.resolvers.addFailed"), variant: "destructive" }),
      },
    );
  }

  function handleDelete(id: number) {
    delMut.mutate(
      { id },
      {
        onSuccess: () => { toast({ title: t("dns.resolvers.removed") }); refresh(); },
        onError: () => toast({ title: t("dns.resolvers.removeFailed"), variant: "destructive" }),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" /> {t("dns.resolvers.title")}
        </CardTitle>
        <CardDescription>{t("dns.resolvers.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Add custom */}
        <div className="space-y-3 p-4 rounded-lg border border-border bg-muted/30">
          <div className="font-medium text-sm">{t("dns.resolvers.addTitle")}</div>
          <p className="text-xs text-muted-foreground">{t("dns.resolvers.addDesc")}</p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("dns.resolvers.addPlaceholder")}
            className="font-mono min-h-24 text-sm"
            dir="ltr"
          />
          <div className="flex justify-end">
            <Button
              onClick={handleAdd}
              disabled={addMut.isPending || !text.trim()}
              size="sm"
              className="gap-2"
            >
              {addMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {addMut.isPending ? t("dns.resolvers.adding") : t("dns.resolvers.addBtn")}
            </Button>
          </div>
        </div>

        {/* Two-column resolver lists */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{t("dns.resolvers.customTitle")}</span>
              <Badge variant="outline" className="text-xs">{data?.custom.length ?? 0}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{t("dns.resolvers.customDesc")}</p>
            <div className="space-y-1.5">
              {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
              {!isLoading && (data?.custom.length ?? 0) === 0 && (
                <div className="text-sm text-muted-foreground italic">{t("dns.resolvers.noCustom")}</div>
              )}
              {data?.custom.map((r) => (
                <ResolverRow
                  key={r.id ?? r.address}
                  r={r}
                  onDelete={() => r.id != null && handleDelete(r.id)}
                  deleting={delMut.isPending && (delMut.variables as { id: number })?.id === r.id}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{t("dns.resolvers.builtInTitle")}</span>
              <Badge variant="outline" className="text-xs">{data?.builtIn.length ?? 0}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{t("dns.resolvers.builtInDesc")}</p>
            <div className="space-y-1.5">
              {data?.builtIn.map((r) => (
                <ResolverRow key={r.address} r={r} />
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ResolverRow({ r, onDelete, deleting }: {
  r: DnsResolverEntry;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-2.5 border border-border rounded-md bg-card">
      <div className="flex items-center gap-2.5 min-w-0">
        {r.builtIn ? (
          <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <Server className="h-3.5 w-3.5 text-primary shrink-0" />
        )}
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{r.name}</div>
          <div className="text-xs font-mono text-muted-foreground" dir="ltr">{r.address}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {r.builtIn ? (
          <Badge variant="outline" className="text-[10px] uppercase">Built-in</Badge>
        ) : (
          <>
            <Badge variant="outline" className="text-[10px] uppercase border-primary/40 text-primary">Custom</Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={onDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function DataRetentionSection() {
  const { t } = useT();
  const { toast } = useToast();

  interface RetentionSettings {
    checksRetentionDays: number;
    eventLogRetentionDays: number;
    auditLogRetentionDays: number;
    alertRetentionDays: number;
  }

  const [settings, setSettings] = useState<RetentionSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [local, setLocal] = useState<RetentionSettings>({
    checksRetentionDays: 90,
    eventLogRetentionDays: 30,
    auditLogRetentionDays: 365,
    alertRetentionDays: 90,
  });

  useEffect(() => {
    fetch("/api/settings/retention", { credentials: "include" })
      .then((r) => r.json())
      .then((data: RetentionSettings) => {
        setSettings(data);
        setLocal(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/retention", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(local),
      });
      if (!res.ok) throw new Error("Failed");
      const data: RetentionSettings = await res.json();
      setSettings(data);
      setLocal(data);
      toast({ title: t("settings.app.saved"), description: t("settings.app.savedDesc") });
    } catch {
      toast({ title: t("settings.app.saveError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/settings/retention/run", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: t("settings.retention.done") });
    } catch {
      toast({ title: t("settings.retention.failed"), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const isDirty = settings
    ? JSON.stringify(local) !== JSON.stringify(settings)
    : false;

  const retentionFields: {
    key: keyof RetentionSettings;
    label: string;
    desc: string;
  }[] = [
    { key: "checksRetentionDays", label: t("settings.retention.checks"), desc: t("settings.retention.checksDesc") },
    { key: "eventLogRetentionDays", label: t("settings.retention.eventLog"), desc: t("settings.retention.eventLogDesc") },
    { key: "auditLogRetentionDays", label: t("settings.retention.auditLog"), desc: t("settings.retention.auditLogDesc") },
    { key: "alertRetentionDays", label: t("settings.retention.alerts"), desc: t("settings.retention.alertsDesc") },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" /> {t("settings.section.retention")}
        </CardTitle>
        <CardDescription>{t("settings.section.retentionDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <>
            <div className="grid gap-6 sm:grid-cols-2">
              {retentionFields.map(({ key, label, desc }) => (
                <div key={key} className="space-y-2">
                  <Label className="text-sm font-medium">{label}</Label>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={local[key]}
                    onChange={(e) =>
                      setLocal((prev) => ({ ...prev, [key]: Math.max(0, parseInt(e.target.value, 10) || 0) }))
                    }
                    className="w-36"
                    dir="ltr"
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
              <Button
                onClick={handleSave}
                disabled={saving || !isDirty}
                size="sm"
                className="gap-2"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t("common.save")}
              </Button>
              <Button
                variant="outline"
                onClick={handleRunNow}
                disabled={running}
                size="sm"
                className="gap-2"
              >
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {running ? t("settings.retention.running") : t("settings.retention.runNow")}
              </Button>
              <p className="text-xs text-muted-foreground">{t("settings.retention.runNowDesc")}</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface NumericRowProps {
  label: string;
  desc: string;
  value: number;
  onChange: (v: number) => void;
  onApply: () => void;
  disabled: boolean;
  min?: number;
  max?: number;
  step?: number;
  applyLabel: string;
}

function NumericRow({
  label,
  desc,
  value,
  onChange,
  onApply,
  disabled,
  min,
  max,
  step,
  applyLabel,
}: NumericRowProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1 max-w-xl">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <div className="flex items-center gap-3">
        <Input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-36"
          dir="ltr"
        />
        <Button size="sm" onClick={onApply} disabled={disabled} className="gap-2">
          <Save className="h-4 w-4" />
          {applyLabel}
        </Button>
      </div>
    </div>
  );
}
