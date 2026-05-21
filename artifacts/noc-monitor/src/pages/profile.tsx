import { useState } from "react";
import { useAuth, useAuthFetch } from "@/contexts/auth";
import { useT } from "@/i18n/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Lock, Shield, Crown, ShieldCheck, Eye } from "lucide-react";

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const authFetch = useAuthFetch();
  const { t } = useT();
  const { toast } = useToast();

  const [infoForm, setInfoForm] = useState({
    firstName: user?.firstName ?? "",
    lastName: user?.lastName ?? "",
    displayName: user?.displayName ?? "",
    email: user?.email ?? "",
    username: user?.username ?? "",
  });
  const [pwdForm, setPwdForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [savingInfo, setSavingInfo] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);

  if (!user) return null;

  async function handleInfoSave(e: React.FormEvent) {
    e.preventDefault();
    setSavingInfo(true);
    try {
      const res = await authFetch(`/users/${user!.id}`, {
        method: "PUT",
        body: JSON.stringify({
          firstName: infoForm.firstName,
          lastName: infoForm.lastName,
          displayName: infoForm.displayName || null,
          email: infoForm.email,
          username: infoForm.username,
        }),
      });
      if (res.ok) {
        await refreshUser();
        toast({ title: t("profile.savedSuccess") });
      } else {
        const err = await res.json() as { message?: string };
        toast({ title: t("profile.saveFailed"), description: err.message, variant: "destructive" });
      }
    } catch {
      toast({ title: t("profile.saveFailed"), variant: "destructive" });
    } finally {
      setSavingInfo(false);
    }
  }

  async function handlePasswordSave(e: React.FormEvent) {
    e.preventDefault();
    if (pwdForm.newPassword !== pwdForm.confirmPassword) {
      toast({ title: t("profile.passwordMismatch"), variant: "destructive" });
      return;
    }
    setSavingPwd(true);
    try {
      const res = await authFetch("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: pwdForm.currentPassword,
          newPassword: pwdForm.newPassword,
        }),
      });
      if (res.ok) {
        setPwdForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
        toast({ title: t("profile.passwordSuccess") });
      } else {
        const err = await res.json() as { message?: string };
        toast({ title: t("profile.passwordFailed"), description: err.message, variant: "destructive" });
      }
    } catch {
      toast({ title: t("profile.passwordFailed"), variant: "destructive" });
    } finally {
      setSavingPwd(false);
    }
  }

  const roleColors: Record<string, string> = {
    founder: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
    admin: "bg-primary/10 text-primary border-primary/30",
    operator: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
    viewer: "bg-muted text-muted-foreground",
  };

  const roleIcon = (role: string) => {
    if (role === "founder") return <Crown className="h-3 w-3 me-1" />;
    if (role === "admin") return <ShieldCheck className="h-3 w-3 me-1" />;
    if (role === "operator") return <Shield className="h-3 w-3 me-1" />;
    return <Eye className="h-3 w-3 me-1" />;
  };

  const roleLabel = (role: string) => {
    if (role === "founder") return t("auth.role.founder");
    return t(`auth.role.${role}`);
  };

  const initials = (user.displayName || user.firstName).charAt(0).toUpperCase() +
    (user.displayName ? "" : (user.lastName.charAt(0).toUpperCase()));

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("profile.title")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("profile.subtitle")}</p>
      </div>

      <div className="flex items-center gap-3 p-4 rounded-lg border bg-card">
        <div className="h-12 w-12 rounded-full bg-primary flex items-center justify-center flex-shrink-0 text-primary-foreground font-bold text-lg">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold">
            {user.displayName || `${user.firstName} ${user.lastName}`}
          </p>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
        <Badge variant="outline" className={roleColors[user.role] ?? ""}>
          {roleIcon(user.role)}
          {roleLabel(user.role)}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("profile.infoSection")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleInfoSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="p-firstName">{t("auth.firstName")}</Label>
                <Input
                  id="p-firstName"
                  value={infoForm.firstName}
                  onChange={(e) => setInfoForm((f) => ({ ...f, firstName: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-lastName">{t("auth.lastName")}</Label>
                <Input
                  id="p-lastName"
                  value={infoForm.lastName}
                  onChange={(e) => setInfoForm((f) => ({ ...f, lastName: e.target.value }))}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-displayName">{t("auth.displayName")}</Label>
              <Input
                id="p-displayName"
                value={infoForm.displayName}
                onChange={(e) => setInfoForm((f) => ({ ...f, displayName: e.target.value }))}
                placeholder={t("auth.displayNamePlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-email">{t("auth.email")}</Label>
              <Input
                id="p-email"
                type="email"
                value={infoForm.email}
                onChange={(e) => setInfoForm((f) => ({ ...f, email: e.target.value }))}
                required
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-username">{t("auth.username")}</Label>
              <Input
                id="p-username"
                value={infoForm.username}
                onChange={(e) => setInfoForm((f) => ({ ...f, username: e.target.value }))}
                required
                dir="ltr"
              />
            </div>
            <Button type="submit" disabled={savingInfo}>
              {savingInfo ? t("common.loading") : t("common.save")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4" />
            {t("profile.securitySection")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordSave} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="p-currentPwd">{t("profile.currentPassword")}</Label>
              <Input
                id="p-currentPwd"
                type="password"
                value={pwdForm.currentPassword}
                onChange={(e) => setPwdForm((f) => ({ ...f, currentPassword: e.target.value }))}
                required
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-newPwd">{t("profile.newPassword")}</Label>
              <Input
                id="p-newPwd"
                type="password"
                value={pwdForm.newPassword}
                onChange={(e) => setPwdForm((f) => ({ ...f, newPassword: e.target.value }))}
                required
                dir="ltr"
                minLength={8}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-confirmPwd">{t("auth.confirmPassword")}</Label>
              <Input
                id="p-confirmPwd"
                type="password"
                value={pwdForm.confirmPassword}
                onChange={(e) => setPwdForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                required
                dir="ltr"
              />
            </div>
            <Button type="submit" disabled={savingPwd}>
              {savingPwd ? t("common.loading") : t("profile.updatePassword")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
