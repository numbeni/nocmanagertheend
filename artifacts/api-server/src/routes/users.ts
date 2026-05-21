import { Router, type IRouter, type Request, type Response } from "express";
import {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  type UserRole,
} from "../services/auth";
import { requireAuth, requireRole } from "../middlewares/auth";
import { logEvent } from "../monitoring/logger";
import { writeAudit } from "../services/audit";

const router: IRouter = Router();

const VALID_ROLES: UserRole[] = ["admin", "operator", "viewer"];

router.get("/users", requireRole("admin"), async (_req, res) => {
  try {
    const users = await getAllUsers();
    return res.json(users);
  } catch {
    return res.status(500).json({ error: "internal_error" });
  }
});

router.post("/users", requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, displayName, email, username, password, role, status } = req.body as {
      firstName?: string;
      lastName?: string;
      displayName?: string;
      email?: string;
      username?: string;
      password?: string;
      role?: string;
      status?: string;
    };

    if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !username?.trim() || !password) {
      return res.status(400).json({ error: "missing_fields", message: "firstName, lastName, email, username, password are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "weak_password", message: "Password must be at least 8 characters" });
    }

    const finalRole: UserRole = VALID_ROLES.includes(role as UserRole)
      ? (role as UserRole)
      : "operator";

    const user = await createUser({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      displayName: displayName?.trim() || undefined,
      email: email.trim(),
      username: username.trim(),
      password,
      role: finalRole,
      isFounder: false,
      status: status === "inactive" ? "inactive" : "active",
    });

    logEvent("info", "system", `User created: ${user.username} (${finalRole}) by ${req.user?.username}`);
    void writeAudit({
      actorId: req.user?.id, actorUsername: req.user?.username, actorRole: req.user?.role,
      action: "create_user", resource: "user", resourceId: String(user.id),
      details: { username: user.username, role: finalRole }, req,
    });
    return res.status(201).json(user);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return res.status(409).json({ error: "conflict", message: "Email or username already exists" });
    }
    return res.status(500).json({ error: "internal_error" });
  }
});

router.get("/users/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });

    const canViewAll = req.user?.role === "admin" || req.user?.role === "founder";
    if (!canViewAll && req.user?.id !== id) {
      return res.status(403).json({ error: "forbidden" });
    }

    const user = await getUserById(id);
    if (!user) return res.status(404).json({ error: "not_found" });
    return res.json(user);
  } catch {
    return res.status(500).json({ error: "internal_error" });
  }
});

router.put("/users/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });

    const isPrivileged = req.user?.role === "admin" || req.user?.role === "founder";
    const isSelf = req.user?.id === id;

    if (!isPrivileged && !isSelf) {
      return res.status(403).json({ error: "forbidden" });
    }

    const target = await getUserById(id);
    if (!target) return res.status(404).json({ error: "not_found" });

    if (target.isFounder && !req.user?.isFounder) {
      return res.status(403).json({ error: "forbidden", message: "Cannot modify the founder account" });
    }

    const { firstName, lastName, displayName, email, username, password, role, status } = req.body as {
      firstName?: string;
      lastName?: string;
      displayName?: string | null;
      email?: string;
      username?: string;
      password?: string;
      role?: string;
      status?: string;
    };

    const updateData: Parameters<typeof updateUser>[1] = {};
    if (firstName !== undefined) updateData.firstName = firstName.trim();
    if (lastName !== undefined) updateData.lastName = lastName.trim();
    if ("displayName" in req.body) updateData.displayName = displayName?.trim() ?? null;
    if (email !== undefined) updateData.email = email.trim();
    if (username !== undefined) updateData.username = username.trim();
    if (password !== undefined) {
      if (password.length < 8) {
        return res.status(400).json({ error: "weak_password", message: "Password must be at least 8 characters" });
      }
      updateData.password = password;
    }

    if (isPrivileged) {
      if (role !== undefined && VALID_ROLES.includes(role as UserRole)) {
        if (!target.isFounder) {
          updateData.role = role as UserRole;
        }
      }
      if (status !== undefined && !target.isFounder) {
        updateData.status = status === "inactive" ? "inactive" : "active";
      }
    }

    const user = await updateUser(id, updateData);
    if (!user) return res.status(404).json({ error: "not_found" });
    logEvent("info", "system", `User updated: ${user.username} by ${req.user?.username}`);
    void writeAudit({
      actorId: req.user?.id, actorUsername: req.user?.username, actorRole: req.user?.role,
      action: "update_user", resource: "user", resourceId: String(id),
      details: { targetUsername: target.username, changed: Object.keys(updateData).filter(k => k !== "password") }, req,
    });
    return res.json(user);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return res.status(409).json({ error: "conflict", message: "Email or username already exists" });
    }
    return res.status(500).json({ error: "internal_error" });
  }
});

router.delete("/users/:id", requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });

    if (req.user?.id === id) {
      return res.status(400).json({ error: "cannot_delete_self", message: "You cannot delete your own account" });
    }

    const target = await getUserById(id);
    if (!target) return res.status(404).json({ error: "not_found" });

    if (target.isFounder) {
      return res.status(400).json({ error: "cannot_delete_founder", message: "The founder account cannot be deleted" });
    }

    const deleted = await deleteUser(id);
    if (!deleted) return res.status(404).json({ error: "not_found" });

    logEvent("info", "system", `User deleted: ${target.username} by ${req.user?.username}`);
    void writeAudit({
      actorId: req.user?.id, actorUsername: req.user?.username, actorRole: req.user?.role,
      action: "delete_user", resource: "user", resourceId: String(id),
      details: { targetUsername: target.username, targetRole: target.role }, req,
    });
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
