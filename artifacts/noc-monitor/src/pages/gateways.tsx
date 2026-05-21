import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  CreditCard,
  ExternalLink,
  Globe,
  Link2,
  Link2Off,
  Loader2,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  XCircle,
  Zap,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { faIR } from "date-fns/locale";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/i18n/LanguageProvider";
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

// ── Types ─────────────────────────────────────────────────────────────────────

interface GatewayCheck {
  id: number;
  gatewayId: number;
  dnsStatus: string | null;
  dnsResolveMs: number | null;
  resolvedIp: string | null;
  sslStatus: string | null;
  sslDaysRemaining: number | null;
  sslIssuer: string | null;
  httpStatus: number | null;
  httpResponseTimeMs: number | null;
  httpCheckStatus: string | null;
  paymentPageStatus: number | null;
  paymentPageResponseTimeMs: number | null;
  paymentPageCheckStatus: string | null;
  overallStatus: string;
  errorMessage: string | null;
  checkedAt: string;
}

interface Gateway {
  id: number;
  name: string;
  provider: string;
  baseDomain: string;
  apiUrl: string | null;
  paymentPageUrl: string | null;
  enabled: boolean;
  status: string;
  tags: string | null;
  notes: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  latestCheck: GatewayCheck | null;
}

interface GatewayDetail extends Gateway {
  linkedSites: { id: number; name: string; url: string }[];
}

interface CurlRedirectHop {
  url: string;
  status: number;
  location: string | null;
}

interface GatewayCurlResult {
  url: string;
  finalUrl: string;
  statusCode: number | null;
  statusGroup: string;
  responseTimeMs: number;
  redirectCount: number;
  redirectChain: CurlRedirectHop[];
  contentType: string | null;
  server: string | null;
  responseHeaders: Record<string, string>;
  bodyPreview: string | null;
  ok: boolean;
  errorMessage: string | null;
  generatedAt: string;
}

