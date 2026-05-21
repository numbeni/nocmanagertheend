import { db, auditLogsTable } from "@workspace/db";
import { and, desc, eq, gte, lte, ilike, or, sql } from "drizzle-orm";
import type { Request } from "express";

export interface WriteAuditOptions {
  actorId?: number | null;
  actorUsername?: string | null;
  actorRole?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  /** Human-readable entity name (site name, user display name, etc.) stored at log time */
  entityName?: string | null;
  /** If action is related to a monitored site, store its DB id for filtering */
  siteId?: number | null;
  details?: Record<string, unknown> | string | null;
  result?: "success" | "failure";
  req?: Request;
}

export async function writeAudit(opts: WriteAuditOptions): Promise<void> {
  try {
    const detailsStr =
      opts.details == null
        ? null
        : typeof opts.details === "string"
          ? opts.details
          : JSON.stringify(opts.details);

    const ipAddress = opts.req
      ? (opts.req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
        opts.req.socket?.remoteAddress ??
        null
      : null;

    const userAgent = opts.req
      ? (opts.req.headers["user-agent"] ?? null)
      : null;

    await db.insert(auditLogsTable).values({
      actorId: opts.actorId ?? null,
      actorUsername: opts.actorUsername ?? null,
      actorRole: opts.actorRole ?? null,
      action: opts.action,
      resource: opts.resource,
      resourceId: opts.resourceId ?? null,
      entityName: opts.entityName ?? null,
      siteId: opts.siteId ?? null,
      details: detailsStr,
      ipAddress,
      userAgent,
      result: opts.result ?? "success",
    });
  } catch {
    // audit failures must never crash the main flow
  }
}

export function auditFromRequest(
  req: Request,
  overrides: Omit<WriteAuditOptions, "req">,
): Promise<void> {
  return writeAudit({
    actorId: req.user?.id ?? null,
    actorUsername: req.user?.username ?? null,
    actorRole: req.user?.role ?? null,
    req,
    ...overrides,
  });
}

export interface AuditQueryParams {
  page?: number;
  pageSize?: number;
  action?: string;
  resource?: string;
  actorUsername?: string;
  result?: string;
  from?: string;
  to?: string;
  search?: string;
  siteId?: number;
}

export async function queryAuditLogs(params: AuditQueryParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  const conditions = [];

  if (params.action) conditions.push(sql`${auditLogsTable.action} = ${params.action}`);
  if (params.resource) conditions.push(sql`${auditLogsTable.resource} = ${params.resource}`);
  if (params.result) conditions.push(sql`${auditLogsTable.result} = ${params.result}`);
  if (params.actorUsername) {
    conditions.push(ilike(auditLogsTable.actorUsername, `%${params.actorUsername}%`));
  }
  if (params.siteId) {
    conditions.push(eq(auditLogsTable.siteId, params.siteId));
  }
  if (params.from) {
    const d = new Date(params.from);
    if (!isNaN(d.getTime())) conditions.push(gte(auditLogsTable.timestamp, d));
  }
  if (params.to) {
    const d = new Date(params.to);
    if (!isNaN(d.getTime())) conditions.push(lte(auditLogsTable.timestamp, d));
  }
  if (params.search) {
    const term = `%${params.search}%`;
    conditions.push(
      or(
        ilike(auditLogsTable.actorUsername, term),
        ilike(auditLogsTable.action, term),
        ilike(auditLogsTable.resource, term),
        ilike(auditLogsTable.details, term),
        ilike(auditLogsTable.entityName, term),
      ),
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countResult] = await Promise.all([
    db
      .select()
      .from(auditLogsTable)
      .where(where)
      .orderBy(desc(auditLogsTable.timestamp))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(auditLogsTable)
      .where(where),
  ]);

  const total = countResult[0]?.count ?? 0;

  return {
    data: rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp.toISOString(),
      actorId: r.actorId,
      actorUsername: r.actorUsername,
      actorRole: r.actorRole,
      action: r.action,
      resource: r.resource,
      resourceId: r.resourceId,
      entityName: r.entityName,
      siteId: r.siteId,
      details: r.details,
      ipAddress: r.ipAddress,
      result: r.result,
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}
