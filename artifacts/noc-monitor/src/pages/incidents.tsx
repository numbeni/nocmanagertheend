import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { faIR } from "date-fns/locale";
import {
  useListIncidents,
  getListIncidentsQueryKey,
  useAcknowledgeIncident,
  useResolveIncident,
  IncidentStatus,
  Severity,
  ListIncidentsSortBy,
  ListIncidentsOrder,
} from "@workspace/api-client-react";
import { AlertCircle, AlertTriangle, ArrowDownWideNarrow, Clock, ShieldCheck } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/i18n/LanguageProvider";

function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const { t } = useT();
  switch (status) {
    case "open":
      return <Badge variant="destructive" className="uppercase text-[10px] tracking-wider">{t("incident.status.open")}</Badge>;
    case "acknowledged":
      return <Badge className="bg-warning text-warning-foreground uppercase text-[10px] tracking-wider hover:bg-warning/90">{t("incident.status.acknowledged")}</Badge>;
    case "resolved":
      return <Badge className="bg-success text-success-foreground uppercase text-[10px] tracking-wider hover:bg-success/90">{t("incident.status.resolved")}</Badge>;
    default:
      return <Badge variant="secondary" className="uppercase text-[10px] tracking-wider">{status}</Badge>;
  }
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const { t } = useT();
  switch (severity) {
    case "critical":
      return (
        <Badge variant="destructive" className="bg-destructive/10 text-destructive hover:bg-destructive/20 border-0">
          <AlertTriangle className="w-3 h-3 mr-1" /> {t("severity.critical")}
        </Badge>
      );
    case "warning":
      return (
        <Badge variant="secondary" className="bg-warning/10 text-warning hover:bg-warning/20 border-0">
          <AlertCircle className="w-3 h-3 mr-1" /> {t("severity.warning")}
        </Badge>
      );
    case "info":
      return (
        <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20 border-0">
          <Clock className="w-3 h-3 mr-1" /> {t("severity.info")}
        </Badge>
      );
  }
}

