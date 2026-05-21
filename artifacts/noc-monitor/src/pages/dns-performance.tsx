import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  Award,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Globe,
  Loader2,
  RefreshCw,
  Server,
  TrendingDown,
  XCircle,
  Zap,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/i18n/LanguageProvider";

interface ResolverRank {
  rank: number;
  name: string;
  address: string;
  builtIn: boolean;
  totalTests: number;
  successCount: number;
  failCount: number;
  successRate: number;
  avgLatencyMs: number | null;
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
  timeoutCount: number;
  timeoutRate: number;
  score: number;
}

interface RankingData {
  range: string;
  totalTests: number;
  resolvers: ResolverRank[];
}

interface SiteResolverRow {
  siteId: number;
  siteName: string;
  host: string;
  bestResolver: string;
  bestResolverAddress: string;
  successRate: number;
  avgLatencyMs: number | null;
  totalTests: number;
}

interface SitesData {
  range: string;
  sites: SiteResolverRow[];
}

interface ManualTestResult {
  resolverName: string;
  resolverAddress: string;
  builtIn: boolean;
  success: boolean;
  latencyMs: number | null;
  resolvedIp: string | null;
  error: string | null;
}

interface ManualTestData {
  domain: string;
  results: ManualTestResult[];
}

interface CoverageSite {
  siteId: number;
  siteName: string;
  host: string;
  successRate: number;
  avgLatencyMs: number | null;
}

interface ResolverCoverageItem {
  resolverName: string;
  resolverAddress: string;
  builtIn: boolean;
  totalSites: number;
  sites: CoverageSite[];
}

interface CoverageData {
  range: string;
  resolvers: ResolverCoverageItem[];
}

interface LiveTestState {
  loading: boolean;
  result: ManualTestData | null;
  open: boolean;
}

async function fetchRanking(range: string): Promise<RankingData> {
  const res = await fetch(`/api/dns-performance/ranking?range=${range}`);
  if (!res.ok) throw new Error("Failed to fetch ranking");
  return res.json();
}

async function fetchSites(range: string): Promise<SitesData> {
  const res = await fetch(`/api/dns-performance/sites?range=${range}`);
  if (!res.ok) throw new Error("Failed to fetch sites");
  return res.json();
}

async function fetchCoverage(range: string): Promise<CoverageData> {
  const res = await fetch(`/api/dns-performance/resolver-coverage?range=${range}`);
  if (!res.ok) throw new Error("Failed to fetch coverage");
  return res.json();
}

async function runTest(domain: string, siteId?: number, additionalResolver?: string): Promise<ManualTestData> {
  const res = await fetch("/api/dns-performance/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain, siteId, ...(additionalResolver ? { additionalResolver } : {}) }),
  });
  if (!res.ok) throw new Error("Failed to run test");
  return res.json();
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-green-500";
  if (score >= 55) return "text-yellow-500";
  return "text-red-500";
}

function scoreBarColor(score: number): string {
  if (score >= 80) return "hsl(160, 84%, 39%)";
  if (score >= 55) return "hsl(38, 92%, 50%)";
  return "hsl(0, 84%, 60%)";
}

function latencyLabel(ms: number | null): string {
  if (ms == null) return "—";
  return `${ms}ms`;
}

