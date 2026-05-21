import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Lock,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Trash2,
  XCircle,
  Loader2,
  Search,
  Upload,
  PlayCircle,
  Link2,
  Unlink,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { faIR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

interface SslTarget {
  id: number;
  host: string;
  port: number;
  siteId: number | null;
  notes: string | null;
  lastCheckedAt: string | null;
  lastStatus: string | null;
  lastDaysRemaining: number | null;
  lastIssuer: string | null;
  lastSubject: string | null;
  lastValidFrom: string | null;
  lastValidTo: string | null;
  lastProtocol: string | null;
  lastError: string | null;
  createdAt: string;
}

interface SslScanState {
  status: "idle" | "running" | "waiting";
  inFlight: boolean;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  done: number;
  total: number;
  nextAt: string | null;
  monitoringSweepInFlight?: boolean;
}

interface SslSummary {
  total: number;
  valid: number;
  expiring: number;
  expired: number;
  invalid: number;
  unchecked: number;
  lastCheckedAt: string | null;
  sslScan: SslScanState;
}

interface MonitoredSite {
  id: number;
  name: string;
  host: string;
}

async function fetchSslTargets(): Promise<SslTarget[]> {
  const res = await fetch("/api/ssl-targets", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch SSL targets");
  return res.json();
}

async function fetchSslSummary(): Promise<SslSummary> {
  const res = await fetch("/api/ssl-targets/summary", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch summary");
  return res.json();
}

async function fetchMonitoredSites(): Promise<MonitoredSite[]> {
  const res = await fetch("/api/sites", { credentials: "include" });
  if (!res.ok) return [];
  const data = await res.json();
  return (Array.isArray(data) ? data : data.sites ?? []).map((s: any) => ({
    id: s.id,
    name: s.name,
    host: s.host,
  }));
}

function statusBadge(status: string | null, t: (k: string) => string) {
  if (!status) return <Badge variant="outline" className="text-xs">{t("ssl.filterUnchecked")}</Badge>;
  if (status === "valid") return <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30 text-xs">{t("ssl.filterValid")}</Badge>;
  if (status === "expiring_soon") return <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30 text-xs">{t("ssl.filterExpiring")}</Badge>;
  if (status === "expired") return <Badge variant="destructive" className="text-xs">{t("ssl.filterExpired")}</Badge>;
  if (status === "self_signed") return <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30 text-xs">Self-signed</Badge>;
  if (status === "hostname_mismatch") return <Badge className="bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30 text-xs">Host mismatch</Badge>;
  if (status === "timeout") return <Badge variant="outline" className="text-xs text-muted-foreground">Timeout</Badge>;
  if (status === "unreachable") return <Badge variant="outline" className="text-xs text-muted-foreground">Unreachable</Badge>;
  return <Badge variant="outline" className="text-xs">{status}</Badge>;
}

function statusIcon(status: string | null) {
  if (!status) return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
  if (status === "valid") return <ShieldCheck className="h-4 w-4 text-green-500" />;
  if (status === "expiring_soon") return <ShieldAlert className="h-4 w-4 text-yellow-500" />;
  if (status === "expired") return <ShieldX className="h-4 w-4 text-red-500" />;
  if (status === "self_signed") return <ShieldAlert className="h-4 w-4 text-orange-500" />;
  return <XCircle className="h-4 w-4 text-red-500" />;
}

function ScanStatusBar({ scanState, t }: { scanState: SslScanState | null | undefined; t: (k: string) => string }) {
  const { dir } = useT();
  if (!scanState) return null;
  const isRunning = scanState.status === "running";
  const isWaiting = scanState.status === "waiting";
  const progress = scanState.total > 0 ? Math.round((scanState.done / scanState.total) * 100) : 0;

  if (scanState.status === "idle" && !scanState.lastCompletedAt && !scanState.lastStartedAt) return null;

  return (
    <div className={cn(
      "rounded-lg border px-4 py-3 space-y-2",
      isRunning ? "bg-blue-500/5 border-blue-500/30" :
      isWaiting ? "bg-amber-500/5 border-amber-500/30" :
      "bg-muted/30 border-border/50",
    )}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin text-blue-500 flex-shrink-0" />
          ) : isWaiting ? (
            <Clock className="h-4 w-4 text-amber-500 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
          )}
          <span className="text-sm font-medium">
            {isRunning
              ? `${t("ssl.scanRunning")} — ${scanState.done}/${scanState.total}`
              : isWaiting
                ? t("ssl.scanWaiting")
                : t("ssl.scanIdle")}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          {scanState.lastCompletedAt && (
            <span>{t("ssl.lastScan")}: {formatDistanceToNow(new Date(scanState.lastCompletedAt), { addSuffix: true, locale: dir === "rtl" ? faIR : undefined })}</span>
          )}
          {scanState.nextAt && !isRunning && (
            <span>{t("ssl.nextScan")}: {formatDistanceToNow(new Date(scanState.nextAt), { addSuffix: true, locale: dir === "rtl" ? faIR : undefined })}</span>
          )}
        </div>
      </div>
      {isRunning && scanState.total > 0 && (
        <Progress value={progress} className="h-1.5" />
      )}
    </div>
  );
}

export default function SslPage() {
  const { t, dir } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [checkingIds, setCheckingIds] = useState<Set<number>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [newHost, setNewHost] = useState("");
  const [newPort, setNewPort] = useState("443");
  const [newNotes, setNewNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  const [autoLinking, setAutoLinking] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const { data: targets = [], isLoading } = useQuery<SslTarget[]>({
    queryKey: ["ssl-targets"],
    queryFn: fetchSslTargets,
    refetchInterval: 30_000,
  });

  const { data: summary, refetch: refetchSummary } = useQuery<SslSummary>({
    queryKey: ["ssl-summary"],
    queryFn: fetchSslSummary,
    refetchInterval: 15_000,
  });

  const { data: monitoredSites = [] } = useQuery<MonitoredSite[]>({
    queryKey: ["monitored-sites-brief"],
    queryFn: fetchMonitoredSites,
    staleTime: 60_000,
  });

  // Map siteId → site name for quick lookup
  const siteNameMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of monitoredSites) m.set(s.id, s.name);
    return m;
  }, [monitoredSites]);

  const scanState = summary?.sslScan;
  const scanIsActive = scanState?.status === "running" || scanState?.status === "waiting";

  useEffect(() => {
    if (!scanIsActive) return;
    const id = setInterval(() => {
      refetchSummary();
      qc.invalidateQueries({ queryKey: ["ssl-targets"] });
    }, 3_000);
    return () => clearInterval(id);
  }, [scanIsActive, refetchSummary, qc]);

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/ssl-targets/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ssl-targets"] });
      qc.invalidateQueries({ queryKey: ["ssl-summary"] });
      toast({ title: t("ssl.deleteSuccess") });
    },
    onError: () => toast({ title: t("ssl.deleteError"), variant: "destructive" }),
  });

  async function handleCheck(id: number) {
    setCheckingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/ssl-targets/${id}/check`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Check failed");
      qc.invalidateQueries({ queryKey: ["ssl-targets"] });
      qc.invalidateQueries({ queryKey: ["ssl-summary"] });
      toast({ title: t("ssl.checkSuccess") });
    } catch {
      toast({ title: t("ssl.checkError"), variant: "destructive" });
    } finally {
      setCheckingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function handleCheckAll() {
    if (checkingAll || scanIsActive) return;
    setCheckingAll(true);
    try {
      const res = await fetch("/api/ssl-targets/check-all", { method: "POST", credentials: "include" });
      if (res.status === 409) {
        toast({ title: t("ssl.checkAllAlreadyRunning"), variant: "destructive" });
        return;
      }
      if (!res.ok) throw new Error("Failed");
      toast({ title: t("ssl.checkAllSuccess") });
      qc.invalidateQueries({ queryKey: ["ssl-summary"] });
    } catch {
      toast({ title: t("ssl.checkAllError"), variant: "destructive" });
    } finally {
      setCheckingAll(false);
    }
  }

  async function handleAutoLink() {
    setAutoLinking(true);
    try {
      const res = await fetch("/api/ssl-targets/auto-link", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      const result = await res.json() as { linked: number; alreadyLinked: number };
      if (result.linked > 0) {
        toast({
          title: t("ssl.autoLinkSuccess").replace("{linked}", String(result.linked)),
        });
      } else {
        toast({ title: t("ssl.autoLinkNone") });
      }
      qc.invalidateQueries({ queryKey: ["ssl-targets"] });
      qc.invalidateQueries({ queryKey: ["ssl-summary"] });
    } catch {
      toast({ title: t("ssl.autoLinkError"), variant: "destructive" });
    } finally {
      setAutoLinking(false);
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      const res = await fetch("/api/ssl-targets/bulk-delete", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({
        title: t("ssl.bulkDeleteSuccess").replace("{count}", String(selectedIds.size)),
      });
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["ssl-targets"] });
      qc.invalidateQueries({ queryKey: ["ssl-summary"] });
    } catch {
      toast({ title: t("ssl.bulkDeleteError"), variant: "destructive" });
    } finally {
      setBulkDeleting(false);
      setConfirmBulkDelete(false);
    }
  }

  async function handleAdd() {
    if (!newHost.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/ssl-targets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: newHost.trim(), port: Number(newPort) || 443, notes: newNotes || null }),
      });
      if (!res.ok) throw new Error("Failed");
      qc.invalidateQueries({ queryKey: ["ssl-targets"] });
      qc.invalidateQueries({ queryKey: ["ssl-summary"] });
      toast({ title: t("ssl.addSuccess") });
      setAddOpen(false);
      setNewHost("");
      setNewPort("443");
      setNewNotes("");
    } catch {
      toast({ title: t("ssl.addError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleBulkImport() {
    const lines = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    setBulkImporting(true);
    try {
      const res = await fetch("/api/ssl-targets/bulk-import", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: lines }),
      });
      if (!res.ok) throw new Error("Failed");
      const result = await res.json() as { added: number; duplicates: number; invalid: number };
      qc.invalidateQueries({ queryKey: ["ssl-targets"] });
      qc.invalidateQueries({ queryKey: ["ssl-summary"] });
      toast({
        title: t("ssl.bulkImportSuccess")
          .replace("{added}", String(result.added))
          .replace("{duplicates}", String(result.duplicates))
          .replace("{invalid}", String(result.invalid)),
      });
      setBulkImportOpen(false);
      setBulkText("");
    } catch {
      toast({ title: t("ssl.addError"), variant: "destructive" });
    } finally {
      setBulkImporting(false);
    }
  }

  const filtered = useMemo(() => {
    return targets.filter((target) => {
      const matchesSearch =
        !search ||
        target.host.toLowerCase().includes(search.toLowerCase()) ||
        (target.lastIssuer ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (target.notes ?? "").toLowerCase().includes(search.toLowerCase());
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "valid" && target.lastStatus === "valid") ||
        (statusFilter === "expiring" && target.lastStatus === "expiring_soon") ||
        (statusFilter === "expired" && target.lastStatus === "expired") ||
        (statusFilter === "invalid" &&
          target.lastStatus != null &&
          !["valid", "expiring_soon", "expired"].includes(target.lastStatus)) ||
        (statusFilter === "unchecked" && !target.lastStatus) ||
        (statusFilter === "linked" && target.siteId != null) ||
        (statusFilter === "standalone" && target.siteId == null);
      return matchesSearch && matchesStatus;
    });
  }, [targets, search, statusFilter]);

  const linkedCount = targets.filter((t) => t.siteId != null).length;

  // Selection helpers
  const filteredIds = useMemo(() => new Set(filtered.map((t) => t.id)), [filtered]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((t) => selectedIds.has(t.id));
  const someFilteredSelected = filtered.some((t) => selectedIds.has(t.id)) && !allFilteredSelected;

  function toggleSelectAll(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        filtered.forEach((t) => next.add(t.id));
      } else {
        filtered.forEach((t) => next.delete(t.id));
      }
      return next;
    });
  }

  function toggleOne(id: number, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const visibleSelectedCount = filtered.filter((t) => selectedIds.has(t.id)).length;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Lock className="h-6 w-6 text-primary" />
            {t("ssl.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("ssl.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleAutoLink}
            disabled={autoLinking || targets.length === 0}
            title={t("ssl.autoLink")}
          >
            {autoLinking ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4 mr-2" />
            )}
            {t("ssl.autoLink")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCheckAll}
            disabled={checkingAll || scanIsActive || targets.length === 0}
            title={scanIsActive ? t("ssl.scanRunning") : t("ssl.runCheckAll")}
          >
            {(checkingAll || scanIsActive) ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <PlayCircle className="h-4 w-4 mr-2" />
            )}
            {scanIsActive ? t("ssl.checkAllRunning") : t("ssl.runCheckAll")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setBulkImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            {t("ssl.bulkImportBtn")}
          </Button>
          <Button onClick={() => setAddOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            {t("ssl.addTarget")}
          </Button>
        </div>
      </div>

      {/* Scan status bar */}
      <ScanStatusBar scanState={scanState} t={t} />

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="border-green-500/30">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{t("ssl.valid")}</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{summary?.valid ?? "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-yellow-500/30">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-yellow-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{t("ssl.expiring")}</p>
                <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{summary?.expiring ?? "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-500/30">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <ShieldX className="h-4 w-4 text-red-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{t("ssl.expired")}</p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">{summary?.expired ?? "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-orange-500/30">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-orange-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{t("ssl.invalid")}</p>
                <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{summary?.invalid ?? "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{t("ssl.unchecked")}</p>
                <p className="text-2xl font-bold">{summary?.unchecked ?? "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-500/30">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-blue-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{t("ssl.siteLinked")}</p>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{linkedCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* SSL Certificate Status Chart */}
      {summary && summary.total > 0 && (() => {
        const total = summary.total;
        const segments = [
          { key: "valid",     value: summary.valid,     color: "bg-green-500",  label: t("ssl.valid"),     textColor: "text-green-600 dark:text-green-400" },
          { key: "expiring",  value: summary.expiring,  color: "bg-yellow-500", label: t("ssl.expiring"),  textColor: "text-yellow-600 dark:text-yellow-400" },
          { key: "expired",   value: summary.expired,   color: "bg-red-500",    label: t("ssl.expired"),   textColor: "text-red-600 dark:text-red-400" },
          { key: "invalid",   value: summary.invalid,   color: "bg-orange-500", label: t("ssl.invalid"),   textColor: "text-orange-600 dark:text-orange-400" },
          { key: "unchecked", value: summary.unchecked, color: "bg-gray-400",   label: t("ssl.unchecked"), textColor: "text-muted-foreground" },
        ].filter((s) => s.value > 0);
        return (
          <Card>
            <CardHeader className="pb-3 pt-4">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Lock className="h-4 w-4" />
                {t("ssl.statusChart")}
                <span className="text-xs text-muted-foreground/60 font-normal">({total} {t("ssl.targetsLabel")})</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              {/* Stacked bar */}
              <div className="flex h-6 w-full rounded-full overflow-hidden gap-px bg-muted/20">
                {segments.map((seg) => (
                  <div
                    key={seg.key}
                    className={cn(seg.color, "h-full transition-all duration-500")}
                    style={{ width: `${(seg.value / total) * 100}%` }}
                    title={`${seg.label}: ${seg.value} (${Math.round((seg.value / total) * 100)}%)`}
                  />
                ))}
              </div>
              {/* Legend */}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
                {segments.map((seg) => (
                  <div key={seg.key} className="flex items-center gap-1.5 text-xs">
                    <span className={cn("h-2.5 w-2.5 rounded-full flex-shrink-0", seg.color)} />
                    <span className="text-muted-foreground">{seg.label}</span>
                    <span className={cn("font-bold font-mono", seg.textColor)}>{seg.value}</span>
                    <span className="text-muted-foreground/50">({Math.round((seg.value / total) * 100)}%)</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Filters + bulk actions */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={t("ssl.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px] h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("ssl.filterAll")}</SelectItem>
            <SelectItem value="valid">{t("ssl.filterValid")}</SelectItem>
            <SelectItem value="expiring">{t("ssl.filterExpiring")}</SelectItem>
            <SelectItem value="expired">{t("ssl.filterExpired")}</SelectItem>
            <SelectItem value="invalid">{t("ssl.filterInvalid")}</SelectItem>
            <SelectItem value="unchecked">{t("ssl.filterUnchecked")}</SelectItem>
            <SelectItem value="linked">{t("ssl.filterLinked")}</SelectItem>
            <SelectItem value="standalone">{t("ssl.filterStandalone")}</SelectItem>
          </SelectContent>
        </Select>
        {visibleSelectedCount > 0 && (
          <>
            <span className="text-sm text-muted-foreground">
              {t("ssl.selectedCount").replace("{count}", String(visibleSelectedCount))}
            </span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmBulkDelete(true)}
              disabled={bulkDeleting}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t("ssl.bulkDelete")}
            </Button>
          </>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="py-3 px-4 border-b">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {filtered.length} {t("ssl.targetsLabel")}
            {summary?.total ? ` / ${summary.total} ${t("ssl.targetsTotal")}` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {targets.length === 0 ? t("ssl.noTargets") : t("ssl.noResults")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4">
                    <Checkbox
                      checked={allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false}
                      onCheckedChange={(v) => toggleSelectAll(!!v)}
                      aria-label={t("ssl.selectAll")}
                    />
                  </TableHead>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>{t("ssl.colHost")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("ssl.colStatus")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("ssl.colExpiry")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("ssl.colIssuer")}</TableHead>
                  <TableHead className="hidden xl:table-cell">{t("ssl.colSite")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("ssl.colLastChecked")}</TableHead>
                  <TableHead className="text-right">{t("ssl.colActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((target) => (
                  <TableRow
                    key={target.id}
                    className={cn(
                      target.lastStatus === "expired" && "bg-red-500/5",
                      target.lastStatus === "expiring_soon" && "bg-yellow-500/5",
                      selectedIds.has(target.id) && "bg-primary/5",
                    )}
                  >
                    <TableCell className="py-2 pl-4">
                      <Checkbox
                        checked={selectedIds.has(target.id)}
                        onCheckedChange={(v) => toggleOne(target.id, !!v)}
                      />
                    </TableCell>
                    <TableCell className="py-2">{statusIcon(target.lastStatus)}</TableCell>
                    <TableCell className="py-2">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-sm font-medium" dir="ltr">
                            {target.host}
                            {target.port !== 443 && (
                              <span className="text-muted-foreground">:{target.port}</span>
                            )}
                          </span>
                          {target.siteId != null ? (
                            <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 text-blue-600 dark:text-blue-400 border-blue-500/30 gap-0.5">
                              <Link2 className="h-2.5 w-2.5" />
                              {t("ssl.linkedBadge")}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 text-muted-foreground border-border/50 gap-0.5">
                              <Unlink className="h-2.5 w-2.5" />
                              {t("ssl.sslOnly")}
                            </Badge>
                          )}
                        </div>
                        {target.notes && (
                          <p className="text-xs text-muted-foreground mt-0.5">{target.notes}</p>
                        )}
                        <div className="sm:hidden mt-1">{statusBadge(target.lastStatus, t)}</div>
                      </div>
                    </TableCell>
                    <TableCell className="py-2 hidden sm:table-cell">
                      <div className="flex flex-col gap-1">
                        {statusBadge(target.lastStatus, t)}
                        {target.lastDaysRemaining != null && (
                          <span className={cn(
                            "text-xs",
                            target.lastDaysRemaining < 7 ? "text-destructive font-medium" :
                            target.lastDaysRemaining < 30 ? "text-warning" :
                            "text-muted-foreground",
                          )}>
                            {target.lastDaysRemaining}d {t("ssl.remaining")}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-2 hidden md:table-cell">
                      {target.lastValidTo ? (
                        <span className={cn(
                          "text-xs font-mono",
                          new Date(target.lastValidTo) < new Date() ? "text-destructive" : "",
                        )}>
                          {format(new Date(target.lastValidTo), "yyyy-MM-dd")}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2 hidden lg:table-cell">
                      <span className="text-xs text-muted-foreground truncate max-w-[160px] block">
                        {target.lastIssuer ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="py-2 hidden xl:table-cell">
                      {target.siteId != null ? (
                        <a
                          href={`/sites/${target.siteId}`}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 max-w-[140px]"
                        >
                          <Link2 className="h-3 w-3 shrink-0" />
                          <span className="truncate">
                            {siteNameMap.get(target.siteId) ?? t("ssl.viewSite")}
                          </span>
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("ssl.sslOnly")}</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2 hidden lg:table-cell">
                      {target.lastCheckedAt ? (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(target.lastCheckedAt), { addSuffix: true, locale: dir === "rtl" ? faIR : undefined })}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("ssl.neverChecked")}</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleCheck(target.id)}
                          disabled={checkingIds.has(target.id)}
                          title={t("ssl.runScan")}
                        >
                          {checkingIds.has(target.id) ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(target.id)}
                          title={t("ssl.delete")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add target dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("ssl.addDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("ssl.fieldHost")}</Label>
              <Input
                placeholder="example.com"
                value={newHost}
                onChange={(e) => setNewHost(e.target.value)}
                dir="ltr"
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("ssl.fieldPort")}</Label>
              <Input
                placeholder="443"
                value={newPort}
                onChange={(e) => setNewPort(e.target.value)}
                dir="ltr"
                type="number"
                min={1}
                max={65535}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("ssl.fieldNotes")}</Label>
              <Textarea
                placeholder={t("ssl.notesPlaceholder")}
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleAdd} disabled={!newHost.trim() || saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {t("ssl.addBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk import dialog */}
      <Dialog open={bulkImportOpen} onOpenChange={setBulkImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              {t("ssl.bulkImportTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">{t("ssl.bulkImportHint")}</p>
            <Textarea
              placeholder={t("ssl.bulkImportPlaceholder")}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={8}
              className="resize-none font-mono text-sm"
              dir="ltr"
            />
            <p className="text-xs text-muted-foreground">
              {bulkText.split("\n").filter((l) => l.trim()).length} {t("ssl.targetsLabel")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkImportOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleBulkImport} disabled={bulkImporting || !bulkText.trim()}>
              {bulkImporting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
              {bulkImporting ? t("ssl.bulkImporting") : t("ssl.bulkImportAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("ssl.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("ssl.deleteConfirmDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteId) {
                  deleteMutation.mutate(deleteId);
                  setDeleteId(null);
                }
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirm */}
      <AlertDialog open={confirmBulkDelete} onOpenChange={(v) => !v && setConfirmBulkDelete(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("ssl.bulkDeleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("ssl.bulkDeleteConfirmDesc").replace("{count}", String(visibleSelectedCount))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
            >
              {bulkDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {t("ssl.bulkDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
