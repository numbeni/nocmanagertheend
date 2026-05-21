import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Edit2,
  Trash2,
  Server,
  AlertTriangle,
  Globe,
  Loader2,
  Check,
  X,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/i18n/LanguageProvider";
import { useListSites, getListSitesQueryKey } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

interface ServerRecord {
  id: number;
  code: string;
  name: string;
  description: string | null;
  color: string;
  displayOrder: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  siteCount: number;
}

const PRESET_COLORS = [
  { label: "Green", value: "#22c55e" },
  { label: "Orange", value: "#f97316" },
  { label: "Indigo", value: "#6366f1" },
  { label: "Purple", value: "#a855f7" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Teal", value: "#14b8a6" },
  { label: "Rose", value: "#f43f5e" },
  { label: "Amber", value: "#f59e0b" },
];

const SERVERS_QUERY_KEY = ["servers"];

function useServers() {
  return useQuery<ServerRecord[]>({
    queryKey: SERVERS_QUERY_KEY,
    queryFn: () => fetch("/api/servers", { credentials: "include" }).then((r) => r.json()),
    refetchInterval: 15000,
  });
}

interface ServerFormData {
  code: string;
  name: string;
  description: string;
  color: string;
  displayOrder: number;
  notes: string;
}

const DEFAULT_FORM: ServerFormData = {
  code: "",
  name: "",
  description: "",
  color: "#22c55e",
  displayOrder: 0,
  notes: "",
};

function ServerFormDialog({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: ServerRecord | null;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ServerFormData>(
    editing
      ? {
          code: editing.code,
          name: editing.name,
          description: editing.description ?? "",
          color: editing.color,
          displayOrder: editing.displayOrder,
          notes: editing.notes ?? "",
        }
      : DEFAULT_FORM,
  );

  const mutation = useMutation({
    mutationFn: async (data: ServerFormData) => {
      const url = editing ? `/api/servers/${editing.id}` : "/api/servers";
      const method = editing ? "PUT" : "POST";
      const r = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Failed");
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SERVERS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
      toast({ title: editing ? t("servers.editSuccess") : t("servers.createSuccess") });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: err.message || t("servers.saveError"), variant: "destructive" });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) {
      toast({ title: t("servers.codeNameRequired"), variant: "destructive" });
      return;
    }
    mutation.mutate(form);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            {editing ? t("servers.editServer") : t("servers.addServer")}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("servers.code")} <span className="text-destructive">*</span></Label>
              <Input
                placeholder="s1"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                dir="ltr"
                maxLength={10}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("servers.displayOrder")}</Label>
              <Input
                type="number"
                min={0}
                value={form.displayOrder}
                onChange={(e) => setForm((f) => ({ ...f, displayOrder: parseInt(e.target.value) || 0 }))}
                dir="ltr"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("servers.name")} <span className="text-destructive">*</span></Label>
            <Input
              placeholder="mahtaco"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("servers.description")}</Label>
            <Input
              placeholder="primaryhosting-svr"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("servers.color")}</Label>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={cn(
                    "h-7 w-7 rounded-full border-2 transition-transform",
                    form.color === c.value ? "border-white scale-110" : "border-transparent",
                  )}
                  style={{ backgroundColor: c.value }}
                  onClick={() => setForm((f) => ({ ...f, color: c.value }))}
                  title={c.label}
                />
              ))}
              <Input
                value={form.color}
                onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                dir="ltr"
                className="w-28 h-7 text-xs"
                placeholder="#hex"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("servers.notes")}</Label>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder={t("servers.notesPlaceholder")}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type SiteStatusRecord = { id: number; name: string; url: string; host: string; serverId: number | null; overallStatus: string; responseTimeMs?: number | null; consecutiveSuccesses?: number };