function SummaryCard({
  icon,
  title,
  value,
  sub,
  variant = "default",
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  sub?: string;
  variant?: "default" | "good" | "warn" | "bad";
}) {
  const variantClass =
    variant === "good"
      ? "text-green-500"
      : variant === "warn"
        ? "text-yellow-500"
        : variant === "bad"
          ? "text-red-500"
          : "text-primary";
  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 ${variantClass}`}>{icon}</div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground mb-0.5">{title}</p>
            <p className="text-lg font-bold leading-tight truncate">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LiveTestResultRow({ r, isBest }: { r: ManualTestResult; isBest: boolean }) {
  const maxLatency = 500;
  const barPct = r.success && r.latencyMs != null
    ? Math.min(100, (r.latencyMs / maxLatency) * 100) : 0;

  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-2 rounded-md ${isBest ? "bg-green-500/10 border border-green-500/30" : "bg-muted/30 border border-border"}`}>
      <div className="flex items-center gap-2 min-w-0">
        {r.success ? (
          <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${isBest ? "text-green-500" : "text-green-400"}`} />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium truncate">{r.resolverName}</span>
            {isBest && <Badge className="text-[9px] py-0 px-1 h-4 bg-green-500 text-white">Best</Badge>}
          </div>
          <span className="text-[10px] font-mono text-muted-foreground" dir="ltr">{r.resolverAddress}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0" dir="ltr">
        {r.success && r.latencyMs != null && (
          <div className="flex items-center gap-2">
            <div className="w-20 h-1.5 rounded-full bg-border overflow-hidden">
              <div
                className={`h-full rounded-full ${barPct < 30 ? "bg-green-500" : barPct < 70 ? "bg-yellow-500" : "bg-red-500"}`}
                style={{ width: `${barPct}%` }}
              />
            </div>
            <span className="text-xs font-mono font-medium w-14 text-right">{r.latencyMs}ms</span>
          </div>
        )}
        {!r.success && <span className="text-xs text-red-500">Failed</span>}
      </div>
    </div>
  );
}

export default function DnsPerformancePage() {
  const { t, dir } = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [range, setRange] = useState("24h");
  const [manualDomain, setManualDomain] = useState("");
  const [manualAdditionalResolver, setManualAdditionalResolver] = useState("");
  const [manualResult, setManualResult] = useState<ManualTestData | null>(null);
  const [liveTests, setLiveTests] = useState<Record<number, LiveTestState>>({});

  const rankingQ = useQuery({
    queryKey: ["dns-performance-ranking", range],
    queryFn: () => fetchRanking(range),
    staleTime: 30_000,
  });

  const sitesQ = useQuery({
    queryKey: ["dns-performance-sites", range],
    queryFn: () => fetchSites(range),
    staleTime: 30_000,
  });

  const coverageQ = useQuery({
    queryKey: ["dns-performance-coverage", range],
    queryFn: () => fetchCoverage(range),
    staleTime: 30_000,
  });

  const testMut = useMutation({
    mutationFn: ({ domain, additionalResolver }: { domain: string; additionalResolver?: string }) =>
      runTest(domain, undefined, additionalResolver || undefined),
    onSuccess: (data) => {
      setManualResult(data);
      queryClient.invalidateQueries({ queryKey: ["dns-performance-ranking"] });
      queryClient.invalidateQueries({ queryKey: ["dns-performance-sites"] });
      queryClient.invalidateQueries({ queryKey: ["dns-performance-coverage"] });
      toast({
        title: t("dns.perf.manualResults"),
        description: `${data.domain} — ${data.results.filter((r) => r.success).length}/${data.results.length} succeeded`,
      });
    },
    onError: () => {
      toast({ title: "Test failed", variant: "destructive" });
    },
  });

  async function runLiveTest(siteId: number, host: string) {
    setLiveTests((prev) => ({
      ...prev,
      [siteId]: { loading: true, result: null, open: true },
    }));
    try {
      const result = await runTest(host, siteId);
      setLiveTests((prev) => ({
        ...prev,
        [siteId]: { loading: false, result, open: true },
      }));
      queryClient.invalidateQueries({ queryKey: ["dns-performance-ranking"] });
      queryClient.invalidateQueries({ queryKey: ["dns-performance-sites"] });
      queryClient.invalidateQueries({ queryKey: ["dns-performance-coverage"] });
    } catch {
      setLiveTests((prev) => ({
        ...prev,
        [siteId]: { loading: false, result: null, open: true },
      }));
      toast({ title: "Live test failed", variant: "destructive" });
    }
  }

  function toggleLiveTest(siteId: number) {
    setLiveTests((prev) => ({
      ...prev,
      [siteId]: prev[siteId]
        ? { ...prev[siteId]!, open: !prev[siteId]!.open }
        : { loading: false, result: null, open: false },
    }));
  }

  const ranking = rankingQ.data;
  const hasData = (ranking?.resolvers.length ?? 0) > 0;
  const best = ranking?.resolvers[0];
  const fastest = ranking
    ? [...ranking.resolvers].sort(
        (a, b) => (a.avgLatencyMs ?? 9999) - (b.avgLatencyMs ?? 9999),
      )[0]
    : null;
  const worst =
    ranking && ranking.resolvers.length > 1
      ? ranking.resolvers[ranking.resolvers.length - 1]
      : null;

  const reload = () => {
    rankingQ.refetch();
    sitesQ.refetch();
    coverageQ.refetch();
  };

  const ranges = ["1h", "6h", "24h", "7d"];

  return (
    <div className="p-6 space-y-6 w-full" dir={dir}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Globe className="h-8 w-8 text-primary" />
            {t("dns.perf.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("dns.perf.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ranges.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={reload}
            disabled={rankingQ.isFetching || sitesQ.isFetching}
          >
            <RefreshCw
              className={`h-4 w-4 ${rankingQ.isFetching ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      {hasData ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            icon={<Award className="h-5 w-5" />}
            title={t("dns.perf.cardBest")}
            value={best?.name ?? "—"}
            sub={best ? `Score: ${best.score} · ${best.successRate}% ok` : undefined}
            variant="good"
          />
          <SummaryCard
            icon={<Zap className="h-5 w-5" />}
            title={t("dns.perf.cardFastest")}
            value={fastest ? latencyLabel(fastest.avgLatencyMs) : "—"}
            sub={fastest?.name}
            variant="good"
          />
          <SummaryCard
            icon={worst && worst.score < 60 ? <TrendingDown className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
            title={t("dns.perf.cardWorst")}
            value={worst ? `Score: ${worst.score}` : "—"}
            sub={worst?.name}
            variant={worst && worst.score < 60 ? "bad" : "good"}
          />
          <SummaryCard
            icon={<Activity className="h-5 w-5" />}
            title={t("dns.perf.cardTotal")}
            value={ranking?.totalTests.toLocaleString() ?? "0"}
            sub={`${range} window`}
          />
        </div>
      ) : (
        !rankingQ.isLoading && (
          <Card>
            <CardContent className="py-8 flex flex-col items-center gap-3 text-center">
              <Globe className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-muted-foreground text-sm max-w-md">
                {t("dns.perf.noData")}
              </p>
            </CardContent>
          </Card>
        )
      )}

      {rankingQ.isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Resolver Ranking Table + Chart */}
      {hasData && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("dns.perf.rankingTitle")}</CardTitle>
              <CardDescription>{t("dns.perf.rankingDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">{t("dns.perf.colRank")}</TableHead>
                    <TableHead>{t("dns.perf.colResolver")}</TableHead>
                    <TableHead className="text-right">{t("dns.perf.colScore")}</TableHead>
                    <TableHead className="text-right">{t("dns.perf.colSuccessRate")}</TableHead>
                    <TableHead className="text-right">{t("dns.perf.colAvgLatency")}</TableHead>
                    <TableHead className="text-right">{t("dns.perf.colTests")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ranking!.resolvers.map((r) => (
                    <TableRow key={r.address}>
                      <TableCell className="font-mono text-muted-foreground text-xs">
                        #{r.rank}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <Server className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="text-sm font-medium">{r.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                              {r.address}
                            </span>
                            {r.builtIn ? (
                              <Badge variant="outline" className="text-[10px] py-0 px-1">
                                {t("dns.perf.builtIn")}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] py-0 px-1 border-primary/40 text-primary">
                                {t("dns.perf.custom")}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`font-bold text-sm ${scoreColor(r.score)}`}>
                          {r.score}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {r.successRate}%
                      </TableCell>
                      <TableCell className="text-right text-sm font-mono" dir="ltr">
                        {latencyLabel(r.avgLatencyMs)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {r.totalTests}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Score Comparison</CardTitle>
              <CardDescription>Overall performance score per resolver (0–100)</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={ranking!.resolvers.map((r) => ({
                    name: r.address,
                    score: r.score,
                  }))}
                  margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                  <ReTooltip
                    formatter={(v: number) => [`Score: ${v}`, ""]}
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                  />
                  <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                    {ranking!.resolvers.map((r, idx) => (
                      <Cell key={idx} fill={scoreBarColor(r.score)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Latency Comparison Chart */}
      {hasData && ranking!.resolvers.some((r) => r.avgLatencyMs != null) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Latency Comparison</CardTitle>
            <CardDescription>Average DNS resolution time per resolver (ms)</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={ranking!.resolvers
                  .filter((r) => r.avgLatencyMs != null)
                  .map((r) => ({ name: r.address, ms: r.avgLatencyMs }))}
                margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}ms`} />
                <ReTooltip
                  formatter={(v: number) => [`${v}ms`, "Avg latency"]}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                />
                <Bar dataKey="ms" radius={[4, 4, 0, 0]}>
                  {ranking!.resolvers
                    .filter((r) => r.avgLatencyMs != null)
                    .map((r, idx) => {
                      const ms = r.avgLatencyMs ?? 0;
                      const color = ms < 50 ? "hsl(160, 84%, 39%)" : ms < 150 ? "hsl(38, 92%, 50%)" : "hsl(0, 84%, 60%)";
                      return <Cell key={idx} fill={color} />;
                    })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Per-Site Best Resolver with Live Test */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4" />
            {t("dns.perf.sitesTitle")}
          </CardTitle>
          <CardDescription>{t("dns.perf.sitesDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {sitesQ.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (sitesQ.data?.sites.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center px-6">
              {t("dns.perf.siteNoData")}
            </p>
          ) : (
            <div className="overflow-auto max-h-[420px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("dns.perf.siteCol.site")}</TableHead>
                  <TableHead>{t("dns.perf.siteCol.resolver")}</TableHead>
                  <TableHead className="text-right">{t("dns.perf.siteCol.successRate")}</TableHead>
                  <TableHead className="text-right">{t("dns.perf.siteCol.latency")}</TableHead>
                  <TableHead className="text-right">{t("dns.perf.siteCol.tests")}</TableHead>
                  <TableHead className="text-right w-28">{t("dns.perf.liveTest")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sitesQ.data!.sites.map((s) => {
                  const liveState = liveTests[s.siteId];
                  const liveResult = liveState?.result;
                  const successResults = liveResult?.results.filter((r) => r.success) ?? [];
                  const bestResult = successResults.length > 0
                    ? successResults.reduce((a, b) =>
                        (a.latencyMs ?? 9999) < (b.latencyMs ?? 9999) ? a : b
                      )
                    : null;

                  return (
                    <>
                      <TableRow key={s.siteId}>
                        <TableCell>
                          <div>
                            <div className="text-sm font-medium">{s.siteName}</div>
                            <div className="text-xs text-muted-foreground font-mono" dir="ltr">{s.host}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-medium">{s.bestResolver}</span>
                            <span className="font-mono text-xs text-muted-foreground" dir="ltr">{s.bestResolverAddress}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={`text-sm font-medium ${s.successRate >= 95 ? "text-green-500" : s.successRate >= 75 ? "text-yellow-500" : "text-red-500"}`}>
                            {s.successRate}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono" dir="ltr">
                          {latencyLabel(s.avgLatencyMs)}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {s.totalTests}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant={liveState?.result ? "secondary" : "outline"}
                              className="h-7 text-xs gap-1 px-2"
                              disabled={liveState?.loading}
                              onClick={() => runLiveTest(s.siteId, s.host)}
                            >
                              {liveState?.loading ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Zap className="h-3 w-3" />
                              )}
                              {liveState?.loading
                                ? t("dns.perf.liveTestRunning")
                                : t("dns.perf.liveTest")}
                            </Button>
                            {liveState?.result && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() => toggleLiveTest(s.siteId)}
                              >
                                {liveState.open ? (
                                  <ChevronUp className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>

                      {/* Expanded live test results row */}
                      {liveState?.open && liveState.result && (
                        <TableRow key={`live-${s.siteId}`} className="bg-muted/20 hover:bg-muted/20">
                          <TableCell colSpan={6} className="py-3 px-4">
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 mb-2">
                                <Zap className="h-3.5 w-3.5 text-primary" />
                                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                  {t("dns.perf.liveTestResults")} — <span className="font-mono normal-case" dir="ltr">{liveResult!.domain}</span>
                                </span>
                                {bestResult && (
                                  <Badge variant="outline" className="text-[10px] border-green-500/40 text-green-600">
                                    {t("dns.perf.liveTestBest")}: {bestResult.resolverName} ({bestResult.latencyMs}ms)
                                  </Badge>
                                )}
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                                {liveResult!.results
                                  .sort((a, b) => {
                                    if (a.success !== b.success) return a.success ? -1 : 1;
                                    return (a.latencyMs ?? 9999) - (b.latencyMs ?? 9999);
                                  })
                                  .map((r) => (
                                    <LiveTestResultRow
                                      key={r.resolverAddress}
                                      r={r}
                                      isBest={r.resolverAddress === bestResult?.resolverAddress}
                                    />
                                  ))}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resolver Coverage */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4" />
            {t("dns.perf.coverageTitle")}
          </CardTitle>
          <CardDescription>{t("dns.perf.coverageDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {coverageQ.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (coverageQ.data?.resolvers.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {t("dns.perf.coverageNoSites")}
            </p>
          ) : (
            <div className="max-h-[560px] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {coverageQ.data!.resolvers.map((resolver) => (
                <div
                  key={resolver.resolverAddress}
                  className="border border-border rounded-lg p-4 space-y-3"
                >
                  {/* Resolver header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Server className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="text-sm font-semibold truncate">{resolver.resolverName}</span>
                      </div>
                      <span className="text-xs font-mono text-muted-foreground" dir="ltr">
                        {resolver.resolverAddress}
                      </span>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      {resolver.builtIn ? (
                        <Badge variant="outline" className="text-[10px]">Built-in</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">Custom</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {t("dns.perf.coverageSites").replace("{count}", String(resolver.totalSites))}
                      </span>
                    </div>
                  </div>

                  {/* Coverage bar */}
                  <div className="w-full h-1.5 rounded-full bg-border overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${Math.min(100, (resolver.totalSites / Math.max(1, coverageQ.data!.resolvers[0]!.totalSites)) * 100)}%`,
                      }}
                    />
                  </div>

                  {/* Site list */}
                  <div className="space-y-1.5">
                    {resolver.sites.map((site) => (
                      <div
                        key={site.siteId}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <span className="font-medium truncate block">{site.siteName}</span>
                          <span className="font-mono text-muted-foreground" dir="ltr">{site.host}</span>
                        </div>
                        <div className="shrink-0 flex items-center gap-2" dir="ltr">
                          <span className={`font-medium ${site.successRate >= 95 ? "text-green-500" : site.successRate >= 75 ? "text-yellow-500" : "text-red-500"}`}>
                            {site.successRate}%
                          </span>
                          {site.avgLatencyMs != null && (
                            <span className="font-mono text-muted-foreground">{site.avgLatencyMs}ms</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manual Test */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {t("dns.perf.manualTitle")}
          </CardTitle>
          <CardDescription>{t("dns.perf.manualDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("dns.perf.manualDomain")}</Label>
              <Input
                value={manualDomain}
                onChange={(e) => setManualDomain(e.target.value)}
                placeholder={t("dns.perf.manualDomainPlaceholder")}
                dir="ltr"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && manualDomain.trim() && !testMut.isPending) {
                    testMut.mutate({ domain: manualDomain.trim(), additionalResolver: manualAdditionalResolver.trim() });
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1">
                {t("dns.perf.additionalResolver")}
                <span className="text-[10px] text-muted-foreground ml-1">{t("dns.perf.additionalResolverHint")}</span>
              </Label>
              <Input
                value={manualAdditionalResolver}
                onChange={(e) => setManualAdditionalResolver(e.target.value)}
                placeholder={t("dns.perf.additionalResolverPlaceholder")}
                dir="ltr"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => testMut.mutate({ domain: manualDomain.trim(), additionalResolver: manualAdditionalResolver.trim() })}
              disabled={!manualDomain.trim() || testMut.isPending}
              className="gap-2"
            >
              {testMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Globe className="h-4 w-4" />
              )}
              {testMut.isPending ? t("dns.perf.manualRunning") : t("dns.perf.manualRun")}
            </Button>
          </div>

          {manualResult && (
            <div className="space-y-2 mt-2">
              <div className="text-sm font-medium text-muted-foreground">
                {t("dns.perf.manualResults")} — <span className="font-mono" dir="ltr">{manualResult.domain}</span>
              </div>
              <div className="space-y-1.5">
                {manualResult.results
                  .sort((a, b) => {
                    if (a.success !== b.success) return a.success ? -1 : 1;
                    return (a.latencyMs ?? 9999) - (b.latencyMs ?? 9999);
                  })
                  .map((r) => {
                    const successResults = manualResult.results.filter((x) => x.success);
                    const bestAddr = successResults.length > 0
                      ? successResults.reduce((a, b) => (a.latencyMs ?? 9999) < (b.latencyMs ?? 9999) ? a : b).resolverAddress
                      : null;
                    return (
                      <div
                        key={r.resolverAddress}
                        className="flex items-center justify-between gap-3 p-2.5 border border-border rounded-md bg-muted/30"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {r.success ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <div className="text-sm font-medium truncate">{r.resolverName}</div>
                              {r.resolverAddress === bestAddr && (
                                <Badge className="text-[9px] py-0 px-1 h-4 bg-green-500 text-white">Best</Badge>
                              )}
                            </div>
                            <div className="text-xs font-mono text-muted-foreground" dir="ltr">{r.resolverAddress}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 text-sm" dir="ltr">
                          {r.success ? (
                            <>
                              <span className="text-green-600 font-medium">{t("dns.perf.manualSuccess")}</span>
                              {r.latencyMs != null && (
                                <span className="font-mono text-muted-foreground">{r.latencyMs}ms</span>
                              )}
                              {r.resolvedIp && (
                                <span className="font-mono text-xs text-muted-foreground">{r.resolvedIp}</span>
                              )}
                            </>
                          ) : (
                            <span className="text-red-500 font-medium">{t("dns.perf.manualFail")}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recommendations */}
      {hasData && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {t("dns.perf.recommendTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const recs: string[] = [];
              const poor = ranking!.resolvers.filter((r) => r.score < 50 && r.totalTests > 5);
              const slow = ranking!.resolvers.filter(
                (r) => r.avgLatencyMs != null && r.avgLatencyMs > 500 && r.totalTests > 5,
              );
              const highFail = ranking!.resolvers.filter((r) => r.failCount > 0 && r.totalTests > 5);
              if (poor.length > 0) {
                poor.forEach((r) =>
                  recs.push(`${r.name} (${r.address}) has a low score of ${r.score}. Consider removing this resolver.`),
                );
              }
              if (slow.length > 0) {
                slow.forEach((r) =>
                  recs.push(`${r.name} has high average latency (${r.avgLatencyMs}ms). May indicate regional network issues.`),
                );
              }
              if (highFail.length > 0 && recs.length === 0) {
                highFail.forEach((r) =>
                  recs.push(`${r.name} has ${r.failCount} failures in this period (${r.successRate}% success rate).`),
                );
              }
              if (recs.length === 0) {
                return (
                  <p className="text-sm text-muted-foreground">{t("dns.perf.recommendNone")}</p>
                );
              }
              return (
                <ul className="space-y-2">
                  {recs.map((rec, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
