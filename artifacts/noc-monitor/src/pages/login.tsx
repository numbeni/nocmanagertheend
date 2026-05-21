import { useState } from "react";
import {
  Activity,
  Eye,
  EyeOff,
  Shield,
  Wifi,
  Bell,
  Globe,
  Lock,
  ArrowRight,
  AlertTriangle,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { useT } from "@/i18n/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LanguageToggle } from "@/components/language-toggle";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";

const FEATURES = [
  {
    icon: Wifi,
    en: "Real-time uptime monitoring across all your endpoints",
    fa: "نظارت لحظه‌ای آپتایم روی تمام اندپوینت‌های شما",
  },
  {
    icon: Bell,
    en: "Instant incident detection and alert delivery",
    fa: "تشخیص فوری حوادث و ارسال هشدار",
  },
  {
    icon: Globe,
    en: "Multi-resolver DNS health checks globally",
    fa: "بررسی سلامت DNS با چندین resolver جهانی",
  },
  {
    icon: Lock,
    en: "SSL certificate expiry tracking and TLS diagnostics",
    fa: "پایش انقضای گواهی SSL و تشخیص TLS",
  },
];

interface CriticalSummary {
  openIncidents: number;
  criticalCount: number;
  totalLastHour: number;
  recentIncidents: { id: number; siteName: string; status: string; startedAt: string }[];
}

function LiveDot({ delay = 0 }: { delay?: number }) {
  return (
    <motion.span
      className="inline-block w-2 h-2 rounded-full bg-emerald-400"
      animate={{ opacity: [1, 0.2, 1], scale: [1, 0.7, 1] }}
      transition={{ duration: 2.2, repeat: Infinity, delay, ease: "easeInOut" }}
    />
  );
}

function BrandPanel({ lang }: { lang: "en" | "fa" }) {
  const fa = lang === "fa";
  return (
    <div className="hidden lg:flex flex-col justify-between h-full p-10 bg-gradient-to-br from-[hsl(223,47%,8%)] via-[hsl(220,50%,11%)] to-[hsl(217,55%,14%)] border-r border-white/10 relative overflow-hidden">
      {/* grid lines decoration */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(217,91%,60%) 1px, transparent 1px), linear-gradient(90deg, hsl(217,91%,60%) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      {/* glow */}
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-blue-500/5 blur-3xl pointer-events-none" />

      {/* top — logo */}
      <div className="relative z-10 flex items-center gap-3">
        <div className="p-2 rounded-xl bg-blue-500/20 border border-blue-400/30">
          <Activity className="h-6 w-6 text-blue-400" />
        </div>
        <span className="text-xl font-bold tracking-tight text-white">
          NOC Monitor
        </span>
      </div>

      {/* middle — headline + features */}
      <div className="relative z-10 space-y-8">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <LiveDot delay={0} />
            <LiveDot delay={0.6} />
            <LiveDot delay={1.2} />
            <span className="text-xs font-medium text-emerald-400 tracking-widest uppercase ms-1">
              {fa ? "سیستم فعال است" : "System Active"}
            </span>
          </div>
          <h2 className="text-3xl font-bold leading-snug text-white">
            {fa
              ? "نظارت حرفه‌ای بر زیرساخت"
              : "Professional Infrastructure Monitoring"}
          </h2>
          <p className="text-white/60 text-sm leading-relaxed max-w-xs">
            {fa
              ? "دید کامل، هشدار فوری، و تشخیص حوادث — همه در یک پنل."
              : "Complete visibility, instant alerts, and incident detection — all in one panel."}
          </p>
        </div>

        <ul className="space-y-4">
          {FEATURES.map(({ icon: Icon, en, fa: faText }, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.1, duration: 0.4 }}
              className="flex items-start gap-3"
            >
              <span className="mt-0.5 flex-shrink-0 p-1.5 rounded-lg bg-blue-500/15 border border-blue-400/20">
                <Icon className="h-3.5 w-3.5 text-blue-400" />
              </span>
              <span className="text-sm text-white/60 leading-relaxed">
                {fa ? faText : en}
              </span>
            </motion.li>
          ))}
        </ul>
      </div>

      {/* bottom — footer */}
      <p className="relative z-10 text-xs text-white/30">
        {fa
          ? "توسعه یافته توسط Unixee • Behnia Masoumi"
          : "Powered by Unixee • Behnia Masoumi"}
      </p>
    </div>
  );
}