function statusDotClass(status: string): string {
  switch (status) {
    case "up": return "bg-green-500";
    case "slow": return "bg-yellow-400";
    case "degraded":
    case "blocked": return "bg-orange-400";
    case "down":
    case "not_stable": return "bg-red-500";
    default: return "bg-muted-foreground/40";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "up": return "Up";
    case "slow": return "Slow";
    case "degraded": return "Degraded";
    case "blocked": return "Blocked";
    case "down": return "Down";
    case "not_stable": return "Unstable";
    default: return "Unknown";
  }
}

function ServerHealthBar({ serverId, sites }: { serverId: number; sites: SiteStatusRecord[] }) {
  const serverSites = sites.filter((s) => s.serverId === serverId);
  if (serverSites.length === 0) return null;
  const up = serverSites.filter((s) => s.overallStatus === "up").length;
  const slow = serverSites.filter((s) => s.overallStatus === "slow").length;
  const degraded = serverSites.filter((s) => s.overallStatus === "degraded" || s.overallStatus === "blocked").length;
  const down = serverSites.filter((s) => s.overallStatus === "down" || s.overallStatus === "not_stable").length;
  const unknown = serverSites.filter((s) => s.overallStatus === "unknown").length;
  const total = serverSites.length;
  const healthPct = total > 0 ? Math.round(((up + slow) / total) * 100) : 0;
  const isAllGood = down === 0 && degraded === 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          {up > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/15 text-green-500 dark:text-green-400 border border-green-500/20">
              <CheckCircle2 className="h-3 w-3" /> {up} up
            </span>
          )}
          {slow > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20">
              <Clock className="h-3 w-3" /> {slow} slow
            </span>
          )}
          {degraded > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-500/15 text-orange-500 dark:text-orange-400 border border-orange-500/20">
              <AlertTriangle className="h-3 w-3" /> {degraded} degraded
            </span>
          )}
          {down > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/15 text-red-500 dark:text-red-400 border border-red-500/20">
              <XCircle className="h-3 w-3" /> {down} down
            </span>
          )}
          {unknown > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
              <Minus className="h-3 w-3" /> {unknown} unknown
            </span>
          )}
        </div>
        <span className={`text-xs font-bold ${isAllGood ? "text-green-500 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
          {healthPct}%
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isAllGood ? "bg-green-500" : healthPct > 50 ? "bg-yellow-400" : "bg-red-500"}`}
          style={{ width: `${healthPct}%` }}
        />
      </div>
    </div>
  );
}

