import { useState } from "react";
import {
  Activity,
  Eye,
  EyeOff,
  ShieldCheck,
  KeyRound,
  CheckCircle2,
  UserCircle,
  AtSign,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { useT } from "@/i18n/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LanguageToggle } from "@/components/language-toggle";
import { motion, AnimatePresence } from "framer-motion";

const STEPS = [
  {
    icon: UserCircle,
    en: "Personal info",
    fa: "اطلاعات شخصی",
  },
  {
    icon: AtSign,
    en: "Account credentials",
    fa: "اطلاعات حساب",
  },
  {
    icon: KeyRound,
    en: "Set password",
    fa: "تعیین رمز عبور",
  },
];

function StepIndicator({
  step,
  current,
  lang,
}: {
  step: number;
  current: number;
  lang: "en" | "fa";
}) {
  const done = step < current;
  const active = step === current;
  const { icon: Icon, en, fa } = STEPS[step];
  return (
    <div className="flex items-center gap-3">
      <div
        className={[
          "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border transition-all duration-300",
          done
            ? "bg-blue-500 border-blue-500 text-white"
            : active
            ? "bg-blue-500/15 border-blue-400 text-blue-400"
            : "bg-transparent border-white/20 text-white/40",
        ].join(" ")}
      >
        {done ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <Icon className="h-3.5 w-3.5" />
        )}
      </div>
      <span
        className={[
          "text-sm font-medium transition-colors duration-200",
          active ? "text-white" : "text-white/50",
        ].join(" ")}
      >
        {lang === "fa" ? fa : en}
      </span>
    </div>
  );
}

