import { useCallback, useEffect, useState } from "react";
import { useAuth, useAuthFetch, type AuthUser } from "@/contexts/auth";
import { useT } from "@/i18n/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Users, Plus, Pencil, Trash2, ShieldCheck, Shield, Eye, Crown, KeyRound } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { faIR } from "date-fns/locale";

type UserRole = "admin" | "operator" | "viewer";

interface UserFormData {
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  username: string;
  password: string;
  role: UserRole;
  status: "active" | "inactive";
}

const emptyForm = (): UserFormData => ({
  firstName: "",
  lastName: "",
  displayName: "",
  email: "",
  username: "",
  password: "",
  role: "operator",
  status: "active",
});

interface ResetPwdState {
  user: AuthUser;
  newPassword: string;
}

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const authFetch = useAuthFetch();
  const { t, dir } = useT();
  const { toast } = useToast();

  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AuthUser | null>(null);
  const [form, setForm] = useState<UserFormData>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AuthUser | null>(null);
  const [resetPwd, setResetPwd] = useState<ResetPwdState | null>(null);
  const [resettingPwd, setResettingPwd] = useState(false);

  const isPrivileged = currentUser?.role === "admin" || currentUser?.role === "founder";

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch("/users");
      if (res.ok) {
        const data = await res.json() as AuthUser[];
        setUsers(data);
      }
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  useEffect(() => {
    const id = setInterval(() => { loadUsers(); }, 10_000);
    return () => clearInterval(id);
  }, [loadUsers]);

  if (!isPrivileged) {
    return (
      <div className="p-6">
        <p className="text-destructive">{t("auth.accessDenied")}</p>
      </div>
    );
  }

  function openCreate() {
    setEditingUser(null);
    setForm(emptyForm());
    setDialogOpen(true);
  }

  function openEdit(u: AuthUser) {
    setEditingUser(u);
    setForm({
      firstName: u.firstName,
      lastName: u.lastName,
      displayName: u.displayName ?? "",
      email: u.email,
      username: u.username,
      password: "",
      role: (u.role === "founder" ? "admin" : u.role) as UserRole,
      status: u.status,
    });
    setDialogOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        firstName: form.firstName,
        lastName: form.lastName,
        displayName: form.displayName || null,
        email: form.email,
        username: form.username,
        role: form.role,
        status: form.status,
      };
      if (form.password) payload.password = form.password;

      const res = editingUser
        ? await authFetch(`/users/${editingUser.id}`, { method: "PUT", body: JSON.stringify(payload) })
        : await authFetch("/users", { method: "POST", body: JSON.stringify({ ...payload, password: form.password }) });

      if (res.ok) {
        toast({ title: t("users.saved") });
        setDialogOpen(false);
        await loadUsers();
      } else {
        const err = await res.json() as { message?: string };
        toast({ title: t("users.saveFailed"), description: err.message, variant: "destructive" });
      }
    } catch {
      toast({ title: t("users.saveFailed"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const res = await authFetch(`/users/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: t("users.deleted") });
        await loadUsers();
      } else {
        const err = await res.json() as { message?: string };
        toast({ title: t("users.deleteFailed"), description: err.message, variant: "destructive" });
      }
    } catch {
      toast({ title: t("users.deleteFailed"), variant: "destructive" });
    } finally {
      setDeleteTarget(null);
    }
  }

  async function handleResetPassword() {
    if (!resetPwd || resetPwd.newPassword.length < 8) {
      toast({ title: t("users.passwordTooShort"), variant: "destructive" });
      return;
    }
    setResettingPwd(true);
    try {
      const res = await authFetch(`/users/${resetPwd.user.id}`, {
        method: "PUT",
        body: JSON.stringify({ password: resetPwd.newPassword }),
      });
      if (res.ok) {
        toast({ title: t("users.passwordReset") });
        setResetPwd(null);
      } else {
        const err = await res.json() as { message?: string };
        toast({ title: t("users.saveFailed"), description: err.message, variant: "destructive" });
      }
    } catch {
      toast({ title: t("users.saveFailed"), variant: "destructive" });
    } finally {
      setResettingPwd(false);
    }
  }

  async function toggleStatus(u: AuthUser) {
    if (u.isFounder) return;
    const newStatus = u.status === "active" ? "inactive" : "active";
    try {
      const res = await authFetch(`/users/${u.id}`, {
        method: "PUT",
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        toast({ title: newStatus === "active" ? t("users.enabled") : t("users.disabled") });
        await loadUsers();
      }
    } catch {}
  }

  const roleIcon = (role: string) => {
    if (role === "founder") return <Crown className="h-3.5 w-3.5" />;
    if (role === "admin") return <ShieldCheck className="h-3.5 w-3.5" />;
    if (role === "operator") return <Shield className="h-3.5 w-3.5" />;
    return <Eye className="h-3.5 w-3.5" />;
  };

  const roleColor = (role: string) => {
    if (role === "founder") return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30";
    if (role === "admin") return "bg-primary/10 text-primary border-primary/30";
    if (role === "operator") return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30";
    return "";
  };

  const roleLabel = (role: string) => {
    if (role === "founder") return t("auth.role.founder");
    return t(`auth.role.${role}`);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            {t("users.title")}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{t("users.subtitle")}</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          {t("users.addUser")}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("users.title")}</CardTitle>
          <CardDescription>
            {loading ? t("common.loading") : `${users.length} ${t("users.userCount")}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("users.col.name")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("users.col.username")}</TableHead>
                <TableHead>{t("users.col.role")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("users.col.status")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("users.col.presence")}</TableHead>
                <TableHead className="hidden xl:table-cell">{t("users.col.lastLogin")}</TableHead>
                <TableHead className="w-32">{t("users.col.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} className={u.status === "inactive" ? "opacity-60" : ""}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                        {(u.displayName || u.firstName).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-sm">
                          {u.displayName || `${u.firstName} ${u.lastName}`}
                        </div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <span className="font-mono text-sm">{u.username}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`gap-1 ${roleColor(u.role)}`}>
                      {roleIcon(u.role)}
                      {roleLabel(u.role)}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge
                      variant={u.status === "active" ? "default" : "secondary"}
                      className="text-xs cursor-pointer"
                      onClick={() => !u.isFounder && toggleStatus(u)}
                      title={u.isFounder ? "" : (u.status === "active" ? t("auth.disableUser") : t("auth.enableUser"))}
                    >
                      {u.status === "active" ? t("auth.status.active") : t("auth.status.disabled")}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`h-2 w-2 rounded-full flex-shrink-0 ${
                          u.presenceStatus === "online" ? "bg-green-500 animate-pulse" :
                          u.presenceStatus === "away" ? "bg-yellow-500" :
                          u.presenceStatus === "busy" ? "bg-red-500" :
                          "bg-gray-400"
                        }`}
                      />
                      <span className="text-xs text-muted-foreground">
                        {u.presenceStatus ? t(`presence.${u.presenceStatus}`) : t("presence.offline")}
                      </span>
                      {u.workStatus && u.workStatus !== "off_shift" && (
                        <span className="text-[10px] text-muted-foreground border border-border rounded px-1">
                          {t(`workStatus.${u.workStatus}`)}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell text-xs text-muted-foreground">
                    {u.lastLoginAt
                      ? formatDistanceToNow(new Date(u.lastLoginAt), { addSuffix: true, locale: dir === "rtl" ? faIR : undefined })
                      : t("common.never")}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => openEdit(u)}
                        disabled={u.isFounder && !currentUser?.isFounder}
                        title={t("users.editUser")}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setResetPwd({ user: u, newPassword: "" })}
                        disabled={u.isFounder && !currentUser?.isFounder}
                        title={t("users.resetPassword")}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                      {currentUser?.id !== u.id && !u.isFounder && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(u)}
                          title={t("common.delete")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {t("auth.noUsers")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create/edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingUser ? t("users.editUser") : t("users.addUser")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="u-firstName">{t("auth.firstName")} *</Label>
                <Input
                  id="u-firstName"
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-lastName">{t("auth.lastName")} *</Label>
                <Input
                  id="u-lastName"
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-displayName">{t("auth.displayName")}</Label>
              <Input
                id="u-displayName"
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-email">{t("auth.email")} *</Label>
              <Input
                id="u-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                required
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-username">{t("auth.username")} *</Label>
              <Input
                id="u-username"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                required
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-pwd">
                {editingUser ? t("users.passwordOptional") : `${t("auth.password")} *`}
              </Label>
              <Input
                id="u-pwd"
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                required={!editingUser}
                minLength={editingUser ? 0 : 8}
                dir="ltr"
                placeholder={editingUser ? t("users.passwordOptionalHint") : ""}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="u-role">{t("auth.role")}</Label>
                <Select
                  value={form.role}
                  onValueChange={(v) => setForm((f) => ({ ...f, role: v as UserRole }))}
                  disabled={editingUser?.isFounder}
                >
                  <SelectTrigger id="u-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">{t("auth.role.admin")}</SelectItem>
                    <SelectItem value="operator">{t("auth.role.operator")}</SelectItem>
                    <SelectItem value="viewer">{t("auth.role.viewer")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-status">{t("users.col.status")}</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm((f) => ({ ...f, status: v as "active" | "inactive" }))}
                  disabled={editingUser?.isFounder}
                >
                  <SelectTrigger id="u-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t("auth.status.active")}</SelectItem>
                    <SelectItem value="inactive">{t("auth.status.disabled")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? t("common.loading") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={!!resetPwd} onOpenChange={(open) => !open && setResetPwd(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("users.resetPassword")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {resetPwd?.user.displayName || `${resetPwd?.user.firstName} ${resetPwd?.user.lastName}`} ({resetPwd?.user.username})
            </p>
            <div className="space-y-1.5">
              <Label>{t("auth.newPassword")}</Label>
              <Input
                type="password"
                value={resetPwd?.newPassword ?? ""}
                onChange={(e) => setResetPwd((s) => s ? { ...s, newPassword: e.target.value } : null)}
                minLength={8}
                dir="ltr"
                placeholder="Min 8 characters"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPwd(null)}>{t("common.cancel")}</Button>
            <Button
              onClick={handleResetPassword}
              disabled={resettingPwd || (resetPwd?.newPassword.length ?? 0) < 8}
            >
              {resettingPwd ? t("common.loading") : t("users.resetPassword")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("users.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.displayName || `${deleteTarget?.firstName} ${deleteTarget?.lastName}`} — {t("users.deleteConfirmDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