function ServerSiteList({ serverId, sites }: { serverId: number; sites: SiteStatusRecord[] }) {
  const serverSites = sites.filter((s) => s.serverId === serverId);
  if (serverSites.length === 0) return null;
  const sorted = [...serverSites].sort((a, b) => {
    const order: Record<string, number> = { down: 0, not_stable: 1, degraded: 2, blocked: 3, slow: 4, unknown: 5, up: 6 };
    return (order[a.overallStatus] ?? 7) - (order[b.overallStatus] ?? 7);
  });
  return (
    <div className="space-y-0.5 mt-2 max-h-48 overflow-y-auto">
      {sorted.map((site) => (
        <Link key={site.id} href={`/sites/${site.id}`}>
          <div className="flex flex-col px-2 py-1.5 rounded hover:bg-muted/50 transition-colors cursor-pointer group">
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${statusDotClass(site.overallStatus)}`} />
              <span className="text-xs font-medium flex-1 truncate group-hover:underline">{site.name}</span>
              <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px] hidden sm:block" dir="ltr">{site.host}</span>
              <span className={`text-[10px] font-medium flex-shrink-0 ${
                site.overallStatus === "up" ? "text-green-500 dark:text-green-400" :
                site.overallStatus === "slow" ? "text-yellow-500 dark:text-yellow-400" :
                site.overallStatus === "down" || site.overallStatus === "not_stable" ? "text-red-500 dark:text-red-400" :
                site.overallStatus === "degraded" || site.overallStatus === "blocked" ? "text-orange-500 dark:text-orange-400" :
                "text-muted-foreground"
              }`}>
                {statusLabel(site.overallStatus)}
              </span>
            </div>
            {site.overallStatus === "up" && (site.consecutiveSuccesses ?? 0) >= 3 && (
              <div className="flex items-center gap-1 pl-4">
                <span className="text-[9px] font-mono text-green-500/60 dark:text-green-400/50">
                  {site.consecutiveSuccesses}× no downtime
                </span>
              </div>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function ServersPage() {
  const { t } = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: servers = [], isLoading } = useServers();
  const { data: sitesData } = useListSites({ query: { staleTime: 10000, refetchInterval: 15000 } });
  const sites = (sitesData as unknown as SiteStatusRecord[] | undefined) ?? [];

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ServerRecord | null>(null);
  const [expandedServers, setExpandedServers] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState<ServerRecord | null>(null);
  const [assigningServer, setAssigningServer] = useState<string>("");
  const [selectedUnassigned, setSelectedUnassigned] = useState<number[]>([]);

  const unassignedSites = sites.filter((s) => !s.serverId);

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/servers/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SERVERS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
      toast({ title: t("servers.deleteSuccess") });
      setDeleting(null);
    },
    onError: () => {
      toast({ title: t("servers.deleteError"), variant: "destructive" });
    },
  });

  const bulkAssignMutation = useMutation({
    mutationFn: async ({ siteIds, serverId }: { siteIds: number[]; serverId: number }) => {
      const r = await fetch("/api/sites/bulk-assign-server", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteIds, serverId }),
      });
      if (!r.ok) throw new Error("Failed to assign");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SERVERS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
      toast({ title: t("servers.assignSuccess") });
      setSelectedUnassigned([]);
      setAssigningServer("");
    },
    onError: () => {
      toast({ title: t("servers.assignError"), variant: "destructive" });
    },
  });

  function toggleExpanded(id: number) {
    setExpandedServers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleEdit(server: ServerRecord) {
    setEditing(server);
    setFormOpen(true);
  }

  function handleCloseForm() {
    setFormOpen(false);
    setEditing(null);
  }

  function toggleUnassigned(id: number) {
    setSelectedUnassigned((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function handleBulkAssign() {
    if (!assigningServer || selectedUnassigned.length === 0) return;
    bulkAssignMutation.mutate({ siteIds: selectedUnassigned, serverId: parseInt(assigningServer) });
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link href="/">
              <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="h-4 w-4" />
              </button>
            </Link>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Server className="h-6 w-6 text-primary" />
              {t("servers.title")}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">{t("servers.desc")}</p>
        </div>
        <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          {t("servers.addServer")}
        </Button>
      </div>

      {/* Unassigned Sites Alert */}
      {unassignedSites.length > 0 && (
        <div className="border border-amber-500/30 bg-amber-500/10 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 text-amber-500 font-semibold">
            <AlertTriangle className="h-5 w-5" />
            <span>{t("servers.unassignedTitle")} ({unassignedSites.length})</span>
          </div>
          <p className="text-sm text-muted-foreground">{t("servers.unassignedHint")}</p>

          <div className="space-y-2">
            {unassignedSites.map((site) => (
              <label
                key={site.id}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors",
                  selectedUnassigned.includes(site.id)
                    ? "bg-amber-500/20"
                    : "hover:bg-muted/50",
                )}
              >
                <input
                  type="checkbox"
                  checked={selectedUnassigned.includes(site.id)}
                  onChange={() => toggleUnassigned(site.id)}
                  className="accent-amber-500"
                />
                <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="font-medium text-sm">{site.name}</span>
                <span className="text-xs text-muted-foreground" dir="ltr">{site.host}</span>
              </label>
            ))}
          </div>

          {selectedUnassigned.length > 0 && servers.length > 0 && (
            <div className="flex items-center gap-3 pt-1">
              <Select value={assigningServer} onValueChange={setAssigningServer}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder={t("servers.selectServer")} />
                </SelectTrigger>
                <SelectContent>
                  {servers.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                        {s.code} — {s.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!assigningServer || bulkAssignMutation.isPending}
                onClick={handleBulkAssign}
              >
                {bulkAssignMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                {t("servers.assignSelected")} ({selectedUnassigned.length})
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setSelectedUnassigned([]); setAssigningServer(""); }}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Servers grid */}
      {isLoading ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : servers.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <Server className="h-12 w-12 mx-auto text-muted-foreground/30" />
          <p className="text-lg font-medium text-muted-foreground">{t("servers.noServers")}</p>
          <p className="text-sm text-muted-foreground">{t("servers.noServersHint")}</p>
          <Button className="mt-2" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            {t("servers.addServer")}
          </Button>
        </div>
      ) : (
        <>
          {/* Summary row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-border bg-card px-4 py-3 text-center">
              <p className="text-2xl font-bold font-mono">{servers.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("servers.title")}</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-4 py-3 text-center">
              <p className="text-2xl font-bold font-mono">{sites.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("servers.sitesLabel")}</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-4 py-3 text-center">
              <p className="text-2xl font-bold font-mono text-green-500 dark:text-green-400">{sites.filter((s) => s.overallStatus === "up").length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Up</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-4 py-3 text-center">
              <p className="text-2xl font-bold font-mono text-red-500 dark:text-red-400">{sites.filter((s) => s.overallStatus === "down" || s.overallStatus === "not_stable").length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Down</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {servers.map((server) => {
              const isExpanded = expandedServers.has(server.id);
              const serverSites = sites.filter((s) => s.serverId === server.id);
              return (
                <div
                  key={server.id}
                  className="relative border border-border rounded-xl overflow-hidden bg-card"
                >
                  {/* Color header */}
                  <div className="h-1.5 w-full" style={{ backgroundColor: server.color }} />
                  <div className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5 min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold text-white flex-shrink-0"
                            style={{ backgroundColor: server.color }}
                          >
                            {server.code}
                          </span>
                          <span className="font-semibold text-sm truncate">{server.name}</span>
                        </div>
                        {server.description && (
                          <p className="text-xs text-muted-foreground truncate">{server.description}</p>
                        )}
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleEdit(server)}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleting(server)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Globe className="h-3 w-3" />
                        {server.siteCount} {t("servers.sitesLabel")}
                      </span>
                      <span className="flex items-center gap-1">
                        <Activity className="h-3 w-3" />
                        Order #{server.displayOrder}
                      </span>
                    </div>

                    {server.siteCount > 0 && (
                      <div className="border-t border-border pt-2.5">
                        <ServerHealthBar serverId={server.id} sites={sites} />
                      </div>
                    )}

                    {server.notes && (
                      <p className="text-xs text-muted-foreground italic border-t border-border pt-2">{server.notes}</p>
                    )}

                    {serverSites.length > 0 && (
                      <div className="border-t border-border pt-2">
                        <button
                          type="button"
                          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                          onClick={() => toggleExpanded(server.id)}
                        >
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          {isExpanded ? "Hide sites" : `Show ${serverSites.length} site${serverSites.length !== 1 ? "s" : ""}`}
                        </button>
                        {isExpanded && (
                          <div className="mt-1 border border-border rounded-md overflow-hidden">
                            <ServerSiteList serverId={server.id} sites={sites} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      
      )}

      {/* Form dialog */}
      {formOpen && (
        <ServerFormDialog
          open={formOpen}
          onClose={handleCloseForm}
          editing={editing}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("servers.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("servers.deleteConfirmDesc").replace("{name}", deleting?.name ?? "")}
              {(deleting?.siteCount ?? 0) > 0 && (
                <span className="block mt-2 text-amber-500 font-medium">
                  {t("servers.deleteWarnSites").replace("{count}", String(deleting?.siteCount ?? 0))}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
