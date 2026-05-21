import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { formatDistanceToNow, format } from "date-fns";
import {
  useGetSite,
  getGetSiteQueryKey,
  useGetSiteChecks,
  getGetSiteChecksQueryKey,
  useGetSiteUptime,
  getGetSiteUptimeQueryKey,
  useRunSiteCheck,
  useDeleteSite,
  useClearSiteChecks,
  useRunDnsCheck,
  useGetSiteDiagnostics,
  getGetSiteDiagnosticsQueryKey,
  useRunSiteProductCheck,
  useRunSiteCurlCheck,
  useUpdateSite,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  CreditCard,
  Globe,
  MoreVertical,
  Play,
  Server,
  ShieldCheck,
  Trash2,
  ShoppingBag,
  Network,
  Terminal,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { StatusBadge } from "@/components/status-badge";
import { useT } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

export default function SiteDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useT();

  const [activeTab, setActiveTab] = useState("checks");
  const [chartType, setChartType] = useState<"response" | "status" | "successVsFailure" | "errorTypes" | "sslDays">("response");

  const { data: site, isLoading: isLoadingSite } = useGetSite(id, {
    query: { queryKey: getGetSiteQueryKey(id), refetchInterval: 10000, enabled: !!id },
  });

  const { data: checks, isLoading: isLoadingChecks } = useGetSiteChecks(
    id,
    { limit: 100 },
    {
      query: {
        queryKey: getGetSiteChecksQueryKey(id, { limit: 100 }),
        refetchInterval: 10000,
        enabled: !!id,
      },
    },
  );

  const { data: uptime, isLoading: isLoadingUptime } = useGetSiteUptime(
    id,
    { hours: 24 },
    {
      query: {
        queryKey: getGetSiteUptimeQueryKey(id, { hours: 24 }),
        refetchInterval: 10000,
        enabled: !!id,
      },
    },
  );

  const runCheck = useRunSiteCheck();
  const deleteSite = useDeleteSite();
  const clearChecks = useClearSiteChecks();
  const runDnsCheck = useRunDnsCheck();
  const updateSite = useUpdateSite();
  const runProductCheck = useRunSiteProductCheck();
  const runCurlCheck = useRunSiteCurlCheck();

  const [dnsResults, setDnsResults] = useState<any>(null);
  const [isRunningDns, setIsRunningDns] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showClearChecksDialog, setShowClearChecksDialog] = useState(false);

  const {
    data: diagnostics,
    isLoading: isLoadingDiagnostics,
    refetch: refetchDiagnostics,
    isFetching: isFetchingDiagnostics,
  } = useGetSiteDiagnostics(id, {
    query: {
      queryKey: getGetSiteDiagnosticsQueryKey(id),
      enabled: !!id && activeTab === "diagnostics",
    },
  });

  const { data: sslTarget } = useQuery<{
    id: number;
    host: string;
    lastStatus: string | null;
    lastDaysRemaining: number | null;
    lastIssuer: string | null;
    lastSubject: string | null;
    lastValidFrom: string | null;
    lastValidTo: string | null;
    lastProtocol: string | null;
    lastCheckedAt: string | null;
    lastError: string | null;
  } | null>({
    queryKey: ["site-ssl-target", id],
    queryFn: async () => {
      const r = await fetch(`/api/sites/${id}/ssl-target`, { credentials: "include" });
      if (r.status === 404) return null;
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!id && activeTab === "ssl",
    refetchInterval: 30_000,
  });

  if (!id) return <div>Invalid Site ID</div>;

  const handleRunCheck = () => {
    runCheck.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: t("site.runCheck") });
          queryClient.invalidateQueries({ queryKey: getGetSiteQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getGetSiteChecksQueryKey(id, { limit: 100 }) });
          queryClient.invalidateQueries({ queryKey: getGetSiteUptimeQueryKey(id, { hours: 24 }) });
        },
        onError: () => {
          toast({ title: "Check failed", variant: "destructive" });
        },
      },
    );
  };

  const handleDelete = () => {
    deleteSite.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: t("site.deleteSite") });
          setLocation("/");
        },
        onError: () => {
          toast({ title: "Deletion failed", variant: "destructive" });
        },
      },
    );
  };

  const handleClearChecks = () => {
    clearChecks.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: t("site.clearChecksSuccess") });
          setShowClearChecksDialog(false);
          queryClient.invalidateQueries({ queryKey: getGetSiteChecksQueryKey(id, { limit: 100 }) });
          queryClient.invalidateQueries({ queryKey: getGetSiteUptimeQueryKey(id, { hours: 24 }) });
        },
        onError: () => {
          toast({ title: "Failed to clear checks", variant: "destructive" });
        },
      },
    );
  };

  const handleToggleProductCheck = (enabled: boolean) => {
    updateSite.mutate(
      { id, data: { productCheckEnabled: enabled } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSiteQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getGetSiteDiagnosticsQueryKey(id) });
          toast({
            title: enabled
              ? t("site.diag.product.enabled")
              : t("site.diag.product.disabled"),
          });
        },
        onError: () => {
          toast({ title: t("site.diag.product.toggleError"), variant: "destructive" });
        },
      },
    );
  };

  const handleRunProductCheck = () => {
    runProductCheck.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSiteDiagnosticsQueryKey(id) });
          refetchDiagnostics();
          toast({ title: t("site.diag.product.ran") });
        },
        onError: () => {
          toast({ title: t("site.diag.product.runError"), variant: "destructive" });
        },
      },
    );
  };

  const handleRunCurlCheck = () => {
    runCurlCheck.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSiteDiagnosticsQueryKey(id) });
          refetchDiagnostics();
          toast({ title: t("site.diag.curl.success") });
        },
        onError: () => {
          toast({ title: t("site.diag.curl.error"), variant: "destructive" });
        },
      },
    );
  };

  const handleRunDnsCheck = () => {
    if (!site?.host) return;
    setIsRunningDns(true);
    runDnsCheck.mutate(
      { data: { host: site.host } },
      {
        onSuccess: (data) => {
          setDnsResults(data);
          setIsRunningDns(false);
        },
        onError: () => {
          toast({ title: "DNS check failed", variant: "destructive" });
          setIsRunningDns(false);
        },
      },
    );
  };

  if (isLoadingSite) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!site) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold">{t("common.notFound")}</h2>
        <Link href="/">
          <Button className="mt-4" variant="outline">
            {t("common.back")}
          </Button>
        </Link>
      </div>
    );
  }

  const chartData = checks
    ? [...checks].reverse().map((c) => ({
        time: format(new Date(c.timestamp), "HH:mm"),
        ms: c.responseTimeMs || 0,
        status: c.overallStatus,
        statusVal: 1,
        isUp: c.overallStatus === "up" ? 1 : 0,
        isFail: c.overallStatus !== "up" ? 1 : 0,
        sslDays: c.sslDaysRemaining ?? null,
      }))
    : [];

  const errorTypeData = (() => {
    if (!checks || !checks.length) return [];
    const counts: Record<string, number> = {};
    for (const c of checks) {
      if (c.overallStatus !== "up" && c.errorType) {
        counts[c.errorType] = (counts[c.errorType] ?? 0) + 1;
      }
    }
    const colors = ["hsl(0,84%,60%)", "hsl(25,95%,53%)", "hsl(38,92%,50%)", "hsl(215,16%,47%)", "hsl(260,60%,60%)"];
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([type, count], i) => ({ name: type, value: count, color: colors[i % colors.length] }));
  })();

  const TOOLTIP_STYLE = {
    backgroundColor: "hsl(var(--popover))",
    borderColor: "hsl(var(--border))",
    borderRadius: "var(--radius)",
    fontSize: "12px",
    color: "hsl(var(--popover-foreground))",
  };
  const ITEM_STYLE = { color: "hsl(var(--popover-foreground))" };

  const sslChartData = chartData.filter((d) => d.sslDays !== null);

  const latestCheck = checks && checks.length > 0 ? checks[0] : null;

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex items-center gap-4 mb-4">
        <Link href="/">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-3 flex-wrap">
            {site.name}
            <StatusBadge status={site.overallStatus} />
          </h2>
          <p className="text-muted-foreground flex items-center gap-2 mt-1">
            <Globe className="h-4 w-4" />
            <a href={site.url} target="_blank" rel="noreferrer" className="hover:underline" dir="ltr">
              {site.url}
            </a>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {site.openIncidentId && (
            <Link href={`/incidents/${site.openIncidentId}`}>
              <Button variant="destructive" className="gap-2">
                <AlertCircle className="h-4 w-4" /> {t("site.viewIncident")}
              </Button>
            </Link>
          )}
          <Button onClick={handleRunCheck} disabled={runCheck.isPending} variant="outline" className="gap-2">
            <Play className="h-4 w-4" /> {runCheck.isPending ? t("site.running") : t("site.runCheck")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => setShowClearChecksDialog(true)}
              >
                <Trash2 className="h-4 w-4 mr-2 text-muted-foreground" />
                {t("site.clearChecks")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive cursor-pointer"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" /> {t("site.deleteSite")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Clear checks confirmation dialog */}
          <AlertDialog open={showClearChecksDialog} onOpenChange={setShowClearChecksDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("site.clearChecksConfirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("site.clearChecksConfirmDesc")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleClearChecks}
                  disabled={clearChecks.isPending}
                >
                  {t("site.clearChecks")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Delete site confirmation dialog */}
          <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("site.deleteConfirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("site.deleteConfirmDesc")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {t("site.deleteSite")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Blocked-reason banner — only when status === blocked */}
      {site.overallStatus === "blocked" && site.blockedReason && (
        <Card className="border-slate-500/40 bg-slate-500/5">
          <CardContent className="pt-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-slate-500 shrink-0" />
            <div className="text-sm">
              <span className="font-semibold">{t("site.blocked.label")}:</span>{" "}
              <span className="font-mono text-muted-foreground" dir="ltr">{site.blockedReason}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* "Never reachable yet" banner — drives the Down vs Not Stable distinction */}
      {!site.hasEverBeenUp && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-4 text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
            <span>{t("site.neverUp")}</span>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("site.uptime24h")}</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" dir="ltr">
              {isLoadingUptime ? <Skeleton className="h-8 w-16" /> : `${uptime?.uptimePercent.toFixed(2) ?? 0}%`}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {isLoadingUptime ? <Skeleton className="h-4 w-20" /> : `${uptime?.totalChecks ?? 0} ${t("site.checks")}`}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("site.responseTime")}</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" dir="ltr">{site.responseTimeMs ? `${site.responseTimeMs}ms` : "—"}</div>
            <div className="text-xs text-muted-foreground mt-1">{t("site.latestCheck")}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("site.httpStatus")}</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" dir="ltr">
              {site.httpStatus ? (
                <span className={site.httpStatus >= 200 && site.httpStatus < 400 ? "text-success" : "text-destructive"}>
                  {site.httpStatus}
                </span>
              ) : (
                "—"
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("site.dnsResolves")}</CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold" dir="ltr">
              {site.dnsStatus === "ok" || site.dnsStatus === "slow" ? (
                <span className={site.dnsStatus === "ok" ? "text-success" : "text-warning"}>
                  {site.dnsResolveMs}ms
                </span>
              ) : site.dnsStatus ? (
                <span className="text-destructive flex items-center text-base">
                  <AlertCircle className="mr-1 h-4 w-4" /> {site.dnsStatus}
                </span>
              ) : (
                "—"
              )}
            </div>
            {site.resolvedIp && (
              <div className="text-xs font-mono text-muted-foreground mt-1 truncate" dir="ltr" title={site.resolvedIp}>
                {site.resolvedIp.split(",")[0]}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("site.sslCert")}</CardTitle>
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" dir="ltr">
              {site.sslDaysRemaining !== null && site.sslDaysRemaining !== undefined ? (
                <span
                  className={
                    site.sslDaysRemaining < 7
                      ? "text-destructive"
                      : site.sslDaysRemaining < 30
                        ? "text-warning"
                        : "text-success"
                  }
                >
                  {site.sslDaysRemaining} {t("dash.daysSuffix")}
                </span>
              ) : (
                "—"
              )}
            </div>
            {site.sslStatus === "error" && <p className="text-xs text-destructive mt-1">{t("site.invalidCert")}</p>}
          </CardContent>
        </Card>
      </div>

      {/* ── Site Charts — selectable chart type ─────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 flex-wrap space-y-0">
          <div>
            <CardTitle>{t("site.charts.title")}</CardTitle>
            <CardDescription>
              {t(`site.charts.${chartType}`) || t("site.responseHistory")}
            </CardDescription>
          </div>
          <Select value={chartType} onValueChange={(v) => setChartType(v as typeof chartType)}>
            <SelectTrigger className="w-[200px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="response">{t("site.charts.responseTime")}</SelectItem>
              <SelectItem value="status">{t("site.charts.statusHistory")}</SelectItem>
              <SelectItem value="successVsFailure">{t("site.charts.successVsFailure")}</SelectItem>
              <SelectItem value="errorTypes">{t("site.charts.errorTypes")}</SelectItem>
              <SelectItem value="sslDays">{t("site.charts.sslDays")}</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          <div className="h-[220px] w-full" dir="ltr">
            {isLoadingChecks ? (
              <Skeleton className="h-full w-full" />
            ) : chartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t("site.charts.noChecks")}</div>
            ) : chartType === "response" ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={11} minTickGap={30} />
                  <YAxis hide domain={["dataMin - 10", "dataMax + 50"]} />
                  <RechartsTooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={ITEM_STYLE} formatter={(v: number) => [`${v}ms`, "Response"]} labelFormatter={(l) => `${l}`} />
                  <Line type="monotone" dataKey="ms" name="Response" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : chartType === "status" ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                  <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={11} minTickGap={30} />
                  <YAxis hide />
                  <RechartsTooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={ITEM_STYLE} formatter={(_: number, __: string, p: any) => [p.payload.status, "Status"]} />
                  <Bar dataKey="statusVal" name="Status" radius={[2, 2, 0, 0]}>
                    {chartData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={
                          entry.status === "up"
                            ? "hsl(142,76%,36%)"
                            : entry.status === "currently_fine"
                              ? "hsl(168,84%,40%)"
                              : entry.status === "slow"
                                ? "hsl(48,96%,53%)"
                                : entry.status === "degraded"
                                  ? "hsl(25,95%,53%)"
                                  : entry.status === "blocked"
                                    ? "hsl(20,90%,48%)"
                                    : entry.status === "not_stable"
                                      ? "hsl(262,80%,60%)"
                                      : entry.status === "unknown"
                                        ? "hsl(var(--muted-foreground))"
                                        : "hsl(0,84%,60%)"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : chartType === "successVsFailure" ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={11} minTickGap={30} />
                  <YAxis hide />
                  <RechartsTooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={ITEM_STYLE} />
                  <Bar dataKey="isUp" name={t("charts.success")} fill="hsl(160,84%,39%)" radius={[2, 2, 0, 0]} stackId="sf" />
                  <Bar dataKey="isFail" name={t("charts.failure")} fill="hsl(0,84%,60%)" radius={[2, 2, 0, 0]} stackId="sf" />
                </BarChart>
              </ResponsiveContainer>
            ) : chartType === "errorTypes" ? (
              errorTypeData.length > 0 ? (
                <div className="grid grid-cols-5 gap-4 h-full items-center">
                  <div className="col-span-3 h-full" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={errorTypeData} cx="50%" cy="50%" outerRadius={80} dataKey="value" isAnimationActive={false}>
                          {errorTypeData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <RechartsTooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={ITEM_STYLE} formatter={(v: number, _: string, p: any) => [v, p?.payload?.name ?? ""]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="col-span-2 space-y-2 overflow-y-auto max-h-full">
                    {errorTypeData.map((e) => (
                      <div key={e.name} className="flex items-center gap-2 text-xs">
                        <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: e.color }} />
                        <span className="flex-1 truncate font-mono">{e.name}</span>
                        <span className="text-muted-foreground">{e.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t("site.charts.noChecks")}</div>
              )
            ) : chartType === "sslDays" ? (
              sslChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={sslChartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={11} minTickGap={30} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => `${v}d`} width={36} />
                    <RechartsTooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={ITEM_STYLE} formatter={(v: number) => [`${v} days`, "SSL"]} />
                    <Line type="monotone" dataKey="sslDays" name={t("site.charts.sslDays")} stroke="hsl(160,84%,39%)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t("site.charts.noChecks")}</div>
              )
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="checks">{t("site.tab.checks")}</TabsTrigger>
          <TabsTrigger value="dns">{t("site.tab.dns")}</TabsTrigger>
          <TabsTrigger value="ssl">{t("site.tab.ssl")}</TabsTrigger>
          <TabsTrigger value="diagnostics">{t("site.tab.diagnostics")}</TabsTrigger>
        </TabsList>
        <TabsContent value="checks" className="mt-4 space-y-4">
          {/* Performance stats */}
          {checks && checks.length >= 5 && (() => {
            const times = checks
              .map((c) => c.responseTimeMs)
              .filter((v): v is number => v != null && v > 0)
              .sort((a, b) => a - b);
            if (times.length < 3) return null;
            const pct = (p: number) => times[Math.floor((p / 100) * (times.length - 1))]!;
            const p50 = pct(50); const p95 = pct(95); const p99 = pct(99);
            const min = times[0]!; const max = times[times.length - 1]!;
            return (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">{t("site.perf.title")}</CardTitle>
                  <p className="text-xs text-muted-foreground">{t("site.perf.samples").replace("{n}", String(times.length))}</p>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {([["site.perf.min", min, "text-success"], ["site.perf.p50", p50, "text-foreground"], ["site.perf.p95", p95, "text-warning"], ["site.perf.p99", p99, "text-orange-500"], ["site.perf.max", max, "text-destructive"]] as [string, number, string][]).map(([key, val, cls]) => (
                      <div key={key} className="text-center space-y-0.5">
                        <p className="text-xs text-muted-foreground">{t(key)}</p>
                        <p className={`text-lg font-bold tabular-nums ${cls}`} dir="ltr">{val}ms</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })()}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("site.checkTable.time")}</TableHead>
                    <TableHead>{t("table.status")}</TableHead>
                    <TableHead className="text-right">{t("table.response")}</TableHead>
                    <TableHead>HTTP</TableHead>
                    <TableHead className="hidden md:table-cell font-mono text-xs">{t("table.resolvedIp")}</TableHead>
                    <TableHead>{t("site.checkTable.details")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingChecks ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={6}>
                          <Skeleton className="h-6 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : checks && checks.length > 0 ? (
                    checks.map((check) => (
                      <TableRow key={check.id}>
                        <TableCell className="whitespace-nowrap" dir="ltr">{format(new Date(check.timestamp), "MMM d, HH:mm:ss")}</TableCell>
                        <TableCell><StatusBadge status={check.overallStatus} /></TableCell>
                        <TableCell className="text-right" dir="ltr">{check.responseTimeMs ? `${check.responseTimeMs}ms` : "—"}</TableCell>
                        <TableCell dir="ltr">{check.httpStatus || "—"}</TableCell>
                        <TableCell className="hidden md:table-cell font-mono text-xs text-muted-foreground" dir="ltr">
                          {check.resolvedIp ? check.resolvedIp.split(",")[0] : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[260px] truncate" dir="ltr">
                          {check.blockedReason || check.errorMessage || check.errorType || "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">{t("site.noChecks")}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dns" className="mt-4 space-y-4">
          {/* Per-check DNS data: visible without running anything because every
              check stores DNS information in the normal flow. */}
          <Card>
            <CardHeader>
              <CardTitle>{t("site.dns.title")}</CardTitle>
              <CardDescription>{t("site.dns.desc")}</CardDescription>
            </CardHeader>
            <CardContent>
              {latestCheck ? (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <dt className="text-sm text-muted-foreground">{t("site.dns.resolverUsed")}</dt>
                    <dd className="font-medium">{latestCheck.resolverUsed || "—"}</dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-sm text-muted-foreground">{t("site.dns.resolvedIp")}</dt>
                    <dd className="font-mono text-sm" dir="ltr">{latestCheck.resolvedIp || "—"}</dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-sm text-muted-foreground">{t("site.dns.resolveTime")}</dt>
                    <dd className="font-medium" dir="ltr">{latestCheck.dnsResolveMs != null ? `${latestCheck.dnsResolveMs} ms` : "—"}</dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-sm text-muted-foreground">{t("site.dns.lastChecked")}</dt>
                    <dd className="font-medium" dir="ltr">{format(new Date(latestCheck.timestamp), "MMM d, HH:mm:ss")}</dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-sm text-muted-foreground">{t("site.dns.statusLabel")}</dt>
                    <dd>
                      {latestCheck.dnsStatus === "ok" ? (
                        <Badge className="bg-success text-success-foreground">OK</Badge>
                      ) : latestCheck.dnsStatus === "slow" ? (
                        <Badge className="bg-warning text-warning-foreground">SLOW</Badge>
                      ) : (
                        <Badge variant="destructive">{(latestCheck.dnsStatus ?? "—").toUpperCase()}</Badge>
                      )}
                    </dd>
                  </div>
                </dl>
              ) : (
                <div className="text-center py-8 text-muted-foreground">{t("site.noChecks")}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{t("site.dns.globalTitle")}</CardTitle>
                <CardDescription>{t("site.dns.globalDesc")}</CardDescription>
              </div>
              <Button onClick={handleRunDnsCheck} disabled={isRunningDns} variant="outline">
                {isRunningDns ? t("site.dns.checking") : t("site.dns.runGlobal")}
              </Button>
            </CardHeader>
            <CardContent>
              {dnsResults ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border flex-wrap gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">{t("site.dns.healthScore")}</div>
                      <div className="text-3xl font-bold text-primary" dir="ltr">{dnsResults.healthScore}%</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">{t("site.dns.statusLabel")}</div>
                      <div className="text-xl font-bold capitalize">{dnsResults.status}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">{t("site.dns.propagation")}</div>
                      <div className="text-xl font-bold flex items-center">
                        {dnsResults.propagationConsistent ? (
                          <span className="text-success flex items-center"><CheckCircle2 className="mr-1 h-5 w-5" /> {t("site.dns.consistent")}</span>
                        ) : (
                          <span className="text-warning flex items-center"><AlertTriangle className="mr-1 h-5 w-5" /> {t("site.dns.inconsistent")}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("site.dns.tableProvider")}</TableHead>
                        <TableHead>{t("site.dns.statusLabel")}</TableHead>
                        <TableHead className="text-right">{t("site.dns.tableResponse")}</TableHead>
                        <TableHead>{t("site.dns.tableAddresses")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dnsResults.resolvers.map((res: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">{res.resolver}</TableCell>
                          <TableCell>
                            {res.ok ? <Badge className="bg-success text-success-foreground">OK</Badge> : <Badge variant="destructive">FAIL</Badge>}
                          </TableCell>
                          <TableCell className="text-right" dir="ltr">{res.responseTimeMs ? `${Math.round(res.responseTimeMs)}ms` : "—"}</TableCell>
                          <TableCell className="font-mono text-xs" dir="ltr">
                            {res.addresses.length > 0 ? res.addresses.join(", ") : res.error || "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Globe className="mx-auto h-12 w-12 opacity-50 mb-4" />
                  <p>{t("site.dns.runGlobalHint")}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ssl" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("site.ssl.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              {sslTarget ? (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <dt className="text-sm text-muted-foreground">{t("site.ssl.statusLabel")}</dt>
                    <dd className="font-medium capitalize">{sslTarget.lastStatus ?? (checks?.[0]?.sslStatus ?? "—")}</dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-sm text-muted-foreground">{t("site.ssl.issuer")}</dt>
                    <dd className="font-medium">{sslTarget.lastIssuer || checks?.[0]?.sslIssuer || "—"}</dd>
                  </div>
                  {sslTarget.lastSubject && (
                    <div className="space-y-1">
                      <dt className="text-sm text-muted-foreground">{t("site.ssl.subject")}</dt>
                      <dd className="font-medium font-mono text-sm">{sslTarget.lastSubject}</dd>
                    </div>
                  )}
                  <div className="space-y-1">
                    <dt className="text-sm text-muted-foreground">{t("site.ssl.daysRemaining")}</dt>
                    <dd className="font-medium" dir="ltr">
                      {(sslTarget.lastDaysRemaining ?? checks?.[0]?.sslDaysRemaining) !== null ? (
                        <span
                          className={
                            (sslTarget.lastDaysRemaining ?? checks?.[0]?.sslDaysRemaining)! < 7
                              ? "text-destructive"
                              : (sslTarget.lastDaysRemaining ?? checks?.[0]?.sslDaysRemaining)! < 30
                                ? "text-warning"
                                : "text-success"
                          }
                        >
                          {sslTarget.lastDaysRemaining ?? checks?.[0]?.sslDaysRemaining} {t("dash.daysSuffix")}
                        </span>
                      ) : "—"}
                    </dd>
                  </div>
                  {sslTarget.lastValidFrom && (
                    <div className="space-y-1">
                      <dt className="text-sm text-muted-foreground">{t("site.ssl.validFrom")}</dt>
                      <dd className="font-medium text-sm" dir="ltr">
                        {format(new Date(sslTarget.lastValidFrom), "PP")}
                      </dd>
                    </div>
                  )}
                  {sslTarget.lastValidTo && (
                    <div className="space-y-1">
                      <dt className="text-sm text-muted-foreground">{t("site.ssl.validTo")}</dt>
                      <dd className="font-medium text-sm" dir="ltr">
                        {format(new Date(sslTarget.lastValidTo), "PP")}
                      </dd>
                    </div>
                  )}
                  {sslTarget.lastProtocol && (
                    <div className="space-y-1">
                      <dt className="text-sm text-muted-foreground">{t("site.ssl.protocol")}</dt>
                      <dd className="font-medium font-mono text-sm">{sslTarget.lastProtocol}</dd>
                    </div>
                  )}
                  {sslTarget.lastCheckedAt && (
                    <div className="space-y-1">
                      <dt className="text-sm text-muted-foreground">{t("site.ssl.lastChecked")}</dt>
                      <dd className="text-sm text-muted-foreground" dir="ltr">
                        {formatDistanceToNow(new Date(sslTarget.lastCheckedAt), { addSuffix: true })}
                      </dd>
                    </div>
                  )}
                  {sslTarget.lastError && (
                    <div className="space-y-1 sm:col-span-2">
                      <dt className="text-sm text-muted-foreground">Error</dt>
                      <dd className="text-sm text-destructive">{sslTarget.lastError}</dd>
                    </div>
                  )}
                </dl>
              ) : checks && checks.length > 0 && checks[0].sslStatus ? (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <dt className="text-sm text-muted-foreground">{t("site.ssl.statusLabel")}</dt>
                    <dd className="font-medium capitalize">{checks[0].sslStatus}</dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-sm text-muted-foreground">{t("site.ssl.issuer")}</dt>
                    <dd className="font-medium">{checks[0].sslIssuer || "—"}</dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-sm text-muted-foreground">{t("site.ssl.daysRemaining")}</dt>
                    <dd className="font-medium" dir="ltr">
                      {checks[0].sslDaysRemaining !== null ? (
                        <span
                          className={
                            checks[0].sslDaysRemaining! < 7
                              ? "text-destructive"
                              : checks[0].sslDaysRemaining! < 30
                                ? "text-warning"
                                : "text-success"
                          }
                        >
                          {checks[0].sslDaysRemaining} {t("dash.daysSuffix")}
                        </span>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                </dl>
              ) : (
                <div className="text-center py-8 text-muted-foreground">{t("site.ssl.notHttps")}</div>
              )}
            </CardContent>
          </Card>

          {site.lastSuccessAt && (
            <Card className="mt-4">
              <CardContent className="pt-4 text-sm text-muted-foreground" dir="ltr">
                <span className="font-medium text-foreground mr-2">{t("site.lastSuccess")}:</span>
                {format(new Date(site.lastSuccessAt), "PPpp")} ({formatDistanceToNow(new Date(site.lastSuccessAt), { addSuffix: true })})
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="diagnostics" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Network className="h-5 w-5" /> {t("site.diag.title")}
                </CardTitle>
                <CardDescription>{t("site.diag.subtitle")}</CardDescription>
              </div>
              <Button
                variant="outline"
                onClick={() => refetchDiagnostics()}
                disabled={isFetchingDiagnostics}
              >
                {isFetchingDiagnostics ? t("site.diag.refreshing") : t("site.diag.refresh")}
              </Button>
            </CardHeader>
            <CardContent>
              {isLoadingDiagnostics && !diagnostics ? (
                <Skeleton className="h-32 w-full" />
              ) : diagnostics ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">{t("site.diag.host")}</div>
                    <div className="font-mono text-sm" dir="ltr">{diagnostics.host}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">{t("site.diag.resolver")}</div>
                    <div className="font-mono text-sm" dir="ltr">{diagnostics.dns.resolver}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">{t("site.diag.systemLookup")}</div>
                    <div className="font-mono text-sm" dir="ltr">
                      {diagnostics.dns.systemLookup.address ?? "—"}{" "}
                      <span className="text-muted-foreground">
                        ({diagnostics.dns.systemLookup.code} · {diagnostics.dns.systemLookup.responseTimeMs}ms)
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">{t("site.diag.generatedAt")}</div>
                    <div className="font-mono text-xs" dir="ltr">
                      {format(new Date(diagnostics.generatedAt), "PPpp")}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground">{t("common.loading")}</div>
              )}
            </CardContent>
          </Card>

          {diagnostics && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Server className="h-5 w-5" /> {t("site.diag.dns.title")}
                  </CardTitle>
                  <CardDescription>{t("site.diag.dns.subtitle")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(["a", "aaaa", "cname"] as const).map((kind) => {
                    const rec = diagnostics.dns[kind];
                    return (
                      <div key={kind} className="border rounded-md p-3" dir="ltr">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold uppercase">{rec.type}</span>
                          <Badge variant={rec.code === "OK" ? "default" : rec.code === "NO_RECORD" ? "secondary" : "destructive"}>
                            {rec.code}
                          </Badge>
                        </div>
                        {rec.records.length > 0 ? (
                          <ul className="font-mono text-sm space-y-1">
                            {rec.records.map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        ) : (
                          <div className="text-xs text-muted-foreground">{rec.errorMessage ?? t("site.diag.dns.noRecords")}</div>
                        )}
                        <div className="text-xs text-muted-foreground mt-2">{rec.responseTimeMs} ms</div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("site.diag.cname.title")}</CardTitle>
                  <CardDescription>{t("site.diag.cname.subtitle")}</CardDescription>
                </CardHeader>
                <CardContent>
                  {diagnostics.dns.cnameChain.chain.length === 0 ? (
                    <div className="text-sm text-muted-foreground">{t("site.diag.cname.empty")}</div>
                  ) : (
                    <div className="space-y-2" dir="ltr">
                      {diagnostics.dns.cnameChain.chain.map((hop, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-3 p-3 border rounded-md font-mono text-sm"
                        >
                          <Badge variant="outline">#{hop.hop + 1}</Badge>
                          <div className="flex-1 min-w-0">
                            <div className="truncate">{hop.from}</div>
                            {hop.cname ? (
                              <div className="text-primary text-xs mt-1">→ CNAME → {hop.cname}</div>
                            ) : hop.resolvedA.length > 0 ? (
                              <div className="text-success text-xs mt-1">→ A → {hop.resolvedA.join(", ")}</div>
                            ) : (
                              <div className="text-destructive text-xs mt-1">{hop.errorMessage ?? hop.code}</div>
                            )}
                          </div>
                          <Badge variant={hop.code === "OK" ? "default" : "destructive"}>{hop.code}</Badge>
                        </div>
                      ))}
                      {diagnostics.dns.cnameChain.loop && (
                        <div className="text-sm text-warning">{t("site.diag.cname.loop")}</div>
                      )}
                      {diagnostics.dns.cnameChain.truncated && (
                        <div className="text-sm text-warning">{t("site.diag.cname.truncated")}</div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {t("site.diag.cname.finalTarget")}: {diagnostics.dns.cnameChain.finalTarget}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Terminal className="h-5 w-5" /> {t("site.diag.http.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("site.diag.http.subtitle")} —{" "}
                    <span className="font-mono" dir="ltr">{diagnostics.http.totalTimeMs} ms</span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <pre
                    className="bg-muted/40 rounded-md p-3 text-xs overflow-x-auto whitespace-pre font-mono leading-relaxed"
                    dir="ltr"
                  >
                    {diagnostics.http.curlText}
                  </pre>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Terminal className="h-5 w-5" /> {t("site.diag.curl.title")}
                    </CardTitle>
                    <CardDescription>{t("site.diag.curl.subtitle")}</CardDescription>
                  </div>
                  <Button
                    onClick={handleRunCurlCheck}
                    disabled={runCurlCheck.isPending}
                  >
                    {runCurlCheck.isPending
                      ? t("site.diag.curl.running")
                      : t("site.diag.curl.run")}
                  </Button>
                </CardHeader>
                <CardContent>
                  {!diagnostics.latestCurlDiagnostic ? (
                    <div className="text-sm text-muted-foreground">
                      {t("site.diag.curl.notRun")}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <Badge
                          variant={diagnostics.latestCurlDiagnostic.ok ? "default" : "destructive"}
                        >
                          {diagnostics.latestCurlDiagnostic.ok
                            ? t("site.diag.curl.ok")
                            : t("site.diag.curl.failed")}
                        </Badge>
                        <span className="text-sm" dir="ltr">
                          {t("site.diag.curl.statusCode")}:{" "}
                          <span className="font-mono">
                            {diagnostics.latestCurlDiagnostic.statusCode ?? "—"}
                          </span>
                        </span>
                        <span className="text-sm text-muted-foreground" dir="ltr">
                          {t("site.diag.curl.responseTime")}:{" "}
                          {diagnostics.latestCurlDiagnostic.responseTimeMs} ms
                        </span>
                        <span className="text-sm text-muted-foreground" dir="ltr">
                          {t("site.diag.curl.redirects")}:{" "}
                          {diagnostics.latestCurlDiagnostic.redirectCount}
                        </span>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-2 text-sm">
                        <div dir="ltr">
                          <div className="text-xs text-muted-foreground">
                            {t("site.diag.curl.finalUrl")}
                          </div>
                          <div className="font-mono break-all">
                            {diagnostics.latestCurlDiagnostic.finalUrl}
                          </div>
                        </div>
                        <div dir="ltr">
                          <div className="text-xs text-muted-foreground">
                            {t("site.diag.curl.contentType")}
                          </div>
                          <div className="font-mono break-all">
                            {diagnostics.latestCurlDiagnostic.contentType ?? "—"}
                          </div>
                        </div>
                        <div dir="ltr">
                          <div className="text-xs text-muted-foreground">
                            {t("site.diag.curl.server")}
                          </div>
                          <div className="font-mono break-all">
                            {diagnostics.latestCurlDiagnostic.server ?? "—"}
                          </div>
                        </div>
                      </div>
                      {diagnostics.latestCurlDiagnostic.errorMessage && (
                        <div className="text-sm text-destructive">
                          {diagnostics.latestCurlDiagnostic.errorMessage}
                        </div>
                      )}
                      {diagnostics.latestCurlDiagnosticAt && (
                        <div className="text-xs text-muted-foreground" dir="ltr">
                          {t("site.diag.curl.ranAt")}:{" "}
                          {format(new Date(diagnostics.latestCurlDiagnosticAt), "PPpp")}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <ShoppingBag className="h-5 w-5" /> {t("site.diag.product.title")}
                    </CardTitle>
                    <CardDescription>{t("site.diag.product.subtitle")}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant={diagnostics.productCheckEnabled ? "secondary" : "outline"}
                      onClick={() =>
                        handleToggleProductCheck(!diagnostics.productCheckEnabled)
                      }
                      disabled={updateSite.isPending}
                    >
                      {diagnostics.productCheckEnabled
                        ? t("site.diag.product.disable")
                        : t("site.diag.product.enable")}
                    </Button>
                    {diagnostics.productCheckEnabled && (
                      <Button
                        onClick={handleRunProductCheck}
                        disabled={runProductCheck.isPending}
                      >
                        {runProductCheck.isPending
                          ? t("site.diag.product.running")
                          : t("site.diag.product.run")}
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {!diagnostics.productCheckEnabled ? (
                    <div className="text-sm text-muted-foreground">
                      {t("site.diag.product.disabledHint")}
                    </div>
                  ) : !diagnostics.productCheck ||
                    diagnostics.productCheck.status === "skipped" ? (
                    <div className="text-sm text-muted-foreground">
                      {t("site.diag.product.notRun")}
                    </div>
                  ) : (
                    (() => {
                      const pc = diagnostics.productCheck;
                      const statusKey = `site.diag.product.status${
                        pc.status.charAt(0).toUpperCase() + pc.status.slice(1)
                      }`;
                      const sourceKey = `site.diag.product.source.${pc.source}`;
                      const variant: "default" | "secondary" | "destructive" | "outline" =
                        pc.status === "ok"
                          ? "default"
                          : pc.status === "warning"
                          ? "secondary"
                          : pc.status === "failed" || pc.status === "error"
                          ? "destructive"
                          : "outline";
                      return (
                        <div className="space-y-3">
                          <div className="flex items-center gap-3 flex-wrap">
                            <Badge variant={variant}>{pc.status.toUpperCase()}</Badge>
                            <span className="text-sm">{t(statusKey)}</span>
                            <span className="text-sm text-muted-foreground" dir="ltr">
                              {pc.responseTimeMs} ms
                            </span>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {pc.message}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {t(sourceKey)}
                          </div>
                          <div className="grid md:grid-cols-2 gap-3 text-sm">
                            <div>
                              <div className="text-xs font-semibold mb-1">
                                {t("site.diag.product.checked")} ({pc.checkedUrls.length})
                              </div>
                              {pc.checkedUrls.length === 0 ? (
                                <div className="text-xs text-muted-foreground">
                                  {t("site.diag.product.none")}
                                </div>
                              ) : (
                                <ul className="space-y-1 font-mono text-xs" dir="ltr">
                                  {pc.checkedUrls.map((u) => (
                                    <li key={u} className="break-all text-muted-foreground">
                                      {u}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div>
                              <div className="text-xs font-semibold mb-1 text-success">
                                {t("site.diag.product.working")} ({pc.workingUrls.length})
                              </div>
                              {pc.workingUrls.length === 0 ? (
                                <div className="text-xs text-muted-foreground">
                                  {t("site.diag.product.none")}
                                </div>
                              ) : (
                                <ul className="space-y-1 font-mono text-xs" dir="ltr">
                                  {pc.workingUrls.map((u) => (
                                    <li key={u} className="break-all text-success">
                                      {u}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>
                          {pc.errorMessage && (
                            <div className="text-sm text-destructive">{pc.errorMessage}</div>
                          )}
                          {diagnostics.productCheckRanAt && (
                            <div className="text-xs text-muted-foreground" dir="ltr">
                              {t("site.diag.product.ranAt")}:{" "}
                              {format(new Date(diagnostics.productCheckRanAt), "PPpp")}
                            </div>
                          )}
                        </div>
                      );
                    })()
                  )}
                </CardContent>
              </Card>

              <LinkedGatewaysCard siteId={id} t={t} />
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LinkedGatewaysCard({ siteId, t }: { siteId: number; t: (k: string) => string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["site-gateways", siteId],
    queryFn: async () => {
      const res = await fetch(`/api/sites/${siteId}/gateways`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json() as Promise<Array<{ id: number; name: string; provider: string; status: string; lastCheckedAt: string | null }>>;
    },
    enabled: !!siteId,
    refetchInterval: 30000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" /> {t("site.diag.gateways.title")}
        </CardTitle>
        <CardDescription>{t("site.diag.gateways.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : !data || data.length === 0 ? (
          <div className="text-sm text-muted-foreground">{t("site.diag.gateways.empty")}</div>
        ) : (
          <div className="space-y-2">
            {data.map((gw) => (
              <div key={gw.id} className="flex items-center justify-between p-2 rounded-md border">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{gw.name}</div>
                  <div className="text-xs text-muted-foreground">{gw.provider}</div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={cn(
                    "text-xs font-medium",
                    gw.status === "up" ? "text-green-500" : gw.status === "degraded" ? "text-yellow-500" : gw.status === "down" ? "text-red-500" : "text-muted-foreground",
                  )}>
                    {gw.status.toUpperCase()}
                  </span>
                  {gw.lastCheckedAt && (
                    <span className="text-xs text-muted-foreground hidden sm:block" dir="ltr">
                      {formatDistanceToNow(new Date(gw.lastCheckedAt), { addSuffix: true })}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