export default function SetupPage() {
  const { setup } = useAuth();
  const { t, dir, lang } = useT();
  const fa = lang === "fa";

  const [currentStep, setCurrentStep] = useState(0);
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

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    displayName: "",
    email: "",
    username: "",
    password: "",
    confirmPassword: "",
  });
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleChange(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError(null);
  }

  function validateStep(step: number): string | null {
    if (step === 0) {
      if (!form.firstName.trim()) return fa ? "نام الزامی است" : "First name is required";
      if (!form.lastName.trim()) return fa ? "نام خانوادگی الزامی است" : "Last name is required";
    }
    if (step === 1) {
      if (!form.email.trim()) return fa ? "ایمیل الزامی است" : "Email is required";
      if (!form.username.trim()) return fa ? "نام کاربری الزامی است" : "Username is required";
      if (!/^[a-z0-9_.-]+$/i.test(form.username.trim()))
        return fa ? "نام کاربری فقط شامل حروف، عدد، _ و . باشد" : "Username may only contain letters, numbers, _ and .";
    }
    if (step === 2) {
      if (form.password.length < 8) return t("auth.setup.passwordTooShort");
      if (form.password !== form.confirmPassword) return t("profile.passwordMismatch");
    }
    return null;
  }

  function handleNext() {
    const err = validateStep(currentStep);
    if (err) { setError(err); return; }
    setError(null);
    setCurrentStep((s) => s + 1);
  }

  function handleBack() {
    setError(null);
    setCurrentStep((s) => s - 1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateStep(2);
    if (err) { setError(err); return; }
    setLoading(true);
    const { ok, error: apiErr } = await setup({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      displayName: form.displayName.trim() || undefined,
      email: form.email.trim(),
      username: form.username.trim(),
      password: form.password,
    });
    setLoading(false);
    if (!ok) setError(apiErr ?? t("auth.setup.failed"));
  }

  return (
    <div className="min-h-screen bg-background flex" dir={dir}>
      {/* Left brand panel */}
      <div className="hidden lg:flex lg:w-[38%] xl:w-[36%] flex-shrink-0 flex-col justify-between p-10 bg-gradient-to-br from-[hsl(223,47%,8%)] via-[hsl(220,50%,11%)] to-[hsl(217,55%,14%)] border-r border-white/10 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(hsl(217,91%,60%) 1px, transparent 1px), linear-gradient(90deg, hsl(217,91%,60%) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 w-72 h-72 rounded-full bg-blue-500/5 blur-3xl pointer-events-none" />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-500/20 border border-blue-400/30">
            <Activity className="h-6 w-6 text-blue-400" />
          </div>
          <span className="text-xl font-bold tracking-tight text-white">
            NOC Monitor
          </span>
        </div>

        {/* Center content */}
        <div className="relative z-10 space-y-8">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-400/15 border border-blue-400/25">
              <ShieldCheck className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-xs font-semibold text-blue-400">
                {fa ? "راه‌اندازی اولیه" : "First-Time Setup"}
              </span>
            </div>
            <h2 className="text-2xl font-bold text-white leading-snug">
              {fa ? "خوش آمدید به NOC Monitor" : "Welcome to NOC Monitor"}
            </h2>
            <p className="text-sm text-white/60 leading-relaxed">
              {fa
                ? "یک حساب موسس بسازید تا به پنل مانیتورینگ دسترسی پیدا کنید. این صفحه فقط یک‌بار نمایش داده می‌شود."
                : "Create a founder account to access the monitoring panel. This page only appears once."}
            </p>
          </div>

          {/* Step indicators */}
          <div className="space-y-4">
            {STEPS.map((_, i) => (
              <StepIndicator key={i} step={i} current={currentStep} lang={lang} />
            ))}
          </div>
        </div>

        <p className="relative z-10 text-xs text-white/30">
          {fa
            ? "توسعه یافته توسط Unixee • Behnia Masoumi"
            : "Powered by Unixee • Behnia Masoumi"}
        </p>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 relative">
        <div className="absolute top-5 end-5">
          <LanguageToggle compact />
        </div>

        {/* mobile logo */}
        <div className="lg:hidden flex items-center gap-2 mb-8">
          <div className="p-1.5 rounded-lg bg-primary/15 border border-primary/25">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <span className="text-lg font-bold tracking-tight">NOC Monitor</span>
        </div>

        <div className="w-full max-w-md">
          {/* Mobile step indicators */}
          <div className="lg:hidden flex items-center gap-2 mb-8">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={[
                  "flex-1 h-1 rounded-full transition-all duration-300",
                  i < currentStep
                    ? "bg-primary"
                    : i === currentStep
                    ? "bg-primary/50"
                    : "bg-border",
                ].join(" ")}
              />
            ))}
          </div>

          {/* Heading */}
          <motion.div
            key={`heading-${currentStep}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mb-7 space-y-1"
          >
            <p className="text-xs font-semibold text-primary tracking-widest uppercase">
              {fa ? `مرحله ${currentStep + 1} از ${STEPS.length}` : `Step ${currentStep + 1} of ${STEPS.length}`}
            </p>
            <h1 className="text-2xl font-bold text-foreground">
              {fa ? STEPS[currentStep].fa : STEPS[currentStep].en}
            </h1>
          </motion.div>

          <form onSubmit={handleSubmit}>
            <AnimatePresence mode="wait">
              {/* Step 0 — Personal info */}
              {currentStep === 0 && (
                <motion.div
                  key="step0"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                  className="space-y-5"
                >
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="s-firstName" className="text-sm font-medium">
                        {t("auth.firstName")} <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="s-firstName"
                        value={form.firstName}
                        onChange={(e) => handleChange("firstName", e.target.value)}
                        autoComplete="given-name"
                        autoFocus
                        className="h-10"
                        placeholder={fa ? "نام" : "First name"}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="s-lastName" className="text-sm font-medium">
                        {t("auth.lastName")} <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="s-lastName"
                        value={form.lastName}
                        onChange={(e) => handleChange("lastName", e.target.value)}
                        autoComplete="family-name"
                        className="h-10"
                        placeholder={fa ? "نام خانوادگی" : "Last name"}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="s-displayName" className="text-sm font-medium">
                      {t("auth.displayName")}
                      <span className="ms-1.5 text-xs text-muted-foreground">
                        ({fa ? "اختیاری" : "optional"})
                      </span>
                    </Label>
                    <Input
                      id="s-displayName"
                      value={form.displayName}
                      onChange={(e) => handleChange("displayName", e.target.value)}
                      placeholder={t("auth.displayNamePlaceholder")}
                      autoComplete="nickname"
                      className="h-10"
                    />
                  </div>
                </motion.div>
              )}

              {/* Step 1 — Account credentials */}
              {currentStep === 1 && (
                <motion.div
                  key="step1"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                  className="space-y-5"
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="s-email" className="text-sm font-medium">
                      {t("auth.email")} <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="s-email"
                      type="email"
                      value={form.email}
                      onChange={(e) => handleChange("email", e.target.value)}
                      autoComplete="email"
                      dir="ltr"
                      autoFocus
                      className="h-10"
                      placeholder="admin@company.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="s-username" className="text-sm font-medium">
                      {t("auth.username")} <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="s-username"
                      value={form.username}
                      onChange={(e) => handleChange("username", e.target.value)}
                      autoComplete="username"
                      dir="ltr"
                      className="h-10"
                      placeholder="admin"
                    />
                    <p className="text-xs text-muted-foreground">
                      {fa
                        ? "فقط حروف انگلیسی، عدد، خط زیر (_) و نقطه (.) مجاز است"
                        : "Letters, numbers, _ and . only"}
                    </p>
                  </div>
                </motion.div>
              )}

              {/* Step 2 — Password */}
              {currentStep === 2 && (
                <motion.div
                  key="step2"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                  className="space-y-5"
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="s-password" className="text-sm font-medium">
                      {t("auth.password")} <span className="text-destructive">*</span>
                    </Label>
                    <div className="relative">
                      <Input
                        id="s-password"
                        type={showPwd ? "text" : "password"}
                        value={form.password}
                        onChange={(e) => handleChange("password", e.target.value)}
                        autoComplete="new-password"
                        dir="ltr"
                        autoFocus
                        className="h-10 pr-10"
                        placeholder="••••••••"
                        minLength={8}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwd((v) => !v)}
                        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground transition-colors"
                        tabIndex={-1}
                      >
                        {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">{t("auth.setup.passwordHint")}</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="s-confirmPassword" className="text-sm font-medium">
                      {t("auth.confirmPassword")} <span className="text-destructive">*</span>
                    </Label>
                    <div className="relative">
                      <Input
                        id="s-confirmPassword"
                        type={showConfirmPwd ? "text" : "password"}
                        value={form.confirmPassword}
                        onChange={(e) => handleChange("confirmPassword", e.target.value)}
                        autoComplete="new-password"
                        dir="ltr"
                        className="h-10 pr-10"
                        placeholder="••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPwd((v) => !v)}
                        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground transition-colors"
                        tabIndex={-1}
                      >
                        {showConfirmPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {form.confirmPassword && form.password === form.confirmPassword && (
                      <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex items-center gap-1.5 text-xs text-emerald-400"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {fa ? "رمزها یکسان هستند" : "Passwords match"}
                      </motion.p>
                    )}
                  </div>

                  {/* Summary card */}
                  <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {fa ? "خلاصه حساب" : "Account Summary"}
                    </p>
                    <div className="text-sm space-y-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("auth.firstName")}</span>
                        <span className="font-medium">{form.firstName} {form.lastName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("auth.username")}</span>
                        <span className="font-medium font-mono text-primary">{form.username}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("auth.email")}</span>
                        <span className="font-medium text-xs">{form.email}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("auth.role")}</span>
                        <span className="font-medium text-primary">{t("auth.role.founder")}</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="mt-4 flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5"
                >
                  <span className="mt-0.5 flex-shrink-0">⚠</span>
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Navigation buttons */}
            <div className={["mt-7 flex gap-3", currentStep > 0 ? "justify-between" : "justify-end"].join(" ")}>
              {currentStep > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBack}
                  className="min-w-[100px]"
                >
                  {fa ? "قبلی" : "Back"}
                </Button>
              )}

              {currentStep < 2 ? (
                <Button
                  type="button"
                  onClick={handleNext}
                  className="min-w-[120px] gap-2 font-semibold"
                >
                  {fa ? "بعدی" : "Next"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  className="min-w-[160px] gap-2 font-semibold"
                  disabled={loading}
                >
                  {loading ? (
                    <motion.span
                      animate={{ opacity: [1, 0.5, 1] }}
                      transition={{ duration: 1.2, repeat: Infinity }}
                    >
                      {t("auth.setup.submitting")}
                    </motion.span>
                  ) : (
                    <>
                      <ShieldCheck className="h-4 w-4" />
                      {t("auth.setup.submit")}
                    </>
                  )}
                </Button>
              )}
            </div>
          </form>

          {/* Access Key login — separated from setup form */}
          <div className="mt-8 pt-6 border-t border-border/40">
            <p className="text-xs text-muted-foreground/60 mb-3 text-center">
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
                  "flex-1 h-9 px-3 rounded-md border bg-muted/20 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40 transition-all dir-ltr",
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
                {accessKeyLoading
                  ? (fa ? "..." : "...")
                  : (fa ? "ورود" : "Login")}
              </button>
            </div>
            {accessKeyError && (
              <p className="text-xs text-destructive mt-1.5">
                {fa ? "کلید دسترسی نادرست است" : "Invalid access key"}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