function CriticalSummaryPopup({
  summary,
  onDismiss,
  t,
  lang,
}: {
  summary: CriticalSummary;
  onDismiss: () => void;
  t: (key: string) => string;
  lang: "en" | "fa";
}) {
  const [, navigate] = useLocation();
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 10 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
    >
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
            <div>
              <h2 className="text-base font-bold">{t("critical.title")}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{t("critical.subtitle")}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={onDismiss}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {summary.openIncidents > 0 && (
            <Badge variant="destructive" className="text-xs">
              {t("critical.openIncidents").replace("{count}", String(summary.openIncidents))}
            </Badge>
          )}
          {summary.criticalCount > 0 && (
            <Badge variant="outline" className="text-xs border-destructive/40 text-destructive">
              {t("critical.criticalCount").replace("{count}", String(summary.criticalCount))}
            </Badge>
          )}
          {summary.totalLastHour > 0 && (
            <Badge variant="secondary" className="text-xs">
              {t("critical.total").replace("{count}", String(summary.totalLastHour))}
            </Badge>
          )}
        </div>

        {summary.recentIncidents.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-2">{t("critical.empty")}</p>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {summary.recentIncidents.map((inc) => (
              <div key={inc.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-destructive/5 border border-destructive/20">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{inc.siteName}</div>
                  <div className="text-xs text-muted-foreground">{inc.status}</div>
                </div>
                <span className="text-[10px] text-muted-foreground flex-shrink-0 font-mono" dir="ltr">
                  {new Date(inc.startedAt).toLocaleTimeString(lang === "fa" ? "fa-IR" : "en-US", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          {summary.openIncidents > 0 && (
            <Button
              size="sm"
              variant="destructive"
              className="gap-1.5"
              onClick={() => { onDismiss(); navigate("/incidents?status=open"); }}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {t("critical.viewIncidents")}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onDismiss}>
            {t("critical.dismiss")}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

export default function LoginPage() {
  const { login } = useAuth();
  const { t, dir, lang } = useT();
  const [, navigate] = useLocation();
  const fa = lang === "fa";

  const [form, setForm] = useState({ username: "", password: "" });
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [criticalSummary, setCriticalSummary] = useState<CriticalSummary | null>(null);

  const [accessKey, setAccessKey] = useState("");
  const [accessKeyLoading, setAccessKeyLoading] = useState(false);
  const [accessKeyError, setAccessKeyError] = useState(false);

  async function handleAccessKeyLogin() {
    if (!accessKey.trim()) return;
    setAccessKeyLoading(true);
    setAccessKeyError(false);
    try {
      const res = await fetch("/api/auth/secret-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ key: accessKey.trim() }),
      });
      if (res.ok) {
        window.location.reload();
      } else {
        setAccessKeyError(true);
        setAccessKey("");
      }
    } catch {
      setAccessKeyError(true);
    } finally {
      setAccessKeyLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { ok, error: err } = await login(form.username.trim(), form.password);
    setLoading(false);
    if (!ok) {
      setError(err ?? t("auth.loginError"));
      return;
    }
    // Fetch critical summary after login
    try {
      const res = await fetch("/api/auth/critical-summary", { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as CriticalSummary;
        if (data.totalLastHour > 0 || data.openIncidents > 0) {
          setCriticalSummary(data);
          return;
        }
      }
    } catch {}
    navigate("/");
  }

  function handleChange(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError(null);
  }

  return (
    <>
      <AnimatePresence>
        {criticalSummary && (
          <CriticalSummaryPopup
            summary={criticalSummary}
            onDismiss={() => { setCriticalSummary(null); navigate("/"); }}
            t={t}
            lang={lang}
          />
        )}
      </AnimatePresence>

      <div className="min-h-screen bg-background flex" dir={dir}>
        {/* Left brand panel */}
        <div className="lg:w-[45%] xl:w-[42%] flex-shrink-0">
          <BrandPanel lang={lang} />
        </div>

        {/* Right form panel */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 relative">
          {/* top-right: language toggle */}
          <div className="absolute top-5 end-5">
            <LanguageToggle compact />
          </div>

          {/* mobile logo (shown when brand panel is hidden) */}
          <div className="lg:hidden flex items-center gap-2 mb-10">
            <div className="p-1.5 rounded-lg bg-primary/15 border border-primary/25">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <span className="text-lg font-bold tracking-tight">NOC Monitor</span>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="w-full max-w-sm space-y-7"
          >
            {/* heading */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold text-primary tracking-widest uppercase">
                  {lang === "fa" ? "ورود امن" : "Secure Login"}
                </span>
              </div>
              <h1 className="text-2xl font-bold text-foreground">
                {t("auth.login.title")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("auth.login.subtitle")}
              </p>
            </div>

            {/* form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="l-username" className="text-sm font-medium">
                  {t("auth.usernameOrEmail")}
                </Label>
                <Input
                  id="l-username"
                  value={form.username}
                  onChange={(e) => handleChange("username", e.target.value)}
                  required
                  autoComplete="username email"
                  dir="ltr"
                  autoFocus
                  className="h-10"
                  placeholder={lang === "fa" ? "نام کاربری یا ایمیل" : "username or email"}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="l-password" className="text-sm font-medium">
                  {t("auth.password")}
                </Label>
                <div className="relative">
                  <Input
                    id="l-password"
                    type={showPwd ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => handleChange("password", e.target.value)}
                    required
                    autoComplete="current-password"
                    dir="ltr"
                    className="h-10 pr-10"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showPwd ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5"
                  >
                    <span className="mt-0.5 flex-shrink-0">⚠</span>
                    <span>{error}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              <Button
                type="submit"
                className="w-full h-10 gap-2 font-semibold"
                disabled={loading}
              >
                {loading ? (
                  <motion.span
                    animate={{ opacity: [1, 0.5, 1] }}
                    transition={{ duration: 1.2, repeat: Infinity }}
                  >
                    {t("auth.login.submitting")}
                  </motion.span>
                ) : (
                  <>
                    {t("auth.login.submit")}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>

            {/* Access Key section */}
            <div className="pt-5 border-t border-border/40 space-y-2.5">
              <p className="text-xs text-muted-foreground/60 text-center">
                {fa ? "یا با کلید دسترسی وارد شوید" : "Or login with access key"}
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={accessKey}
                  onChange={(e) => { setAccessKey(e.target.value); setAccessKeyError(false); }}
                  onKeyDown={(e) => e.key === "Enter" && handleAccessKeyLogin()}
                  placeholder={fa ? "کلید دسترسی" : "Access key"}
                  disabled={accessKeyLoading}
                  className={[
                    "flex-1 h-9 px-3 rounded-md border bg-muted/20 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40 transition-all",
                    accessKeyError ? "border-destructive/60 bg-destructive/5" : "border-border/50",
                  ].join(" ")}
                  dir="ltr"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={handleAccessKeyLogin}
                  disabled={accessKeyLoading || !accessKey.trim()}
                  className="h-9 px-3 rounded-md bg-primary/10 border border-primary/30 text-primary text-xs font-medium hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all whitespace-nowrap"
                >
                  {accessKeyLoading ? "..." : (fa ? "ورود" : "Login")}
                </button>
              </div>
              {accessKeyError && (
                <p className="text-xs text-destructive">
                  {fa ? "کلید دسترسی نادرست است" : "Invalid access key"}
                </p>
              )}
            </div>

            <p className="text-center text-xs text-muted-foreground/50">
              NOC Monitor — {lang === "fa" ? "سیستم نظارت زیرساخت" : "Infrastructure Surveillance System"}
            </p>
          </motion.div>
        </div>
      </div>
    </>
  );
}
