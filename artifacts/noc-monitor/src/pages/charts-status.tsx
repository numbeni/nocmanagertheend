import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  useGetLatencyTrend,
  getGetLatencyTrendQueryKey,
  useGetCheckStatsTrend,
  getGetCheckStatsTrendQueryKey,
  useGetIncidentTrend,
  getGetIncidentTrendQueryKey,
  useGetTopUnstableSites,
  getGetTopUnstableSitesQueryKey,
  useListSites,
  getListSitesQueryKey,
} from "@workspace/api-client-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/i18n/LanguageProvider";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface SslSummary {
  total: number;
  valid: number;
  expiring: number;
  expired: number;
  invalid: number;
  unchecked: number;
}

interface MonitorServer {
  id: number;
  name: string;
  code: string;
  color: string | null;
}

type LatencyRange = "30m" | "1h" | "12h" | "24h" | "7d";

const RANGE_OPTIONS: LatencyRange[] = ["30m", "1h", "12h", "24h", "7d"];
const RANGE_STORAGE_KEY = "noc.charts.latencyRange";
const DEFAULT_RANGE: LatencyRange = "24h";

function readStoredRange(): LatencyRange {
  if (typeof window === "undefined") return DEFAULT_RANGE;
  try {
    const value = window.localStorage.getItem(RANGE_STORAGE_KEY);
    if (value && (RANGE_OPTIONS as string[]).includes(value)) {
      return value as LatencyRange;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_RANGE;
}

function makeTickFormatter(range: LatencyRange) {
  return (value: string) => {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return String(value);
    if (range === "7d") return format(d, "MMM d");
    return format(d, "HH:mm");
  };
}

function makeTooltipLabelFormatter(range: LatencyRange) {
  return (value: string) => {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return String(value);
    if (range === "7d") return format(d, "MMM d, HH:mm");
    return format(d, "MMM d, HH:mm");
  };
}


const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--popover))",
  borderColor: "hsl(var(--border))",
  borderRadius: "var(--radius)",
  fontSize: "12px",
  color: "hsl(var(--popover-foreground))",
};
const ITEM_STYLE = { color: "hsl(var(--popover-foreground))" };

function EmptyChart({ message, height = "h-[240px]" }: { message: string; height?: string }) {
  return (
    <div className={cn(height, "flex items-center justify-center text-muted-foreground text-sm")}>
      {message}
    </div>
  );
}

function StatPill({ label, value, unit = "" }: { label: string; value: string | number | null; unit?: string }) {
  return (
    <div className="text-center px-3 py-1.5 rounded-lg bg-muted/40">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums" dir="ltr">
        {value !== null && value !== undefined ? `${value}${unit}` : "—"}
      </div>
    </div>
  );
}

