import { useState } from "react";
import { Link, useParams } from "wouter";
import { formatDistanceToNow, format } from "date-fns";
import {
  useGetIncident,
  getGetIncidentQueryKey,
  useAcknowledgeIncident,
  useResolveIncident,
  useGetIncidentNotes,
  getGetIncidentNotesQueryKey,
  useCreateIncidentNote,
  IncidentStatus,
  OverallStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Terminal,
  Globe,
  MessageSquare,
  Send,
  User,
  Hash,
  FileText,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/i18n/LanguageProvider";

function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const { t } = useT();
  switch (status) {
    case "open":
      return <Badge variant="destructive" className="uppercase tracking-wider">{t("incident.status.open")}</Badge>;
    case "acknowledged":
      return <Badge className="bg-warning text-warning-foreground uppercase tracking-wider">{t("incident.status.acknowledged")}</Badge>;
    case "resolved":
      return <Badge className="bg-success text-success-foreground uppercase tracking-wider">{t("incident.status.resolved")}</Badge>;
    default:
      return <Badge variant="secondary" className="uppercase tracking-wider">{status}</Badge>;
  }
}

function StatusDot({ status }: { status: OverallStatus }) {
  switch (status) {
    case "up": return <span className="flex w-2 h-2 rounded-full bg-success" />;
    case "slow": return <span className="flex w-2 h-2 rounded-full bg-warning" />;
    case "down": return <span className="flex w-2 h-2 rounded-full bg-destructive" />;
    case "degraded": return <span className="flex w-2 h-2 rounded-full bg-orange-500" />;
    case "blocked": return <span className="flex w-2 h-2 rounded-full bg-slate-500" />;
    case "not_stable": return <span className="flex w-2 h-2 rounded-full bg-amber-500" />;
    default: return <span className="flex w-2 h-2 rounded-full bg-muted-foreground" />;
  }
}