interface Site {
  id: number;
  name: string;
  url: string;
  host: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PROVIDERS = [
  "ZarinPal",
  "Zibal",
  "IDPay",
  "NextPay",
  "Vandar",
  "Mellat",
  "SEP/Saman",
  "Sadad",
  "Parsian",
  "DigiPay",
  "Asan Pardakht",
  "IranKish",
  "Pay.ir",
  "other",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusColor(s: string): string {
  if (s === "up") return "text-green-500";
  if (s === "degraded") return "text-yellow-500";
  if (s === "down") return "text-red-500";
  return "text-muted-foreground";
}

function statusBg(s: string): string {
  if (s === "up") return "border-green-500/30 bg-green-500/5";
  if (s === "degraded") return "border-yellow-500/30 bg-yellow-500/5";
  if (s === "down") return "border-red-500/30 bg-red-500/5";
  return "border-border bg-muted/20";
}

function statusBarColor(s: string): string {
  if (s === "up") return "hsl(142, 76%, 36%)";
  if (s === "degraded") return "hsl(38, 92%, 50%)";
  if (s === "down") return "hsl(0, 84%, 60%)";
  return "hsl(var(--muted-foreground))";
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useT();
  const label = t(`gw.status.${status}`) || status;
  if (status === "up")
    return <Badge className="bg-green-500/15 text-green-600 border-green-500/30 hover:bg-green-500/20">{label}</Badge>;
  if (status === "degraded")
    return <Badge className="bg-yellow-500/15 text-yellow-600 border-yellow-500/30 hover:bg-yellow-500/20">{label}</Badge>;
  if (status === "down")
    return <Badge variant="destructive">{label}</Badge>;
  return <Badge variant="outline">{label}</Badge>;
}

function StatusIcon({ status, size = "h-4 w-4" }: { status: string; size?: string }) {
  if (status === "up") return <CheckCircle2 className={`${size} text-green-500`} />;
  if (status === "degraded") return <AlertTriangle className={`${size} text-yellow-500`} />;
  if (status === "down") return <XCircle className={`${size} text-red-500`} />;
  return <AlertCircle className={`${size} text-muted-foreground`} />;
}

function DnsIndicator({ status, ms }: { status: string | null; ms: number | null }) {
  if (!status) return <span className="text-muted-foreground text-xs">—</span>;
  const ok = status === "ok";
  return (
    <span className={`text-xs font-mono ${ok ? "text-green-500" : "text-red-500"}`}>
      DNS {ok ? (ms ? `${Math.round(ms)}ms` : "OK") : status.toUpperCase()}
    </span>
  );
}

function SslIndicator({ status, days }: { status: string | null; days: number | null }) {
  if (!status) return <span className="text-muted-foreground text-xs">—</span>;
  const ok = status === "valid";
  const warn = status === "expiring_soon";
  const color = ok ? "text-green-500" : warn ? "text-yellow-500" : "text-red-500";
  const label = ok ? (days ? `SSL ${days}d` : "SSL OK") : warn ? `SSL ${days}d` : `SSL ${status}`;
  return <span className={`text-xs font-mono ${color}`}>{label}</span>;
}

function HttpIndicator({ status, ms }: { status: string | null; ms: number | null }) {
  if (!status) return <span className="text-muted-foreground text-xs">—</span>;
  const ok = status === "ok";
  const slow = status === "slow";
  const color = ok ? "text-green-500" : slow ? "text-yellow-500" : "text-red-500";
  return (
    <span className={`text-xs font-mono ${color}`}>
      HTTP {ok || slow ? (ms ? `${Math.round(ms)}ms` : "OK") : "DOWN"}
    </span>
  );
}

function latencyLabel(ms: number | null): string {
  if (ms == null) return "—";
  return `${Math.round(ms)}ms`;
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function fetchGateways(): Promise<Gateway[]> {
  const res = await fetch("/api/gateways", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch gateways");
  return res.json();
}

async function fetchGatewayDetail(id: number): Promise<GatewayDetail> {
  const res = await fetch(`/api/gateways/${id}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch gateway");
  return res.json();
}

async function fetchGatewayChecks(id: number): Promise<GatewayCheck[]> {
  const res = await fetch(`/api/gateways/${id}/checks?limit=50`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch checks");
  return res.json();
}

async function fetchSites(): Promise<Site[]> {
  const res = await fetch("/api/sites", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch sites");
  return res.json();
}

// ── Summary card ──────────────────────────────────────────────────────────────

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
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 ${variantClass}`}>{icon}</div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground mb-1">{title}</p>
            <p className={`text-2xl font-bold leading-none ${variantClass}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Gateway card ──────────────────────────────────────────────────────────────

function GatewayCard({
  gw,
  onCheck,
  onDelete,
  onSelect,
  checking,
}: {
  gw: Gateway;
  onCheck: () => void;
  onDelete: () => void;
  onSelect: () => void;
  checking: boolean;
}) {
  const { t, dir } = useT();
  const lc = gw.latestCheck;

  return (
    <Card
      className={`relative overflow-hidden cursor-pointer border transition-all hover:shadow-md ${statusBg(gw.status)}`}
      onClick={onSelect}
    >
      <CardContent className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusIcon status={gw.status} />
              <span className="font-semibold text-sm truncate">{gw.name}</span>
              <StatusBadge status={gw.status} />
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-xs text-muted-foreground font-mono truncate">{gw.baseDomain}</span>
            </div>
          </div>
          {/* Actions - stop propagation so card click doesn't also fire */}
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onCheck} disabled={checking}>
                  {checking ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  {t("gw.runCheck")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t("gw.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Provider badge */}
        {gw.provider && gw.provider !== "other" && (
          <div className="mb-2">
            <Badge variant="secondary" className="text-xs">{gw.provider}</Badge>
          </div>
        )}

        {/* Check indicator — status is derived from HTTP (curl -I) only */}
        {lc ? (
          <div className="flex flex-wrap gap-2 mb-2">
            <HttpIndicator status={lc.httpCheckStatus} ms={lc.httpResponseTimeMs} />
          </div>
        ) : (
          <div className="text-xs text-muted-foreground mb-2">{t("gw.noChecksYet")}</div>
        )}

        {/* Last checked */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
          <Clock className="h-3 w-3" />
          {gw.lastCheckedAt
            ? formatDistanceToNow(new Date(gw.lastCheckedAt), { addSuffix: true, locale: dir === "rtl" ? faIR : undefined })
            : t("gw.neverChecked")}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Add gateway form ──────────────────────────────────────────────────────────

function AddGatewayDialog({ onCreated }: { onCreated: () => void }) {
  const { t } = useT();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("other");
  const [baseDomain, setBaseDomain] = useState("");
  const [paymentPageUrl, setPaymentPageUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !baseDomain.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/gateways", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, provider, baseDomain, paymentPageUrl, notes }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: t("gw.addSuccess") });
      setOpen(false);
      setName(""); setProvider("other"); setBaseDomain(""); setPaymentPageUrl(""); setNotes("");
      onCreated();
    } catch {
      toast({ title: t("gw.addFailed"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          {t("gw.addGateway")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("gw.addGateway")}</DialogTitle>
          <DialogDescription>{t("gw.addGatewayDesc")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>{t("gw.fieldName")} *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ZarinPal" required />
          </div>
          <div className="space-y-1.5">
            <Label>{t("gw.fieldProvider")}</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" sideOffset={4} className="max-h-60 overflow-y-auto">
                {PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("gw.fieldDomain")} *</Label>
            <Input value={baseDomain} onChange={(e) => setBaseDomain(e.target.value)} placeholder="zarinpal.com" required />
          </div>
          <div className="space-y-1.5">
            <Label>{t("gw.fieldPaymentPage")}</Label>
            <Input value={paymentPageUrl} onChange={(e) => setPaymentPageUrl(e.target.value)} placeholder="https://zarinpal.com/pg/StartPay" />
          </div>
          <div className="space-y-1.5">
            <Label>{t("gw.fieldNotes")}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("gw.cancel")}</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("gw.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Bulk import dialog ─────────────────────────────────────────────────────────

function BulkImportDialog({ onCreated }: { onCreated: () => void }) {
  const { t } = useT();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [domains, setDomains] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!domains.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/gateways/bulk", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      toast({ title: t("gw.bulkSuccess").replace("{n}", String(data.created)) });
      setOpen(false);
      setDomains("");
      onCreated();
    } catch {
      toast({ title: t("gw.bulkFailed"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Upload className="h-4 w-4" />
          {t("gw.bulkImport")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("gw.bulkImport")}</DialogTitle>
          <DialogDescription>{t("gw.bulkImportDesc")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>{t("gw.bulkDomains")}</Label>
            <Textarea
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              rows={8}
              placeholder={"zarinpal.com\ngateway.zibal.ir\nsep.shaparak.ir\nidpay.ir"}
            />
            <p className="text-xs text-muted-foreground">{t("gw.bulkHint")}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("gw.cancel")}</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("gw.import")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Link site dialog ──────────────────────────────────────────────────────────

function LinkSiteDialog({
  gateway,
  linkedSites,
  onLinked,
}: {
  gateway: GatewayDetail;
  linkedSites: { id: number; name: string; url: string }[];
  onLinked: () => void;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [siteSearch, setSiteSearch] = useState("");

  const { data: sites } = useQuery({
    queryKey: ["sites"],
    queryFn: fetchSites,
  });

  const linkedIds = new Set(linkedSites.map((s) => s.id));
  const availableSites = (sites ?? []).filter((s) => !linkedIds.has(s.id));
  const filteredAvailable = availableSites.filter(
    (s) => !siteSearch || s.name.toLowerCase().includes(siteSearch.toLowerCase()) || s.host.toLowerCase().includes(siteSearch.toLowerCase()),
  );

  function toggleSite(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleLink() {
    if (selectedIds.size === 0) return;
    setSaving(true);
    let failed = 0;
    try {
      await Promise.all(
        Array.from(selectedIds).map(async (id) => {
          const res = await fetch(`/api/gateways/${gateway.id}/sites`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ siteId: id }),
          });
          if (!res.ok) failed++;
        }),
      );
      if (failed > 0) {
        toast({ title: t("gw.linkFailed"), variant: "destructive" });
      } else {
        toast({ title: t("gw.linkMultipleSuccess").replace("{n}", String(selectedIds.size)) });
      }
      setSelectedIds(new Set());
      setSiteSearch("");
      setOpen(false);
      onLinked();
    } catch {
      toast({ title: t("gw.linkFailed"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleUnlink(site: { id: number; name: string }) {
    try {
      await fetch(`/api/gateways/${gateway.id}/sites/${site.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      toast({ title: t("gw.unlinkSuccess") });
      onLinked();
    } catch {
      toast({ title: t("gw.unlinkFailed"), variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setSelectedIds(new Set()); setSiteSearch(""); } }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Link2 className="h-4 w-4" />
          {t("gw.linkSites")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("gw.linkSites")}</DialogTitle>
          <DialogDescription>{t("gw.linkSitesDesc").replace("{gw}", gateway.name)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {/* Linked sites list */}
          {linkedSites.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("gw.linkedSites")}</Label>
              <div className="space-y-1">
                {linkedSites.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <span className="text-sm truncate">{s.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => handleUnlink(s)}
                    >
                      <Link2Off className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add link — multi-select */}
          {availableSites.length > 0 ? (
            <div className="space-y-1.5">
              <Label>{t("gw.addLink")}</Label>
              <Input
                placeholder={t("gw.searchPlaceholder")}
                value={siteSearch}
                onChange={(e) => setSiteSearch(e.target.value)}
                className="h-8 text-sm"
              />
              <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
                {filteredAvailable.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded accent-primary"
                      checked={selectedIds.has(s.id)}
                      onChange={() => toggleSite(s.id)}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{s.name}</div>
                      <div className="text-xs text-muted-foreground truncate" dir="ltr">{s.host}</div>
                    </div>
                  </label>
                ))}
                {filteredAvailable.length === 0 && (
                  <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                    {t("gw.noSitesAvailable")}
                  </div>
                )}
              </div>
            </div>
          ) : linkedSites.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("gw.noSitesAvailable")}</p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>{t("gw.close")}</Button>
          {availableSites.length > 0 && (
            <Button onClick={handleLink} disabled={selectedIds.size === 0 || saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Link2 className="h-4 w-4 mr-2" />}
              {t("gw.addLink")} {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Gateway detail panel ──────────────────────────────────────────────────────

function GatewayDetailPanel({
  gatewayId,
  onClose,
}: {
  gatewayId: number;
  onClose: () => void;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [curlRunning, setCurlRunning] = useState(false);
  const [curlResult, setCurlResult] = useState<GatewayCurlResult | null>(null);

  const { data: gw, isLoading } = useQuery({
    queryKey: ["gateway-detail", gatewayId],
    queryFn: () => fetchGatewayDetail(gatewayId),
    refetchInterval: 30_000,
  });

  const { data: checks } = useQuery({
    queryKey: ["gateway-checks", gatewayId],
    queryFn: () => fetchGatewayChecks(gatewayId),
    refetchInterval: 30_000,
  });

  async function handleCheck() {
    setChecking(true);
    try {
      const res = await fetch(`/api/gateways/${gatewayId}/check`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      toast({ title: t("gw.checkSuccess") });
      await qc.invalidateQueries({ queryKey: ["gateways"] });
      await qc.invalidateQueries({ queryKey: ["gateway-detail", gatewayId] });
      await qc.invalidateQueries({ queryKey: ["gateway-checks", gatewayId] });
    } catch {
      toast({ title: t("gw.checkFailed"), variant: "destructive" });
    } finally {
      setChecking(false);
    }
  }

  async function handleCurlCheck() {
    setCurlRunning(true);
    try {
      const res = await fetch(`/api/gateways/${gatewayId}/curl-check`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      const data: GatewayCurlResult = await res.json();
      setCurlResult(data);
    } catch {
      toast({ title: t("gw.curl.failed"), variant: "destructive" });
    } finally {
      setCurlRunning(false);
    }
  }

  async function handleDelete() {
    try {
      await fetch(`/api/gateways/${gatewayId}`, {
        method: "DELETE",
        credentials: "include",
      });
      toast({ title: t("gw.deleteSuccess") });
      await qc.invalidateQueries({ queryKey: ["gateways"] });
      onClose();
    } catch {
      toast({ title: t("gw.deleteFailed"), variant: "destructive" });
    }
  }

  if (isLoading || !gw) {
    return (
      <Card className="h-full">
        <CardContent className="pt-6 space-y-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  const lc = gw.latestCheck;
  const historyChartData = (checks ?? [])
    .slice(0, 20)
    .reverse()
    .map((c) => ({
      time: format(new Date(c.checkedAt), "HH:mm"),
      latency: c.httpResponseTimeMs ? Math.round(c.httpResponseTimeMs) : null,
      status: c.overallStatus,
    }));

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-3 border-b">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusIcon status={gw.status} size="h-5 w-5" />
              <CardTitle className="text-base">{gw.name}</CardTitle>
              <StatusBadge status={gw.status} />
            </div>
            <CardDescription className="mt-1 font-mono text-xs">{gw.baseDomain}</CardDescription>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
            <XCircle className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={handleCheck} disabled={checking}>
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {t("gw.runCheck")}
          </Button>
          <LinkSiteDialog
            gateway={gw}
            linkedSites={gw.linkedSites ?? []}
            onLinked={() => {
              qc.invalidateQueries({ queryKey: ["gateway-detail", gatewayId] });
              qc.invalidateQueries({ queryKey: ["gateways"] });
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 h-8 text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("gw.delete")}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto pt-4 space-y-5">
        {/* Provider + links */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t("gw.fieldProvider")}</p>
            <Badge variant="secondary">{gw.provider}</Badge>
          </div>
          {gw.paymentPageUrl && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t("gw.fieldPaymentPage")}</p>
              <a href={gw.paymentPageUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
                <ExternalLink className="h-3 w-3" /> {t("gw.openPage")}
              </a>
            </div>
          )}
        </div>

        {/* Latest check snapshot */}
        {lc && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">{t("gw.latestCheck")}</p>
            <div className="rounded-lg border divide-y text-sm">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-muted-foreground">DNS</span>
                <div className="flex items-center gap-2">
                  <span className={lc.dnsStatus === "ok" ? "text-green-500" : "text-red-500"}>
                    {lc.dnsStatus?.toUpperCase() ?? "—"}
                  </span>
                  {lc.dnsResolveMs && <span className="font-mono text-xs text-muted-foreground">{latencyLabel(lc.dnsResolveMs)}</span>}
                </div>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-muted-foreground">SSL</span>
                <div className="flex items-center gap-2">
                  <span className={lc.sslStatus === "valid" ? "text-green-500" : lc.sslStatus === "expiring_soon" ? "text-yellow-500" : "text-red-500"}>
                    {lc.sslStatus?.replace(/_/g, " ").toUpperCase() ?? "—"}
                  </span>
                  {lc.sslDaysRemaining != null && (
                    <span className="font-mono text-xs text-muted-foreground">{lc.sslDaysRemaining}d</span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-muted-foreground">HTTP</span>
                <div className="flex items-center gap-2">
                  {lc.httpStatus && <Badge variant="outline" className="font-mono text-xs">{lc.httpStatus}</Badge>}
                  <span className={lc.httpCheckStatus === "ok" ? "text-green-500" : lc.httpCheckStatus === "slow" ? "text-yellow-500" : "text-red-500"}>
                    {lc.httpCheckStatus?.toUpperCase() ?? "—"}
                  </span>
                  {lc.httpResponseTimeMs && <span className="font-mono text-xs text-muted-foreground">{latencyLabel(lc.httpResponseTimeMs)}</span>}
                </div>
              </div>
              {lc.paymentPageCheckStatus && (
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-muted-foreground">{t("gw.paymentPage")}</span>
                  <div className="flex items-center gap-2">
                    <span className={lc.paymentPageCheckStatus === "ok" ? "text-green-500" : "text-red-500"}>
                      {lc.paymentPageCheckStatus.toUpperCase()}
                    </span>
                    {lc.paymentPageResponseTimeMs && <span className="font-mono text-xs text-muted-foreground">{latencyLabel(lc.paymentPageResponseTimeMs)}</span>}
                  </div>
                </div>
              )}
              {lc.resolvedIp && (
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-muted-foreground">IP</span>
                  <span className="font-mono text-xs">{lc.resolvedIp}</span>
                </div>
              )}
              {lc.sslIssuer && (
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-muted-foreground">{t("gw.sslIssuer")}</span>
                  <span className="text-xs truncate max-w-[180px]">{lc.sslIssuer}</span>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {t("gw.checkedAt")} {format(new Date(lc.checkedAt), "yyyy-MM-dd HH:mm")}
            </p>
          </div>
        )}

        {/* Latency history chart */}
        {historyChartData.length > 1 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">{t("gw.latencyHistory")}</p>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={historyChartData} barSize={8}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" unit="ms" />
                <ReTooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                    fontSize: "12px",
                    color: "hsl(var(--popover-foreground))",
                  }}
                  itemStyle={{ color: "hsl(var(--popover-foreground))" }}
                  labelStyle={{ color: "hsl(var(--popover-foreground))" }}
                />
                <Bar dataKey="latency" name="Latency">
                  {historyChartData.map((d, i) => (
                    <Cell key={i} fill={statusBarColor(d.status)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Linked sites */}
        {gw.linkedSites && gw.linkedSites.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">{t("gw.linkedSites")}</p>
            <div className="space-y-1">
              {gw.linkedSites.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">{s.name}</span>
                  <span className="text-xs text-muted-foreground ml-auto font-mono">{s.url}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Check history table */}
        {checks && checks.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs text-muted-foreground w-full justify-start">
                <ChevronRight className="h-3.5 w-3.5" />
                {t("gw.checkHistory")} ({checks.length})
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-1 rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">{t("gw.colTime")}</TableHead>
                      <TableHead className="text-xs">{t("gw.colStatus")}</TableHead>
                      <TableHead className="text-xs">DNS</TableHead>
                      <TableHead className="text-xs">HTTP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {checks.slice(0, 20).map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-xs font-mono whitespace-nowrap">
                          {format(new Date(c.checkedAt), "MM-dd HH:mm")}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={c.overallStatus} />
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          <span className={c.dnsStatus === "ok" ? "text-green-500" : "text-red-500"}>
                            {c.dnsStatus ?? "—"}
                          </span>
                          {c.dnsResolveMs && <span className="text-muted-foreground ml-1">{latencyLabel(c.dnsResolveMs)}</span>}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {c.httpStatus ?? "—"} {c.httpResponseTimeMs ? latencyLabel(c.httpResponseTimeMs) : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Curl Check */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">{t("gw.curl.section")}</p>
              <p className="text-[11px] text-muted-foreground/70 leading-snug mt-0.5">{t("gw.curl.subtitle")}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-7 text-xs shrink-0 ml-2"
              onClick={handleCurlCheck}
              disabled={curlRunning}
            >
              {curlRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
              {curlRunning ? t("gw.curl.running") : t("gw.curl.run")}
            </Button>
          </div>

          {!curlResult && !curlRunning && (
            <p className="text-xs text-muted-foreground/60 italic">{t("gw.curl.notRun")}</p>
          )}

          {curlResult && (
            <div className="rounded-lg overflow-hidden border border-slate-700/60">
              {/* Terminal header bar */}
              <div className="flex items-center justify-between bg-slate-800 px-3 py-1.5 border-b border-slate-700/60">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
                    <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
                    <span className="h-2.5 w-2.5 rounded-full bg-green-500/70" />
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 select-none">curl -L {curlResult.url}</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono">{format(new Date(curlResult.generatedAt), "HH:mm:ss")} · {curlResult.responseTimeMs}ms</span>
              </div>

              {/* Terminal body */}
              <div className="bg-slate-900 px-3 py-2.5 font-mono text-[11px] leading-relaxed overflow-x-auto max-h-[420px] overflow-y-auto space-y-0.5">

                {/* Redirect chain hops */}
                {(curlResult.redirectChain ?? []).map((hop, idx) => (
                  <div key={idx}>
                    <div className="text-cyan-400">{">"} GET {hop.url}</div>
                    <div className={`${hop.status >= 300 ? "text-yellow-400" : "text-green-400"}`}>
                      {"<"} HTTP {hop.status} {hop.status === 301 ? "Moved Permanently" : hop.status === 302 ? "Found" : hop.status === 307 ? "Temporary Redirect" : hop.status === 308 ? "Permanent Redirect" : "Redirect"}
                    </div>
                    {hop.location && (
                      <div className="text-slate-400">{"<"} location: {hop.location}</div>
                    )}
                    <div className="text-slate-600">{"*"} Following redirect...</div>
                  </div>
                ))}

                {/* Final request */}
                {curlResult.statusCode !== null && (
                  <>
                    <div className="text-cyan-400">{">"} GET {curlResult.finalUrl}</div>
                    <div className={curlResult.ok ? "text-green-400" : "text-red-400"}>
                      {"<"} HTTP {curlResult.statusCode} {curlResult.ok ? "OK" : "ERROR"}
                    </div>

                    {/* Response headers — show key ones first, then the rest */}
                    {Object.entries(curlResult.responseHeaders ?? {}).map(([k, v]) => (
                      <div key={k} className="text-slate-400">{"<"} {k}: <span className="text-slate-300">{v}</span></div>
                    ))}

                    <div className="text-slate-600 mt-1">{"*"} {t("gw.curl.termBodyPreview")}</div>
                  </>
                )}

                {/* Body preview */}
                {curlResult.bodyPreview && (
                  <div className="mt-1 border-t border-slate-700/50 pt-1.5 text-slate-300 whitespace-pre-wrap break-all">
                    {curlResult.bodyPreview}
                  </div>
                )}

                {/* Error */}
                {curlResult.errorMessage && (
                  <div className="text-red-400">{"*"} curl: {curlResult.errorMessage}</div>
                )}

                {/* Summary line */}
                <div className={`mt-1.5 border-t border-slate-700/50 pt-1.5 ${curlResult.ok ? "text-green-400" : "text-red-400"}`}>
                  {"*"} {curlResult.ok ? t("gw.curl.termDone") : t("gw.curl.termFailed")} — {curlResult.redirectCount} {t("gw.curl.termRedirects")}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Notes */}
        {gw.notes && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">{t("gw.fieldNotes")}</p>
            <p className="text-sm text-muted-foreground">{gw.notes}</p>
          </div>
        )}
      </CardContent>

      {/* Delete confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("gw.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("gw.deleteConfirmDesc").replace("{gw}", gw.name)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("gw.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("gw.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function GatewaysPage() {
  const { t } = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: gateways = [], isLoading, refetch } = useQuery({
    queryKey: ["gateways"],
    queryFn: fetchGateways,
    refetchInterval: 30_000,
  });

  // Summary stats
  const stats = useMemo(() => {
    const total = gateways.length;
    const up = gateways.filter((g) => g.status === "up").length;
    const degraded = gateways.filter((g) => g.status === "degraded").length;
    const down = gateways.filter((g) => g.status === "down").length;
    const unknown = gateways.filter((g) => g.status === "unknown").length;
    return { total, up, degraded, down, unknown };
  }, [gateways]);

  // Filtered list
  const filtered = useMemo(() => {
    return gateways.filter((g) => {
      const matchSearch =
        !search ||
        g.name.toLowerCase().includes(search.toLowerCase()) ||
        g.baseDomain.toLowerCase().includes(search.toLowerCase()) ||
        g.provider.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === "all" || g.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [gateways, search, statusFilter]);

  async function handleCheckAll() {
    setCheckingAll(true);
    try {
      const res = await fetch("/api/gateways/check-all", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast({ title: t("gw.checkAllStarted").replace("{n}", String(data.queued)) });
      // Refresh after a delay to pick up results
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["gateways"] });
        if (selectedId) qc.invalidateQueries({ queryKey: ["gateway-detail", selectedId] });
      }, 5000);
    } catch {
      toast({ title: t("gw.checkAllFailed"), variant: "destructive" });
    } finally {
      setCheckingAll(false);
    }
  }

  async function handleCheckOne(id: number) {
    setCheckingId(id);
    try {
      const res = await fetch(`/api/gateways/${id}/check`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      toast({ title: t("gw.checkSuccess") });
      await qc.invalidateQueries({ queryKey: ["gateways"] });
      if (selectedId === id) await qc.invalidateQueries({ queryKey: ["gateway-detail", id] });
    } catch {
      toast({ title: t("gw.checkFailed"), variant: "destructive" });
    } finally {
      setCheckingId(null);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteId) return;
    try {
      await fetch(`/api/gateways/${deleteId}`, { method: "DELETE", credentials: "include" });
      toast({ title: t("gw.deleteSuccess") });
      if (selectedId === deleteId) setSelectedId(null);
      await qc.invalidateQueries({ queryKey: ["gateways"] });
    } catch {
      toast({ title: t("gw.deleteFailed"), variant: "destructive" });
    } finally {
      setDeleteId(null);
    }
  }

  const statusChartData = [
    { name: t("gw.status.up"), value: stats.up, fill: "hsl(142, 76%, 36%)" },
    { name: t("gw.status.degraded"), value: stats.degraded, fill: "hsl(38, 92%, 50%)" },
    { name: t("gw.status.down"), value: stats.down, fill: "hsl(0, 84%, 60%)" },
    { name: t("gw.status.unknown"), value: stats.unknown, fill: "hsl(var(--muted-foreground))" },
  ].filter((d) => d.value > 0);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main content */}
      <div className={`flex-1 overflow-y-auto p-4 md:p-6 space-y-5 ${selectedId ? "hidden md:block" : ""}`}>
        {/* Page header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-bold tracking-tight">{t("gw.title")}</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{t("gw.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={handleCheckAll}
              disabled={checkingAll || gateways.length === 0}
            >
              {checkingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {t("gw.checkAll")}
            </Button>
            <BulkImportDialog onCreated={() => refetch()} />
            <AddGatewayDialog onCreated={() => refetch()} />
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard
            icon={<CreditCard className="h-5 w-5" />}
            title={t("gw.totalGateways")}
            value={String(stats.total)}
          />
          <SummaryCard
            icon={<CheckCircle2 className="h-5 w-5" />}
            title={t("gw.status.up")}
            value={String(stats.up)}
            variant="good"
          />
          <SummaryCard
            icon={<AlertTriangle className="h-5 w-5" />}
            title={t("gw.status.degraded")}
            value={String(stats.degraded)}
            variant="warn"
          />
          <SummaryCard
            icon={<XCircle className="h-5 w-5" />}
            title={t("gw.status.down")}
            value={String(stats.down)}
            variant="bad"
          />
        </div>

        {/* Status distribution bar chart (only when there are gateways) */}
        {stats.total > 0 && statusChartData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t("gw.statusDistribution")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={80}>
                <BarChart data={statusChartData} barSize={36}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <ReTooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                      fontSize: "12px",
                      color: "hsl(var(--popover-foreground))",
                    }}
                    itemStyle={{ color: "hsl(var(--popover-foreground))" }}
                    labelStyle={{ color: "hsl(var(--popover-foreground))" }}
                  />
                  <Bar dataKey="value" name={t("gw.gateways")}>
                    {statusChartData.map((d, i) => (
                      <Cell key={i} fill={d.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("gw.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              <SelectItem value="all">{t("gw.filterAll")}</SelectItem>
              <SelectItem value="up">{t("gw.status.up")}</SelectItem>
              <SelectItem value="degraded">{t("gw.status.degraded")}</SelectItem>
              <SelectItem value="down">{t("gw.status.down")}</SelectItem>
              <SelectItem value="unknown">{t("gw.status.unknown")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Gateway grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-3">
                  <Skeleton className="h-5 w-1/2" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
              <CreditCard className="h-10 w-10 text-muted-foreground/50" />
              <div>
                <p className="font-medium text-muted-foreground">{t("gw.emptyTitle")}</p>
                <p className="text-sm text-muted-foreground/70 mt-1">{t("gw.emptyDesc")}</p>
              </div>
              <AddGatewayDialog onCreated={() => refetch()} />
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((gw) => (
              <GatewayCard
                key={gw.id}
                gw={gw}
                checking={checkingId === gw.id}
                onCheck={() => handleCheckOne(gw.id)}
                onDelete={() => setDeleteId(gw.id)}
                onSelect={() => setSelectedId(gw.id === selectedId ? null : gw.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selectedId && (
        <div className={`${selectedId ? "w-full md:w-[400px] lg:w-[460px]" : "hidden"} border-l border-border h-full overflow-hidden flex-shrink-0`}>
          <GatewayDetailPanel
            key={selectedId}
            gatewayId={selectedId}
            onClose={() => setSelectedId(null)}
          />
        </div>
      )}

      {/* Delete confirm dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("gw.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("gw.deleteConfirmDesc").replace("{gw}", gateways.find((g) => g.id === deleteId)?.name ?? "")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("gw.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("gw.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