export default function ChartsStatusPage() {
  const { t } = useT();

  const [range, setRange] = useState<LatencyRange>(readStoredRange);

  useEffect(() => {
    try {
      window.localStorage.setItem(RANGE_STORAGE_KEY, range);
    } catch {
      /* ignore */
    }
  }, [range]);

  const queryOpts = {
    refetchInterval: 15000,
    staleTime: 5000,
    refetchOnWindowFocus: false,
  };

  const latencyParams = { range } as { range: LatencyRange };
  const statsParams = { range } as { range: LatencyRange };
  const incidentParams = { range } as { range: LatencyRange };
  const unstableParams = { range } as { range: LatencyRange };

  const { data: latencyTrend, isFetching: isFetchingLatency } = useGetLatencyTrend(latencyParams, {
    query: { queryKey: getGetLatencyTrendQueryKey(latencyParams), ...queryOpts },
  });

  const { data: statsTrend, isFetching: isFetchingStats } = useGetCheckStatsTrend(statsParams, {
    query: { queryKey: getGetCheckStatsTrendQueryKey(statsParams), ...queryOpts },
  });

  const { data: incidentTrend, isFetching: isFetchingIncidents } = useGetIncidentTrend(incidentParams, {
    query: { queryKey: getGetIncidentTrendQueryKey(incidentParams), ...queryOpts },
  });

  const { data: topUnstable, isFetching: isFetchingUnstable } = useGetTopUnstableSites(unstableParams, {
    query: { queryKey: getGetTopUnstableSitesQueryKey(unstableParams), ...queryOpts },
  });

  const { data: sites } = useListSites({
    query: { queryKey: getListSitesQueryKey(), ...queryOpts },
  });

  const { data: sslSummary } = useQuery<SslSummary>({
    queryKey: ["ssl-targets", "summary"],
    queryFn: () => fetch("/api/ssl-targets/summary", { credentials: "include" }).then((r) => r.json()),
    refetchInterval: 30_000,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const { data: servers } = useQuery<MonitorServer[]>({
    queryKey: ["servers"],
    queryFn: () => fetch("/api/servers", { credentials: "include" }).then((r) => r.ok ? r.json() : []),
    refetchInterval: 60_000,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const statusDistribution = useMemo(() => {
    if (!sites?.length) return [];
    const counts: Record<string, number> = {};
    for (const site of sites) {
      counts[site.overallStatus] = (counts[site.overallStatus] ?? 0) + 1;
    }
    const colorMap: Record<string, string> = {
      up: "hsl(160, 84%, 39%)",
      slow: "hsl(38, 92%, 50%)",
      down: "hsl(0, 84%, 60%)",
      degraded: "hsl(25, 95%, 53%)",
      blocked: "hsl(215, 16%, 47%)",
      not_stable: "hsl(43, 96%, 56%)",
      unknown: "hsl(215, 16%, 35%)",
    };
    const labelKey: Record<string, string> = {
      up: "status.up",
      slow: "status.slow",
      down: "status.down",
      degraded: "status.degraded",
      blocked: "status.blocked",
      not_stable: "status.notStable",
      unknown: "status.unknown",
    };
    const order = ["up", "slow", "degraded", "not_stable", "blocked", "down", "unknown"];
    return Object.entries(counts)
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
      .map(([status, value]) => ({
        status,
        name: t(labelKey[status] ?? "status.unknown"),
        value,
        color: colorMap[status] ?? "hsl(215, 16%, 47%)",
      }));
  }, [sites, t]);

  const responseBuckets = useMemo(() => {
    if (!sites) return null;
    const buckets = [
      { label: "0–300ms", min: 0, max: 300, color: "hsl(160, 84%, 39%)" },
      { label: "300ms–1s", min: 300, max: 1000, color: "hsl(38, 92%, 50%)" },
      { label: "1s–3s", min: 1000, max: 3000, color: "hsl(25, 95%, 53%)" },
      { label: "3s+", min: 3000, max: Infinity, color: "hsl(0, 84%, 60%)" },
    ];
    const hasResponse = sites.filter((s) => s.responseTimeMs != null);
    const unknown = sites.length - hasResponse.length;
    const allBuckets = buckets.map((b) => ({
      ...b,
      count: hasResponse.filter(
        (s) => (s.responseTimeMs ?? 0) >= b.min && (s.responseTimeMs ?? 0) < b.max,
      ).length,
    }));
    const maxCount = Math.max(...allBuckets.map((b) => b.count), 1);
    return { allBuckets, unknown, maxCount };
  }, [sites]);

  const totalSites = statusDistribution.reduce((s, e) => s + e.value, 0);

  const serverStats = useMemo(() => {
    if (!sites?.length || !servers?.length) return [];
    return servers.map((srv) => {
      const srvSites = sites.filter((s) => (s as any).serverId === srv.id);
      const up = srvSites.filter((s) => s.overallStatus === "up" || s.overallStatus === "slow").length;
      const down = srvSites.filter((s) => s.overallStatus === "down").length;
      const other = srvSites.length - up - down;
      return { ...srv, total: srvSites.length, up, down, other };
    }).filter((s) => s.total > 0);
  }, [sites, servers]);

  // Derived stats from statsTrend
  const statsStats = useMemo(() => {
    if (!statsTrend?.length) return null;
    const rates = statsTrend.map((d) => d.errorRate);
    const uptimes = statsTrend.map((d) => d.uptimePct);
    return {
      avgErrorRate: Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10,
      maxErrorRate: Math.max(...rates),
      avgUptime: Math.round((uptimes.reduce((a, b) => a + b, 0) / uptimes.length) * 10) / 10,
      minUptime: Math.min(...uptimes),
      totalChecks: statsTrend.reduce((a, b) => a + b.totalCount, 0),
      totalFails: statsTrend.reduce((a, b) => a + b.downCount, 0),
    };
  }, [statsTrend]);

  const TOP_CARD_HEIGHT = "h-[420px]";
  const CHART_HEIGHT = "h-[240px]";

  const RangeSelector = (
    <Select value={range} onValueChange={(v) => setRange(v as LatencyRange)}>
      <SelectTrigger className="w-[140px] h-9" aria-label={t("charts.timeRange")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {RANGE_OPTIONS.map((opt) => (
          <SelectItem key={opt} value={opt}>
            {t(`charts.range.${opt}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("charts.title")}</h1>
          <p className="text-muted-foreground">{t("charts.subtitle")}</p>
        </div>
        {/* Global range selector — controls all time-based charts */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("charts.timeRange")}:</span>
          {RangeSelector}
        </div>
      </div>

      {/* ── Row 1: Latency Trend (full-width) ───────────────────────────────── */}
      <Card className={cn("flex flex-col", TOP_CARD_HEIGHT)}>
        <CardHeader>
          <CardTitle>{t("dash.latencyTrend")}</CardTitle>
          <CardDescription>{t("charts.timeRange")}: {t(`charts.range.${range}`)}</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 pl-0 pb-4 pr-2 relative">
          {isFetchingLatency && !latencyTrend ? (
            <Skeleton className="h-[280px] w-full mx-4" />
          ) : latencyTrend && latencyTrend.length > 0 ? (
            <div className="h-[300px] w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={latencyTrend} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorAvg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorP95" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--warning))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--warning))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="bucket" tickFormatter={makeTickFormatter(range)} stroke="hsl(var(--muted-foreground))" fontSize={12} minTickGap={24} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `${v}ms`} width={60} />
                  <ReTooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={ITEM_STYLE} labelFormatter={makeTooltipLabelFormatter(range)} formatter={(v: number, n: string) => [`${v}ms`, n]} />
                  <Area type="monotone" dataKey="p95Ms" name="P95" stroke="hsl(var(--warning))" fillOpacity={1} fill="url(#colorP95)" />
                  <Area type="monotone" dataKey="avgMs" name="Avg" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorAvg)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyChart message={t("dash.noLatency")} height="h-[300px]" />
          )}
        </CardContent>
      </Card>

      {/* ── Row 2: Status Distribution + Response Buckets ───────────────────── */}
      {(statusDistribution.length > 0 || responseBuckets) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {statusDistribution.length > 0 && (
            <Card className="flex flex-col h-[360px]">
              <CardHeader>
                <CardTitle>{t("dash.statusDistribution") || "Status Distribution"}</CardTitle>
                <CardDescription>{t("dash.statusDistributionDesc") || "Current distribution of site statuses"}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 min-h-0">
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 items-center h-full">
                  <div className="sm:col-span-3 relative h-full min-h-[200px]" dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={statusDistribution}
                          cx="50%" cy="50%"
                          innerRadius={56} outerRadius={84}
                          paddingAngle={2} cornerRadius={6}
                          dataKey="value" nameKey="name"
                          stroke="hsl(var(--background))" strokeWidth={2}
                          isAnimationActive={false}
                        >
                          {statusDistribution.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <ReTooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={ITEM_STYLE} formatter={(value: unknown, _n: unknown, p: { payload?: { name?: string } }) => [`${value as number}`, p?.payload?.name ?? ""]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <div className="text-2xl font-bold tabular-nums">{totalSites}</div>
                      <div className="text-xs text-muted-foreground">{t("dash.totalSites")}</div>
                    </div>
                  </div>
                  <div className="sm:col-span-2 space-y-2 overflow-y-auto max-h-full pr-1">
                    {statusDistribution.map((entry) => {
                      const pct = Math.round((entry.value / (totalSites || 1)) * 100);
                      return (
                        <div key={entry.status} className="flex items-center gap-2 text-sm">
                          <span className="inline-block h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} aria-hidden />
                          <span className="flex-1 truncate">{entry.name}</span>
                          <span className="text-muted-foreground tabular-nums" dir="ltr">{entry.value} ({pct}%)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {responseBuckets && (
            <Card className="flex flex-col h-[360px]">
              <CardHeader>
                <CardTitle>{t("dash.responseDistribution") || "Response Time Buckets"}</CardTitle>
                <CardDescription>{t("dash.responseDistributionDesc") || "How many sites fall into each latency range"}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 overflow-y-auto">
                <div className="space-y-3 mt-1">
                  {responseBuckets.allBuckets.map((b) => (
                    <div key={b.label} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-20 flex-shrink-0" dir="ltr">{b.label}</span>
                      <div className="flex-1 h-5 bg-muted/30 rounded overflow-hidden">
                        <div className="h-full rounded transition-all" style={{ width: `${(b.count / responseBuckets.maxCount) * 100}%`, backgroundColor: b.color, minWidth: b.count > 0 ? "4px" : "0px" }} />
                      </div>
                      <span className="text-xs font-mono text-muted-foreground w-6 flex-shrink-0 text-right">{b.count}</span>
                    </div>
                  ))}
                  {responseBuckets.unknown > 0 && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-20 flex-shrink-0">{t("status.unknown")}</span>
                      <div className="flex-1 h-5 bg-muted/30 rounded overflow-hidden">
                        <div className="h-full rounded bg-muted-foreground/30" style={{ width: `${(responseBuckets.unknown / responseBuckets.maxCount) * 100}%` }} />
                      </div>
                      <span className="text-xs font-mono text-muted-foreground w-6 flex-shrink-0 text-right">{responseBuckets.unknown}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Row 3: Error Rate + Success vs Failure ──────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Error Rate Trend */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>{t("charts.errorRate")}</CardTitle>
            <CardDescription>{t("charts.errorRateDesc")}</CardDescription>
          </CardHeader>
          {statsStats && (
            <div className="px-6 pb-2 flex gap-3 flex-wrap">
              <StatPill label={t("charts.average")} value={statsStats.avgErrorRate} unit="%" />
              <StatPill label={t("charts.max")} value={statsStats.maxErrorRate} unit="%" />
              <StatPill label={t("charts.total") + " " + t("charts.failure")} value={statsStats.totalFails} />
            </div>
          )}
          <CardContent className="flex-1 pl-0 pr-2 pb-4">
            {isFetchingStats && !statsTrend ? (
              <Skeleton className={cn(CHART_HEIGHT, "mx-4")} />
            ) : statsTrend && statsTrend.length > 0 ? (
              <div className={cn(CHART_HEIGHT, "w-full")} dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={statsTrend} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorErr" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="bucket" tickFormatter={makeTickFormatter(range)} stroke="hsl(var(--muted-foreground))" fontSize={12} minTickGap={24} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `${v}%`} width={45} domain={[0, 100]} />
                    <ReTooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={ITEM_STYLE} labelFormatter={makeTooltipLabelFormatter(range)} formatter={(v: number, n: string) => [`${v}%`, n]} />
                    <Area type="monotone" dataKey="errorRate" name={t("charts.errorRatePct")} stroke="hsl(var(--destructive))" fillOpacity={1} fill="url(#colorErr)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyChart message={t("charts.noData")} height={CHART_HEIGHT} />
            )}
          </CardContent>
        </Card>

        {/* Success vs Failure */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>{t("charts.successVsFailure")}</CardTitle>
            <CardDescription>{t("charts.successVsFailureDesc")}</CardDescription>
          </CardHeader>
          {statsStats && (
            <div className="px-6 pb-2 flex gap-3 flex-wrap">
              <StatPill label={t("charts.total") + " " + t("charts.checks")} value={statsStats.totalChecks} />
              <StatPill label={t("charts.total") + " " + t("charts.failure")} value={statsStats.totalFails} />
            </div>
          )}
          <CardContent className="flex-1 pl-0 pr-2 pb-4">
            {isFetchingStats && !statsTrend ? (
              <Skeleton className={cn(CHART_HEIGHT, "mx-4")} />
            ) : statsTrend && statsTrend.length > 0 ? (
              <div className={cn(CHART_HEIGHT, "w-full")} dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statsTrend} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="bucket" tickFormatter={makeTickFormatter(range)} stroke="hsl(var(--muted-foreground))" fontSize={12} minTickGap={24} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} width={40} />
                    <ReTooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={ITEM_STYLE} labelFormatter={makeTooltipLabelFormatter(range)} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: "12px" }} />
                    <Bar dataKey="upCount" name={t("charts.success")} fill="hsl(160, 84%, 39%)" radius={[2, 2, 0, 0]} stackId="sf" />
                    <Bar dataKey="downCount" name={t("charts.failure")} fill="hsl(0, 84%, 60%)" radius={[2, 2, 0, 0]} stackId="sf" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyChart message={t("charts.noData")} height={CHART_HEIGHT} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Row 4: Incident Trend + Overall Uptime ──────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Incident Trend */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>{t("charts.incidentTrend")}</CardTitle>
            <CardDescription>{t("charts.incidentTrendDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 pl-0 pr-2 pb-4">
            {isFetchingIncidents && !incidentTrend ? (
              <Skeleton className={cn(CHART_HEIGHT, "mx-4")} />
            ) : incidentTrend && incidentTrend.length > 0 ? (
              <div className={cn(CHART_HEIGHT, "w-full")} dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={incidentTrend} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="bucket" tickFormatter={makeTickFormatter(range)} stroke="hsl(var(--muted-foreground))" fontSize={12} minTickGap={24} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} width={36} allowDecimals={false} />
                    <ReTooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={ITEM_STYLE} labelFormatter={makeTooltipLabelFormatter(range)} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: "12px" }} />
                    <Bar dataKey="createdCount" name={t("charts.created")} fill="hsl(0, 84%, 60%)" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="resolvedCount" name={t("charts.resolved")} fill="hsl(160, 84%, 39%)" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyChart message={t("charts.noData")} height={CHART_HEIGHT} />
            )}
          </CardContent>
        </Card>

        {/* Overall Uptime Trend */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>{t("charts.uptimeTrend")}</CardTitle>
            <CardDescription>{t("charts.uptimeTrendDesc")}</CardDescription>
          </CardHeader>
          {statsStats && (
            <div className="px-6 pb-2 flex gap-3 flex-wrap">
              <StatPill label={t("charts.average")} value={statsStats.avgUptime} unit="%" />
              <StatPill label={t("charts.min")} value={statsStats.minUptime} unit="%" />
            </div>
          )}
          <CardContent className="flex-1 pl-0 pr-2 pb-4">
            {isFetchingStats && !statsTrend ? (
              <Skeleton className={cn(CHART_HEIGHT, "mx-4")} />
            ) : statsTrend && statsTrend.length > 0 ? (
              <div className={cn(CHART_HEIGHT, "w-full")} dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={statsTrend} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorUptime" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(160, 84%, 39%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(160, 84%, 39%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="bucket" tickFormatter={makeTickFormatter(range)} stroke="hsl(var(--muted-foreground))" fontSize={12} minTickGap={24} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `${v}%`} width={45} domain={[0, 100]} />
                    <ReTooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={ITEM_STYLE} labelFormatter={makeTooltipLabelFormatter(range)} formatter={(v: number, n: string) => [`${v}%`, n]} />
                    <Area type="monotone" dataKey="uptimePct" name={t("charts.uptimePct")} stroke="hsl(160, 84%, 39%)" fillOpacity={1} fill="url(#colorUptime)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyChart message={t("charts.noData")} height={CHART_HEIGHT} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Row 5: DNS Failure + SSL Warning ────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* DNS Failure Trend */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>{t("charts.dnsFailure")}</CardTitle>
            <CardDescription>{t("charts.dnsFailureDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 pl-0 pr-2 pb-4">
            {isFetchingStats && !statsTrend ? (
              <Skeleton className={cn(CHART_HEIGHT, "mx-4")} />
            ) : statsTrend && statsTrend.length > 0 ? (
              <div className={cn(CHART_HEIGHT, "w-full")} dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statsTrend} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="bucket" tickFormatter={makeTickFormatter(range)} stroke="hsl(var(--muted-foreground))" fontSize={12} minTickGap={24} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} width={36} allowDecimals={false} />
                    <ReTooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={ITEM_STYLE} labelFormatter={makeTooltipLabelFormatter(range)} />
                    <Bar dataKey="dnsFailCount" name="DNS failures" fill="hsl(25, 95%, 53%)" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyChart message={t("charts.noData")} height={CHART_HEIGHT} />
            )}
          </CardContent>
        </Card>

        {/* SSL Certificate Status — live snapshot from SSL module */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>{t("charts.ssl.title")}</CardTitle>
            <CardDescription>{t("charts.ssl.inlineDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 pb-4">
            {!sslSummary ? (
              <Skeleton className="h-[200px] w-full" />
            ) : sslSummary.total === 0 ? (
              <EmptyChart message={t("charts.noData")} height="h-[200px]" />
            ) : (() => {
              const SSL_ITEMS = [
                { key: "valid",     value: sslSummary.valid,     fill: "#22c55e", dot: "bg-green-500" },
                { key: "expiring",  value: sslSummary.expiring,  fill: "#eab308", dot: "bg-yellow-500" },
                { key: "expired",   value: sslSummary.expired,   fill: "#ef4444", dot: "bg-red-500" },
                { key: "invalid",   value: sslSummary.invalid,   fill: "#f97316", dot: "bg-orange-500" },
                { key: "unchecked", value: sslSummary.unchecked, fill: "hsl(var(--muted-foreground) / 0.35)", dot: "bg-muted-foreground/40" },
              ];
              const donutData = SSL_ITEMS.filter((d) => d.value > 0);
              return (
                <div className="flex items-center gap-4 h-[200px]" dir="ltr">
                  <div className="w-[180px] h-[180px] flex-shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={donutData}
                          cx="50%"
                          cy="50%"
                          innerRadius={52}
                          outerRadius={80}
                          paddingAngle={2}
                          dataKey="value"
                          strokeWidth={0}
                        >
                          {donutData.map((entry, idx) => (
                            <Cell key={idx} fill={entry.fill} />
                          ))}
                        </Pie>
                        <ReTooltip contentStyle={TOOLTIP_STYLE} itemStyle={ITEM_STYLE} labelStyle={ITEM_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col gap-2 flex-1 min-w-0">
                    {SSL_ITEMS.filter((i) => i.value > 0).map(({ key, value, dot }) => (
                      <div key={key} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${dot}`} />
                          <span className="text-xs text-muted-foreground">{t(`charts.ssl.${key}`)}</span>
                        </div>
                        <span className="text-xs font-bold tabular-nums">{value}</span>
                      </div>
                    ))}
                    <div className="mt-1 pt-1 border-t border-border/50 text-xs text-muted-foreground">
                      {t("charts.ssl.total")}: <span className="font-bold">{sslSummary.total}</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      {/* ── Row 6: Top Unstable Sites (full width horizontal bar) ────────────── */}
      <Card className="flex flex-col">
        <CardHeader>
          <CardTitle>{t("charts.topUnstable")}</CardTitle>
          <CardDescription>{t("charts.topUnstableDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isFetchingUnstable && !topUnstable ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : topUnstable && topUnstable.length > 0 ? (
            <div className="space-y-2">
              {topUnstable.map((site, i) => (
                <div key={site.id} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-4 text-right flex-shrink-0" dir="ltr">{i + 1}</span>
                  <div className="w-32 truncate flex-shrink-0">
                    <div className="text-sm font-medium truncate">{site.name}</div>
                    <div className="text-xs text-muted-foreground truncate" dir="ltr">{site.host}</div>
                  </div>
                  <div className="flex-1 h-6 bg-muted/30 rounded overflow-hidden">
                    <div
                      className="h-full rounded transition-all"
                      style={{
                        width: `${Math.min(site.failRate, 100)}%`,
                        backgroundColor:
                          site.failRate >= 80
                            ? "hsl(0, 84%, 60%)"
                            : site.failRate >= 40
                              ? "hsl(25, 95%, 53%)"
                              : "hsl(38, 92%, 50%)",
                        minWidth: "4px",
                      }}
                    />
                  </div>
                  <span className="text-xs font-mono text-muted-foreground w-20 text-right flex-shrink-0" dir="ltr">
                    {site.failCount} / {site.totalCount} ({site.failRate}%)
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-24 flex items-center justify-center text-muted-foreground text-sm">
              {t("charts.noData")}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Row 7: Server Health Overview ─────────────────────────────────── */}
      {serverStats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("charts.servers.title")}</CardTitle>
            <CardDescription>{t("charts.servers.desc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {serverStats.map((srv) => (
                <div key={srv.id} className="flex items-center gap-3">
                  <div className="w-32 flex-shrink-0">
                    <div className="flex items-center gap-1.5">
                      {srv.color && (
                        <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: srv.color }} />
                      )}
                      <span className="text-sm font-medium truncate">{srv.name}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{srv.total} {t("charts.servers.sites")}</div>
                  </div>
                  <div className="flex-1 h-6 flex rounded overflow-hidden gap-px bg-muted/30" dir="ltr">
                    {srv.up > 0 && (
                      <div className="bg-green-500 transition-all" style={{ flex: srv.up }} title={`${t("status.up")}: ${srv.up}`} />
                    )}
                    {srv.other > 0 && (
                      <div className="bg-yellow-500 transition-all" style={{ flex: srv.other }} title={`${t("status.degraded")}: ${srv.other}`} />
                    )}
                    {srv.down > 0 && (
                      <div className="bg-red-500 transition-all" style={{ flex: srv.down }} title={`${t("status.down")}: ${srv.down}`} />
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    {srv.up > 0 && (
                      <Badge className="bg-green-500/15 text-green-600 dark:text-green-400 border-0 text-xs h-5 px-1.5" dir="ltr">↑ {srv.up}</Badge>
                    )}
                    {srv.down > 0 && (
                      <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-0 text-xs h-5 px-1.5" dir="ltr">↓ {srv.down}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
