import type { Request, Response, NextFunction } from "express";
import { validateToken, type AuthUser, type UserRole } from "../services/auth";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function extractToken(req: Request): string | null {
  const cookie = req.cookies?.["noc_token"];
  if (typeof cookie === "string" && cookie.length > 0) return cookie;
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const t = auth.slice(7).trim();
    if (t.length > 0) return t;
  }
  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "unauthorized", message: "Authentication required" });
    return;
  }
  const user = await validateToken(token);
  if (!user) {
    res.status(401).json({ error: "unauthorized", message: "Invalid or expired session" });
    return;
  }
  req.user = user;
  next();
}

const ROLE_RANK: Record<string, number> = {
  founder: 40,
  admin: 30,
  operator: 20,
  viewer: 10,
};

function hasRole(userRole: string, requiredRoles: UserRole[]): boolean {
  if (requiredRoles.includes(userRole as UserRole)) return true;
  const userRank = ROLE_RANK[userRole] ?? 0;
  return requiredRoles.some((r) => userRank >= (ROLE_RANK[r] ?? 0));
}

export function requireRole(...roles: UserRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await requireAuth(req, res, () => {
      if (!req.user) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      if (!hasRole(req.user.role, roles)) {
        res.status(403).json({ error: "forbidden", message: "Insufficient permissions" });
        return;
      }
      next();
    });
  };
}