function formatDuration(seconds: number | null | undefined, ongoingLabel: string) {
  if (!seconds) return ongoingLabel;
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hrs}h ${remainingMins}m`;
}

export default function IncidentDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useT();
  const [noteText, setNoteText] = useState("");
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveReason, setResolveReason] = useState("");

  const { data: incident, isLoading } = useGetIncident(id, {
    query: { queryKey: getGetIncidentQueryKey(id), refetchInterval: 10000, enabled: !!id },
  });

  const { data: notes } = useGetIncidentNotes(id, {
    query: { queryKey: getGetIncidentNotesQueryKey(id), refetchInterval: 15000, enabled: !!id },
  });

  const createNote = useCreateIncidentNote();
  const acknowledge = useAcknowledgeIncident();
  const resolve = useResolveIncident();

  if (!id) return <div>Invalid Incident ID</div>;

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold">{t("inc.notFound")}</h2>
        <Link href="/incidents">
          <Button className="mt-4" variant="outline">{t("common.back")}</Button>
        </Link>
      </div>
    );
  }

  const handleSubmitNote = () => {
    if (!noteText.trim()) return;
    createNote.mutate(
      { id, data: { note: noteText.trim(), author: "Operator" } },
      {
        onSuccess: () => {
          toast({ title: t("inc.detail.notes.added") });
          setNoteText("");
          queryClient.invalidateQueries({ queryKey: getGetIncidentNotesQueryKey(id) });
        },
        onError: (err: unknown) => {
          toast({
            title: t("inc.detail.notes.failed"),
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleAcknowledge = () => {
    acknowledge.mutate({ id }, {
      onSuccess: () => {
        toast({ title: t("inc.detail.acknowledge") });
        queryClient.invalidateQueries({ queryKey: getGetIncidentQueryKey(id) });
      },
    });
  };

  const handleResolveConfirm = () => {
    const trimmed = resolveReason.trim();
    resolve.mutate(
      { id, data: trimmed ? { resolvedReason: trimmed } : {} },
      {
        onSuccess: () => {
          toast({ title: t("inc.detail.resolveIssue") });
          setResolveOpen(false);
          setResolveReason("");
          queryClient.invalidateQueries({ queryKey: getGetIncidentQueryKey(id) });
        },
      },
    );
  };

  const duration =
    incident.status === "resolved"
      ? formatDuration(incident.durationSeconds, t("inc.detail.ongoing"))
      : formatDuration(
          Math.floor((Date.now() - new Date(incident.startedAt).getTime()) / 1000),
          t("inc.detail.ongoing"),
        );

  const resolvedByLabel = (() => {
    const v = incident.resolvedBy;
    if (!v) return null;
    if (v === "system") return t("inc.detail.resolvedBy.system");
    if (v === "operator") return t("inc.detail.resolvedBy.operator");
    return v;
  })();

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex items-center gap-4 mb-4">
        <Link href="/incidents">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-bold tracking-tight" dir="ltr">INC-{incident.id}</h2>
            <IncidentStatusBadge status={incident.status} />
          </div>
          <p className="text-muted-foreground flex items-center gap-2 mt-1">
            <Globe className="h-4 w-4" />
            <Link href={`/sites/${incident.siteId}`} className="hover:underline font-medium text-foreground">
              {incident.siteName}
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {incident.status === "open" && (
            <Button onClick={handleAcknowledge} disabled={acknowledge.isPending} className="bg-warning text-warning-foreground hover:bg-warning/90">
              {t("inc.detail.acknowledge")}
            </Button>
          )}
          {(incident.status === "open" || incident.status === "acknowledged") && (
            <Button
              onClick={() => setResolveOpen(true)}
              disabled={resolve.isPending}
              className="bg-success text-success-foreground hover:bg-success/90"
            >
              {t("inc.detail.resolveIssue")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{incident.title}</CardTitle>
            <CardDescription className="capitalize">{incident.incidentType.replace("_", " ")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h4 className="text-sm font-medium mb-2 text-muted-foreground">{t("inc.detail.description")}</h4>
              <div className="p-4 bg-muted/30 rounded-md font-mono text-sm whitespace-pre-wrap border" dir="ltr">
                {incident.description || t("inc.detail.noDescription")}
              </div>
            </div>

            {/* Resolution provenance — only when resolved AND any of the new fields are populated */}
            {incident.status === "resolved" &&
              (incident.resolvedReason || incident.resolvedBy || incident.resolvedFromCheckId != null) && (
                <div className="border rounded-md p-4 bg-success/5 border-success/30 space-y-3">
                  <h4 className="text-sm font-medium text-success flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    {t("inc.detail.resolved")}
                  </h4>
                  <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                    {resolvedByLabel && (
                      <div>
                        <dt className="text-xs text-muted-foreground flex items-center gap-1">
                          <User className="h-3 w-3" /> {t("inc.detail.resolvedBy")}
                        </dt>
                        <dd className="font-medium mt-0.5">{resolvedByLabel}</dd>
                      </div>
                    )}
                    {incident.resolvedFromCheckId != null && (
                      <div>
                        <dt className="text-xs text-muted-foreground flex items-center gap-1">
                          <Hash className="h-3 w-3" /> {t("inc.detail.resolvedFromCheck")}
                        </dt>
                        <dd className="font-mono text-sm mt-0.5" dir="ltr">#{incident.resolvedFromCheckId}</dd>
                      </div>
                    )}
                    {incident.resolvedReason && (
                      <div className="sm:col-span-3">
                        <dt className="text-xs text-muted-foreground flex items-center gap-1">
                          <FileText className="h-3 w-3" /> {t("inc.detail.resolvedReason")}
                        </dt>
                        <dd className="mt-1 whitespace-pre-wrap text-sm">{incident.resolvedReason}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

            <div>
              <h4 className="text-sm font-medium mb-4 text-muted-foreground">{t("inc.detail.timeline")}</h4>
              <div className="relative border-l border-border ml-3 space-y-8 pb-4">
                {incident.resolvedAt && (
                  <div className="relative pl-6">
                    <span className="absolute -left-[11px] top-1 flex h-5 w-5 items-center justify-center rounded-full bg-success border-2 border-background">
                      <CheckCircle2 className="h-3 w-3 text-success-foreground" />
                    </span>
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold">{t("inc.detail.resolved")}</span>
                      <span className="text-xs text-muted-foreground" dir="ltr">{format(new Date(incident.resolvedAt), "PPpp")}</span>
                    </div>
                  </div>
                )}

                {incident.acknowledgedAt && (
                  <div className="relative pl-6">
                    <span className="absolute -left-[11px] top-1 flex h-5 w-5 items-center justify-center rounded-full bg-warning border-2 border-background">
                      <AlertTriangle className="h-3 w-3 text-warning-foreground" />
                    </span>
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold">{t("inc.detail.ackd")}</span>
                      <span className="text-xs text-muted-foreground" dir="ltr">{format(new Date(incident.acknowledgedAt), "PPpp")}</span>
                    </div>
                  </div>
                )}

                {incident.timeline && incident.timeline.length > 0 && (
                  <div className="relative pl-6">
                    <span className="absolute -left-[11px] top-1 flex h-5 w-5 items-center justify-center rounded-full bg-muted border-2 border-background">
                      <Terminal className="h-3 w-3 text-muted-foreground" />
                    </span>
                    <div className="flex flex-col space-y-3">
                      <span className="text-sm font-semibold">{t("inc.detail.recordedChecks")}</span>
                      <div className="space-y-2 mt-2">
                        {incident.timeline.map((check) => (
                          <div key={check.id} className="flex items-center gap-3 p-2 rounded bg-muted/20 border text-xs font-mono" dir="ltr">
                            <StatusDot status={check.overallStatus} />
                            <span className="text-muted-foreground min-w-[60px]">{format(new Date(check.timestamp), "HH:mm:ss")}</span>
                            {check.httpStatus && <span className="px-1.5 py-0.5 bg-background rounded border">{check.httpStatus}</span>}
                            <span className="truncate flex-1">{check.errorMessage || check.errorType || "Check failed"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="relative pl-6">
                  <span className="absolute -left-[11px] top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive border-2 border-background">
                    <AlertCircle className="h-3 w-3 text-destructive-foreground" />
                  </span>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold">{t("inc.detail.opened")}</span>
                    <span className="text-xs text-muted-foreground" dir="ltr">{format(new Date(incident.startedAt), "PPpp")}</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* Notes section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                {t("inc.detail.notes")}
                {notes && notes.length > 0 && (
                  <Badge variant="secondary" className="ml-1">{notes.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {notes && notes.length > 0 ? (
                <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                  {notes.map((note) => (
                    <div key={note.id} className="p-3 rounded-md bg-muted/30 border border-border/50 text-sm">
                      <p className="whitespace-pre-wrap">{note.note}</p>
                      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                        <span className="font-medium">{note.author}</span>
                        <span>·</span>
                        <span dir="ltr">{formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("inc.detail.notes.empty")}</p>
              )}
              <div className="space-y-2 pt-1">
                <Textarea
                  placeholder={t("inc.detail.notes.placeholder")}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  className="text-sm min-h-[80px] resize-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSubmitNote();
                  }}
                />
                <Button
                  size="sm"
                  onClick={handleSubmitNote}
                  disabled={!noteText.trim() || createNote.isPending}
                >
                  <Send className="h-3.5 w-3.5 mr-2" />
                  {createNote.isPending ? t("inc.detail.notes.adding") : t("inc.detail.notes.add")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("inc.detail.details")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-4 text-sm">
                <div className="flex justify-between items-center py-2 border-b border-border/50">
                  <dt className="text-muted-foreground">{t("inc.detail.severity")}</dt>
                  <dd>
                    {incident.severity === "critical" ? (
                      <Badge variant="destructive" className="border-0">{t("severity.critical")}</Badge>
                    ) : incident.severity === "warning" ? (
                      <Badge className="bg-warning text-warning-foreground border-0">{t("severity.warning")}</Badge>
                    ) : (
                      <Badge variant="secondary" className="border-0">{t("severity.info")}</Badge>
                    )}
                  </dd>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/50">
                  <dt className="text-muted-foreground">{t("inc.detail.duration")}</dt>
                  <dd className="font-medium font-mono" dir="ltr">{duration}</dd>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/50">
                  <dt className="text-muted-foreground">{t("inc.detail.checksFailed")}</dt>
                  <dd className="font-medium font-mono" dir="ltr">{incident.failureCount}</dd>
                </div>
                <div className="flex justify-between items-center py-2">
                  <dt className="text-muted-foreground">{t("inc.detail.started")}</dt>
                  <dd className="text-right" dir="ltr">
                    <div className="font-medium">{format(new Date(incident.startedAt), "MMM d, HH:mm")}</div>
                    <div className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(incident.startedAt), { addSuffix: true })}</div>
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Resolve dialog with optional reason */}
      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("inc.detail.resolveTitle")}</DialogTitle>
            <DialogDescription>{t("inc.detail.resolveReasonPlaceholder")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="resolve-reason">{t("inc.detail.resolveReasonLabel")}</Label>
            <Textarea
              id="resolve-reason"
              placeholder={t("inc.detail.resolveReasonPlaceholder")}
              value={resolveReason}
              onChange={(e) => setResolveReason(e.target.value)}
              className="min-h-[100px] resize-none"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setResolveOpen(false);
                setResolveReason("");
              }}
              disabled={resolve.isPending}
            >
              {t("inc.detail.resolveCancel")}
            </Button>
            <Button
              onClick={handleResolveConfirm}
              disabled={resolve.isPending}
              className="bg-success text-success-foreground hover:bg-success/90"
            >
              {t("inc.detail.resolveConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