function formatDuration(seconds: number | null | undefined) {
  if (!seconds) return "—";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hrs}h ${remainingMins}m`;
}

const VALID_TABS = new Set(["all", "open", "acknowledged", "resolved"]);

function readInitialTab(): string {
  if (typeof window === "undefined") return "all";
  const raw = new URLSearchParams(window.location.search).get("status");
  return raw && VALID_TABS.has(raw) ? raw : "all";
}

// Operator-controlled combinations. Persist to localStorage so the operator's
// preferred sort sticks across reloads (no global setting needed for this).
type SortKey =
  | "updatedAt:desc"
  | "updatedAt:asc"
  | "createdAt:desc"
  | "createdAt:asc";

const VALID_SORTS: SortKey[] = [
  "updatedAt:desc",
  "updatedAt:asc",
  "createdAt:desc",
  "createdAt:asc",
];

const SORT_STORAGE_KEY = "noc.incidents.sort";

function readInitialSort(): SortKey {
  if (typeof window === "undefined") return "updatedAt:desc";
  const raw = window.localStorage.getItem(SORT_STORAGE_KEY) as SortKey | null;
  return raw && VALID_SORTS.includes(raw) ? raw : "updatedAt:desc";
}

export default function Incidents() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<string>(readInitialTab);
  const [sortKey, setSortKey] = useState<SortKey>(readInitialSort);
  const { t, dir } = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const acknowledgeIncident = useAcknowledgeIncident();
  const resolveIncident = useResolveIncident();

  const apiStatus = activeTab as any;
  const [sortField, sortDirection] = sortKey.split(":") as [
    "updatedAt" | "createdAt",
    "asc" | "desc",
  ];

  const params = {
    status: apiStatus,
    sortBy: sortField as typeof ListIncidentsSortBy[keyof typeof ListIncidentsSortBy],
    order: sortDirection as typeof ListIncidentsOrder[keyof typeof ListIncidentsOrder],
  };

  const { data: incidents, isLoading } = useListIncidents(params, {
    query: { queryKey: getListIncidentsQueryKey(params), refetchInterval: 10000 },
  });

  const handleSortChange = (next: string) => {
    const k = (VALID_SORTS as string[]).includes(next) ? (next as SortKey) : "updatedAt:desc";
    setSortKey(k);
    try {
      window.localStorage.setItem(SORT_STORAGE_KEY, k);
    } catch {
      /* ignore quota / privacy errors */
    }
  };

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{t("inc.title")}</h2>
          <p className="text-muted-foreground mt-1">{t("inc.subtitle")}</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <TabsList>
            <TabsTrigger value="all">{t("inc.tab.all")}</TabsTrigger>
            <TabsTrigger value="open">{t("inc.tab.open")}</TabsTrigger>
            <TabsTrigger value="acknowledged">{t("inc.tab.ack")}</TabsTrigger>
            <TabsTrigger value="resolved">{t("inc.tab.resolved")}</TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            <ArrowDownWideNarrow className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{t("inc.sort.label")}:</span>
            <Select value={sortKey} onValueChange={handleSortChange}>
              <SelectTrigger className="h-8 w-[230px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updatedAt:desc">{t("inc.sort.updatedAtDesc")}</SelectItem>
                <SelectItem value="updatedAt:asc">{t("inc.sort.updatedAtAsc")}</SelectItem>
                <SelectItem value="createdAt:desc">{t("inc.sort.createdAtDesc")}</SelectItem>
                <SelectItem value="createdAt:asc">{t("inc.sort.createdAtAsc")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("table.status")}</TableHead>
                  <TableHead>{t("inc.detail.severity")}</TableHead>
                  <TableHead>{t("table.site")}</TableHead>
                  <TableHead>{t("inc.col.issue")}</TableHead>
                  <TableHead>{t("inc.col.started")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("inc.col.updated")}</TableHead>
                  <TableHead className="text-right">{t("inc.col.duration")}</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">{t("inc.col.failures")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : incidents && incidents.length > 0 ? (
                  incidents.map((incident) => (
                    <ContextMenu key={incident.id}>
                      <ContextMenuTrigger asChild>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/50 transition-colors"
                          onClick={() => setLocation(`/incidents/${incident.id}`)}
                        >
                          <TableCell><IncidentStatusBadge status={incident.status} /></TableCell>
                          <TableCell><SeverityBadge severity={incident.severity} /></TableCell>
                          <TableCell className="font-medium">{incident.siteName}</TableCell>
                          <TableCell>
                            <div className="font-medium text-sm truncate max-w-[200px]">{incident.title}</div>
                            <div className="text-xs text-muted-foreground capitalize">{incident.incidentType.replace("_", " ")}</div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {formatDistanceToNow(new Date(incident.startedAt), { addSuffix: true, locale: dir === "rtl" ? faIR : undefined })}
                          </TableCell>
                          <TableCell className="text-sm hidden md:table-cell text-muted-foreground">
                            {formatDistanceToNow(new Date(incident.updatedAt), { addSuffix: true, locale: dir === "rtl" ? faIR : undefined })}
                          </TableCell>
                          <TableCell className="text-right text-sm" dir="ltr">
                            {incident.status === "resolved"
                              ? formatDuration(incident.durationSeconds)
                              : formatDuration(Math.floor((Date.now() - new Date(incident.startedAt).getTime()) / 1000))}
                          </TableCell>
                          <TableCell className="text-right hidden sm:table-cell text-sm" dir="ltr">{incident.failureCount}</TableCell>
                        </TableRow>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-56">
                        <ContextMenuItem onClick={() => setLocation(`/incidents/${incident.id}`)}>
                          {t("ctx.inc.openDetail") || "Open incident"}
                        </ContextMenuItem>
                        {incident.siteId != null && (
                          <ContextMenuItem onClick={() => setLocation(`/sites/${incident.siteId}`)}>
                            {t("ctx.inc.openSite") || "Open site detail"}
                          </ContextMenuItem>
                        )}
                        <ContextMenuSeparator />
                        {incident.status === "open" && (
                          <ContextMenuItem
                            onClick={() =>
                              acknowledgeIncident.mutate(
                                { id: incident.id },
                                {
                                  onSuccess: () => {
                                    toast({ title: t("ctx.inc.acknowledged") || "Incident acknowledged" });
                                    queryClient.invalidateQueries({ queryKey: getListIncidentsQueryKey() });
                                  },
                                },
                              )
                            }
                          >
                            {t("ctx.inc.acknowledge") || "Acknowledge"}
                          </ContextMenuItem>
                        )}
                        {incident.status !== "resolved" && (
                          <ContextMenuItem
                            onClick={() =>
                              resolveIncident.mutate(
                                { id: incident.id, data: {} },
                                {
                                  onSuccess: () => {
                                    toast({ title: t("ctx.inc.resolved") || "Incident resolved" });
                                    queryClient.invalidateQueries({ queryKey: getListIncidentsQueryKey() });
                                  },
                                },
                              )
                            }
                          >
                            {t("ctx.inc.resolve") || "Mark resolved"}
                          </ContextMenuItem>
                        )}
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          onClick={() => {
                            navigator.clipboard.writeText(
                              `[${incident.severity.toUpperCase()}] ${incident.title} — ${incident.siteName}`,
                            );
                            toast({ title: t("ctx.inc.copied") || "Copied to clipboard" });
                          }}
                        >
                          {t("ctx.inc.copySummary") || "Copy summary"}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="h-64 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground">
                        <ShieldCheck className="h-12 w-12 mb-4 text-success/50" />
                        <p className="text-lg font-medium text-foreground">{t("inc.empty.title")}</p>
                        <p className="text-sm">{t("inc.empty.desc")}</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Tabs>
    </div>
  );
}
