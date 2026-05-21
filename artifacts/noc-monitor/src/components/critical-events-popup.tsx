import { useEffect, useState } from "react";
import { useLink } from "wouter";
import { AlertTriangle, X, ExternalLink, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/LanguageProvider";
import { useAuth } from "@/contexts/auth";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

const SESSION_KEY = "noc.critical-popup-seen";

interface CriticalIncident {
  id: number;
  siteId: number;
  siteName: string;
  siteHost: string;
  severity: "critical" | "warning";
  status: "open" | "acknowledged" | "resolved";
  title: string;
  description: string | null;
  startedAt: string;
  failureCount: number;
}

interface EventsResponse {
  incidents: CriticalIncident[];
  total: number;
  windowMs: number;
}

function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`,
  );
}

export function CriticalEventsPopup() {
  const { t } = useT();
  const { user } = useAuth();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<EventsResponse | null>(null);

  const canView =
    user?.role === "admin" ||
    user?.role === "founder" ||
    user?.role === "operator";

  useEffect(() => {
    if (!canView || !user) return;

    // Only show once per browser session
    const alreadySeen = sessionStorage.getItem(SESSION_KEY);
    if (alreadySeen) return;

    sessionStorage.setItem(SESSION_KEY, "1");

    setLoading(true);
    fetch("/api/events/critical?last=1h", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: EventsResponse | null) => {
        if (json && json.total > 0) {
          setData(json);
          setOpen(true);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [canView, user]);

  if (!canView || loading) return null;

  const criticalCount = data?.incidents.filter((i) => i.severity === "critical").length ?? 0;
  const openCount = data?.incidents.filter((i) => i.status === "open").length ?? 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5 flex-shrink-0" />
            {t("critical.title")}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{t("critical.subtitle")}</p>
        </DialogHeader>

        {data && (
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <Badge className="bg-destructive/15 text-destructive border border-destructive/30 hover:bg-destructive/15">
              {fmt(t("critical.total"), { count: data.total })}
            </Badge>
            {criticalCount > 0 && (
              <Badge variant="outline" className="text-destructive border-destructive/50">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {fmt(t("critical.criticalCount"), { count: criticalCount })}
              </Badge>
            )}
            {openCount > 0 && (
              <Badge variant="outline" className="text-orange-600 dark:text-orange-400 border-orange-400/50">
                {fmt(t("critical.openIncidents"), { count: openCount })}
              </Badge>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
          {!data ? (
            <p className="text-sm text-muted-foreground italic py-4 text-center">
              {t("critical.empty")}
            </p>
          ) : (
            data.incidents.map((inc) => (
              <div
                key={inc.id}
                className={cn(
                  "rounded-lg border p-3 text-sm space-y-1",
                  inc.severity === "critical"
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-orange-400/40 bg-orange-50/50 dark:bg-orange-900/10",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium leading-tight flex items-center gap-1.5">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full flex-shrink-0 mt-0.5",
                        inc.severity === "critical" ? "bg-destructive" : "bg-orange-500",
                      )}
                    />
                    {inc.title}
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] px-1.5 shrink-0",
                      inc.status === "open"
                        ? "text-destructive border-destructive/50"
                        : inc.status === "acknowledged"
                          ? "text-orange-600 border-orange-400/50"
                          : "text-muted-foreground",
                    )}
                  >
                    {inc.status}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {inc.siteName}
                  {" · "}
                  {formatDistanceToNow(new Date(inc.startedAt), { addSuffix: true })}
                  {inc.failureCount > 1 && ` · ${inc.failureCount} failures`}
                </div>
              </div>
            ))
          )}
        </div>

        <DialogFooter className="gap-2 flex-row flex-wrap pt-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => setOpen(false)}
          >
            <X className="h-3.5 w-3.5" />
            {t("critical.dismiss")}
          </Button>
          <a href="/incidents?status=open">
            <Button size="sm" className="gap-1.5" onClick={() => setOpen(false)}>
              <ExternalLink className="h-3.5 w-3.5" />
              {t("critical.viewIncidents")}
            </Button>
          </a>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
