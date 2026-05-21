import { useState, useEffect, useCallback, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/LanguageProvider";
import { useAuth } from "@/contexts/auth";
import { useLocation } from "wouter";
import {
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  X,
  Download,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { faIR } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface AuditEntry {
  id: number;
  timestamp: string;
  actorId: number | null;
  actorUsername: string | null;
  actorRole: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  entityName: string | null;
  siteId: number | null;
  details: string | null;
  ipAddress: string | null;
  result: string;
}

interface AuditResponse {
  data: AuditEntry[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface SiteOption {
  id: number;
  name: string;
  host: string;
}

const RESULT_COLORS: Record<string, string> = {
  success: "bg-green-500/15 text-green-600 dark:text-green-400",
  failure: "bg-destructive/15 text-destructive",
};

const ACTION_LABELS: Record<string, string> = {
  login: "Login",
  logout: "Logout",
  founder_setup: "Founder Setup",
  change_password: "Change Password",
  create_user: "Create User",
  update_user: "Update User",
  delete_user: "Delete User",
  update_settings: "Update Settings",
  create_site: "Create Site",
  update_site: "Update Site",
  delete_site: "Delete Site",
  bulk_delete_sites: "Bulk Delete Sites",
  clear_site_checks: "Clear Site Checks",
  acknowledge_incident: "Acknowledge Incident",
  resolve_incident: "Resolve Incident",
  add_incident_note: "Add Incident Note",
  pause_site: "Pause Site",
  resume_site: "Resume Site",
  add_dns_resolver: "Add DNS Resolver",
  remove_dns_resolver: "Remove DNS Resolver",
};

const RESOURCE_OPTIONS = ["", "session", "user", "settings", "site", "incident", "system", "dns_resolver"];
const ACTION_OPTIONS = ["", ...Object.keys(ACTION_LABELS)];
const RESULT_OPTIONS = ["", "success", "failure"];

export default function AuditLogPage() {
  const { t, dir } = useT();
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const canView = user?.role === "admin" || user?.role === "founder" || user?.role === "operator";
  useEffect(() => {
    if (!canView) navigate("/");
  }, [canView, navigate]);

  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [resource, setResource] = useState("");
  const [action, setAction] = useState("");
  const [result, setResult] = useState("");
  const [siteId, setSiteId] = useState("");
  const [siteQuery, setSiteQuery] = useState("");
  const [siteDropdownOpen, setSiteDropdownOpen] = useState(false);
  const siteDropdownRef = useRef<HTMLDivElement>(null);
  const [actor, setActor] = useState("");
  const [actorInput, setActorInput] = useState("");
  const [sites, setSites] = useState<SiteOption[]>([]);

  useEffect(() => {
    fetch("/api/sites", { credentials: "include" })
      .then((r) => r.ok ? r.json() : [])
      .then((list: { id: number; name: string; host: string }[]) => setSites(list))
      .catch(() => {});
  }, []);

  // Close site dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (siteDropdownRef.current && !siteDropdownRef.current.contains(e.target as Node)) {
        setSiteDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "50" });
      if (search) params.set("search", search);
      if (resource) params.set("resource", resource);
      if (action) params.set("action", action);
      if (result) params.set("result", result);
      if (siteId) params.set("siteId", siteId);
      if (actor) params.set("actorUsername", actor);

      const resp = await fetch(`/api/audit-logs?${params.toString()}`, {
        credentials: "include",
      });
      if (!resp.ok) throw new Error("Failed to load audit logs");
      const json: AuditResponse = await resp.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [page, search, resource, action, result, siteId, actor]);

  useEffect(() => {
    if (canView) fetchLogs();
  }, [fetchLogs, canView]);

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const clearFilters = () => {
    setSearch("");
    setSearchInput("");
    setResource("");
    setAction("");
    setResult("");
    setSiteId("");
    setActor("");
    setActorInput("");
    setPage(1);
  };

  async function handleExportText() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ format: "text", pageSize: "1000" });
      if (search) params.set("search", search);
      if (resource) params.set("resource", resource);
      if (action) params.set("action", action);
      if (result) params.set("result", result);
      if (siteId) params.set("siteId", siteId);
      if (actor) params.set("actorUsername", actor);

      const resp = await fetch(`/api/audit-logs?${params.toString()}`, { credentials: "include" });
      if (!resp.ok) throw new Error("Export failed");
      const text = await resp.text();
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-log-${format(new Date(), "yyyy-MM-dd-HHmm")}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
    } finally {
      setExporting(false);
    }
  }

  const hasFilters = search || resource || action || result || siteId || actor;

  if (!canView) return null;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-start gap-3">
        <ShieldCheck className="h-6 w-6 text-primary mt-0.5 flex-shrink-0" />
        <div>
          <h1 className="text-xl font-bold">{t("audit.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("audit.subtitle")}</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("audit.filters")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="space-y-1 lg:col-span-2">
              <Label className="text-xs">{t("audit.filterSearch")}</Label>
              <div className="flex gap-2">
                <Input
                  placeholder={t("audit.filterSearchPlaceholder")}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="h-8 text-sm"
                />
                <Button size="sm" variant="outline" className="h-8 px-2" onClick={handleSearch}>
                  <Search className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">{t("audit.filterActor")}</Label>
              <div className="flex gap-2">
                <Input
                  placeholder={t("audit.filterActorPlaceholder")}
                  value={actorInput}
                  onChange={(e) => setActorInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { setActor(actorInput); setPage(1); } }}
                  className="h-8 text-sm"
                />
                <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => { setActor(actorInput); setPage(1); }}>
                  <Search className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">{t("audit.filterSite")}</Label>
              <div className="relative" ref={siteDropdownRef}>
                <div className="flex items-center gap-1">
                  <Input
                    className="h-8 text-sm flex-1"
                    placeholder={t("audit.filterSitePlaceholder")}
                    value={siteId
                      ? (sites.find((s) => String(s.id) === siteId)?.name ?? siteQuery)
                      : siteQuery
                    }
                    onChange={(e) => {
                      setSiteQuery(e.target.value);
                      setSiteId("");
                      setSiteDropdownOpen(true);
                      setPage(1);
                    }}
                    onFocus={() => setSiteDropdownOpen(true)}
                  />
                  {(siteId || siteQuery) && (
                    <button
                      className="h-8 w-8 flex items-center justify-center rounded border border-input bg-background hover:bg-muted text-muted-foreground shrink-0"
                      onClick={() => { setSiteId(""); setSiteQuery(""); setSiteDropdownOpen(false); setPage(1); }}
                      type="button"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {siteDropdownOpen && (
                  <div className="absolute z-50 top-full mt-1 w-full bg-popover border border-border rounded-md shadow-md max-h-56 overflow-y-auto">
                    {sites
                      .filter((s) => !siteQuery || s.name.toLowerCase().includes(siteQuery.toLowerCase()) || s.host.toLowerCase().includes(siteQuery.toLowerCase()))
                      .map((s) => (
                        <button
                          key={s.id}
                          className={cn(
                            "w-full text-left px-3 py-1.5 text-sm hover:bg-muted truncate",
                            siteId === String(s.id) && "bg-muted font-medium",
                          )}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setSiteId(String(s.id));
                            setSiteQuery("");
                            setSiteDropdownOpen(false);
                            setPage(1);
                          }}
                        >
                          {s.name}
                          <span className="text-muted-foreground text-xs ml-1.5">{s.host}</span>
                        </button>
                      ))
                    }
                    {sites.filter((s) => !siteQuery || s.name.toLowerCase().includes(siteQuery.toLowerCase()) || s.host.toLowerCase().includes(siteQuery.toLowerCase())).length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">{t("common.noResults") || "No results"}</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">{t("audit.filterAction")}</Label>
              <Select value={action} onValueChange={(v) => { setAction(v === "_all" ? "" : v); setPage(1); }}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder={t("audit.filterAll")} />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4} className="max-h-60 overflow-y-auto">
                  <SelectItem value="_all">{t("audit.filterAll")}</SelectItem>
                  {ACTION_OPTIONS.filter(Boolean).map((a) => (
                    <SelectItem key={a} value={a}>
                      {ACTION_LABELS[a] ?? a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">{t("audit.filterResult")}</Label>
              <Select value={result} onValueChange={(v) => { setResult(v === "_all" ? "" : v); setPage(1); }}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder={t("audit.filterAll")} />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4} className="max-h-60 overflow-y-auto">
                  <SelectItem value="_all">{t("audit.filterAll")}</SelectItem>
                  <SelectItem value="success">{t("audit.resultSuccess")}</SelectItem>
                  <SelectItem value="failure">{t("audit.resultFailure")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {hasFilters && (
            <div className="mt-3">
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" onClick={clearFilters}>
                <X className="h-3.5 w-3.5" />
                {t("audit.clearFilters")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">{t("audit.tableTitle")}</CardTitle>
            {data && (
              <CardDescription className="text-xs mt-0.5">
                {t("audit.totalEntries").replace("{n}", String(data.pagination.total))}
              </CardDescription>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={handleExportText} disabled={exporting || !data?.data.length}>
              <Download className={cn("h-3.5 w-3.5", exporting && "animate-spin")} />
              {exporting ? t("audit.exporting") : t("audit.exportText")}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={fetchLogs}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              {t("common.refresh")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded" />
              ))}
            </div>
          ) : error ? (
            <div className="p-8 text-center text-sm text-destructive">{error}</div>
          ) : !data || data.data.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">{t("audit.empty")}</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-start px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{t("audit.colTime")}</th>
                      <th className="text-start px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{t("audit.colActor")}</th>
                      <th className="text-start px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{t("audit.colAction")}</th>
                      <th className="text-start px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{t("audit.colResource")}</th>
                      <th className="text-start px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{t("audit.colDetails")}</th>
                      <th className="text-start px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{t("audit.colResult")}</th>
                      <th className="text-start px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{t("audit.colIp")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map((entry) => {
                      let details: Record<string, unknown> | null = null;
                      try {
                        if (entry.details) details = JSON.parse(entry.details);
                      } catch {}

                      return (
                        <tr key={entry.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="text-xs text-foreground">{format(new Date(entry.timestamp), "MM/dd HH:mm:ss")}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true, locale: dir === "rtl" ? faIR : undefined })}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {entry.actorUsername ? (
                              <div>
                                <div className="text-xs font-medium">{entry.actorUsername}</div>
                                {entry.actorRole && (
                                  <div className="text-[10px] text-muted-foreground">{entry.actorRole}</div>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                              {ACTION_LABELS[entry.action] ?? entry.action}
                            </code>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="text-xs">{entry.resource}</div>
                            {(entry.resourceId || entry.entityName) && (
                              <div className="text-[10px] text-muted-foreground font-mono">
                                {entry.resourceId ? `#${entry.resourceId}` : ""}
                                {entry.resourceId && entry.entityName ? " — " : ""}
                                {entry.entityName ?? ""}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2.5 max-w-[240px]">
                            {entry.action === "add_incident_note" && details && (details as Record<string, unknown>).note ? (
                              <div className="space-y-0.5">
                                <div className="text-xs text-foreground/90 leading-snug line-clamp-3 whitespace-pre-wrap" title={String((details as Record<string, unknown>).note)}>
                                  {String((details as Record<string, unknown>).note)}
                                </div>
                                {(details as Record<string, unknown>).incidentId && (
                                  <div className="text-[10px] text-muted-foreground font-mono">
                                    incident #{String((details as Record<string, unknown>).incidentId)}
                                  </div>
                                )}
                              </div>
                            ) : details ? (
                              <div className="text-[10px] text-muted-foreground font-mono truncate" title={JSON.stringify(details)}>
                                {JSON.stringify(details)}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <Badge
                              variant="secondary"
                              className={cn("text-[10px] px-1.5 py-0", RESULT_COLORS[entry.result] ?? "")}
                            >
                              {entry.result === "success" ? t("audit.resultSuccess") : t("audit.resultFailure")}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {entry.ipAddress ?? "—"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {data.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <span className="text-xs text-muted-foreground">
                    {t("audit.pageInfo")
                      .replace("{page}", String(data.pagination.page))
                      .replace("{total}", String(data.pagination.totalPages))}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      disabled={page >= data.pagination.totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
