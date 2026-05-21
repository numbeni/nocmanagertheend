import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  doublePrecision,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const serversTable = pgTable("servers", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").notNull().default("#3b82f6"),
  displayOrder: integer("display_order").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Server = typeof serversTable.$inferSelect;
export type InsertServer = typeof serversTable.$inferInsert;

export const sitesTable = pgTable("sites", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull().unique(),
  host: text("host").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  region: text("region"), // optional ISO code e.g. "ir" — kept as metadata only, never used for blocked detection
  // Persisted recovery flag: true once any check has come back successful.
  // Drives the "Never been Up → Down" vs "Was Up → Not Stable" status logic.
  hasEverBeenUp: boolean("has_ever_been_up").notNull().default(false),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  // Optional product-page checker (only relevant for shop/e-commerce sites).
  productCheckEnabled: boolean("product_check_enabled")
    .notNull()
    .default(false),
  // Latest product-check result snapshot (JSON-serialized).
  productCheckResult: text("product_check_result"),
  productCheckRanAt: timestamp("product_check_ran_at", { withTimezone: true }),
  // Latest curl-style diagnostic snapshot (JSON-serialized). Diagnostic only —
  // never used for status derivation.
  latestCurlDiagnostic: text("latest_curl_diagnostic"),
  latestCurlDiagnosticAt: timestamp("latest_curl_diagnostic_at", {
    withTimezone: true,
  }),
  // Per-site monitoring pause (separate from global monitoring pause)
  monitoringPaused: boolean("monitoring_paused").notNull().default(false),
  monitoringPausedAt: timestamp("monitoring_paused_at", { withTimezone: true }),
  monitoringPausedBy: text("monitoring_paused_by"),
  // "Currently Fine" — operator-acknowledged temporary ignore mode.
  // Site is excluded from sweeps, Critical banner, and alert processing.
  // Distinct from monitoringPaused: visually teal, no status alerts.
  currentlyFine: boolean("currently_fine").notNull().default(false),
  currentlyFineAt: timestamp("currently_fine_at", { withTimezone: true }),
  currentlyFineBy: text("currently_fine_by"),
  currentlyFineUntil: timestamp("currently_fine_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  serverId: integer("server_id").references(() => serversTable.id, {
    onDelete: "set null",
  }),
});

// Persisted Telegram alert history — kept for backward-compat / existing data.
// New alerts go to importantAlertsTable below.
export const telegramAlertsTable = pgTable(
  "telegram_alerts",
  {
    id: serial("id").primaryKey(),
    siteId: integer("site_id")
      .notNull()
      .references(() => sitesTable.id, { onDelete: "cascade" }),
    alertType: text("alert_type").notNull(),
    fingerprint: text("fingerprint").notNull(),
    severity: text("severity").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    success: boolean("success").notNull().default(true),
    errorMessage: text("error_message"),
  },
  (t) => ({
    siteTypeIdx: index("telegram_alerts_site_type_idx").on(
      t.siteId,
      t.alertType,
    ),
    sentAtIdx: index("telegram_alerts_sent_at_idx").on(t.sentAt),
  }),
);

// Persisted important-alert history (Nextcloud Talk / internal channel).
// Used for deduplication, cooldown, and audit.
// Fingerprint is `siteId:alertType:rootCause:severity`.
export const importantAlertsTable = pgTable(
  "important_alerts",
  {
    id: serial("id").primaryKey(),
    siteId: integer("site_id")
      .notNull()
      .references(() => sitesTable.id, { onDelete: "cascade" }),
    alertType: text("alert_type").notNull(), // site_down | site_recovered | ssl_expiring | dns_failure | http_5xx | tcp_unreachable | incident_critical | incident_resolved | test
    fingerprint: text("fingerprint").notNull(),
    severity: text("severity").notNull(), // info | warning | critical
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    success: boolean("success").notNull().default(true),
    errorMessage: text("error_message"),
  },
  (t) => ({
    siteTypeIdx: index("important_alerts_site_type_idx").on(
      t.siteId,
      t.alertType,
    ),
    sentAtIdx: index("important_alerts_sent_at_idx").on(t.sentAt),
  }),
);

export type ImportantAlert = typeof importantAlertsTable.$inferSelect;
export type InsertImportantAlert = typeof importantAlertsTable.$inferInsert;

export const checksTable = pgTable(
  "checks",
  {
    id: serial("id").primaryKey(),
    siteId: integer("site_id")
      .notNull()
      .references(() => sitesTable.id, { onDelete: "cascade" }),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
    overallStatus: text("overall_status").notNull(), // up | slow | down | degraded | unknown
    httpStatus: integer("http_status"),
    responseTimeMs: doublePrecision("response_time_ms"),
    dnsStatus: text("dns_status"),
    dnsResolveMs: doublePrecision("dns_resolve_ms"),
    tcp80Open: boolean("tcp_80_open"),
    tcp443Open: boolean("tcp_443_open"),
    sslStatus: text("ssl_status"),
    sslDaysRemaining: integer("ssl_days_remaining"),
    sslIssuer: text("ssl_issuer"),
    errorType: text("error_type"),
    errorMessage: text("error_message"),
    // Evidence-based "blocked" detection
    blockedReason: text("blocked_reason"),
    // DNS data captured during the regular check (no separate global check needed)
    resolvedIp: text("resolved_ip"),
    resolverUsed: text("resolver_used"),
  },
  (t) => ({
    siteTimeIdx: index("checks_site_time_idx").on(t.siteId, t.timestamp),
    timeIdx: index("checks_time_idx").on(t.timestamp),
  }),
);

export const incidentsTable = pgTable(
  "incidents",
  {
    id: serial("id").primaryKey(),
    siteId: integer("site_id")
      .notNull()
      .references(() => sitesTable.id, { onDelete: "cascade" }),
    incidentType: text("incident_type").notNull(),
    severity: text("severity").notNull(), // info | warning | critical
    status: text("status").notNull().default("open"), // open | acknowledged | resolved
    title: text("title").notNull(),
    description: text("description"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    // Updated whenever the incident row mutates (severity bump, ack, resolve…).
    // Drives the operator-controlled sort on the Incidents page.
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    failureCount: integer("failure_count").notNull().default(0),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    // Resolution provenance — captured for both auto and manual resolves.
    resolvedReason: text("resolved_reason"),
    resolvedBy: text("resolved_by"), // "system" | "operator"
    resolvedFromCheckId: integer("resolved_from_check_id"), // check that triggered auto-resolve
  },
  (t) => ({
    siteStatusIdx: index("incidents_site_status_idx").on(t.siteId, t.status),
    statusIdx: index("incidents_status_idx").on(t.status),
  }),
);

// Singleton-style key/value settings table. Rows override env-based defaults.
// Currently used for: nextcloudAlertsEnabled, alertLanguage, monitorIntervalMs.
export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const eventLogsTable = pgTable(
  "event_logs",
  {
    id: serial("id").primaryKey(),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
    level: text("level").notNull(), // debug | info | warn | error
    category: text("category").notNull(), // system | monitor | incident | api | dns
    siteId: integer("site_id").references(() => sitesTable.id, {
      onDelete: "set null",
    }),
    message: text("message").notNull(),
    details: text("details"),
  },
  (t) => ({
    timeIdx: index("event_logs_time_idx").on(t.timestamp),
    levelIdx: index("event_logs_level_idx").on(t.level),
    categoryIdx: index("event_logs_category_idx").on(t.category),
  }),
);

export const incidentNotesTable = pgTable(
  "incident_notes",
  {
    id: serial("id").primaryKey(),
    incidentId: integer("incident_id")
      .notNull()
      .references(() => incidentsTable.id, { onDelete: "cascade" }),
    note: text("note").notNull(),
    author: text("author").notNull().default("Operator"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    incidentIdx: index("incident_notes_incident_idx").on(t.incidentId),
  }),
);

export const dnsResolversTable = pgTable("dns_resolvers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const dnsResolverTestsTable = pgTable(
  "dns_resolver_tests",
  {
    id: serial("id").primaryKey(),
    resolverName: text("resolver_name").notNull(),
    resolverAddress: text("resolver_address").notNull(),
    domain: text("domain").notNull(),
    siteId: integer("site_id").references(() => sitesTable.id, {
      onDelete: "set null",
    }),
    success: boolean("success").notNull(),
    latencyMs: integer("latency_ms"),
    resolvedIp: text("resolved_ip"),
    errorMessage: text("error_message"),
    source: text("source").notNull().default("auto"), // 'auto' | 'manual'
    testedAt: timestamp("tested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    resolverIdx: index("dns_resolver_tests_resolver_idx").on(t.resolverAddress),
    testedAtIdx: index("dns_resolver_tests_tested_at_idx").on(t.testedAt),
    siteIdx: index("dns_resolver_tests_site_idx").on(t.siteId),
  }),
);

export type Site = typeof sitesTable.$inferSelect;
export type InsertSite = typeof sitesTable.$inferInsert;
export type Check = typeof checksTable.$inferSelect;
export type InsertCheck = typeof checksTable.$inferInsert;
export type Incident = typeof incidentsTable.$inferSelect;
export type InsertIncident = typeof incidentsTable.$inferInsert;
export type EventLog = typeof eventLogsTable.$inferSelect;
export type InsertEventLog = typeof eventLogsTable.$inferInsert;
export type DnsResolver = typeof dnsResolversTable.$inferSelect;
export type InsertDnsResolver = typeof dnsResolversTable.$inferInsert;
export type DnsResolverTest = typeof dnsResolverTestsTable.$inferSelect;
export type InsertDnsResolverTest = typeof dnsResolverTestsTable.$inferInsert;
export type IncidentNote = typeof incidentNotesTable.$inferSelect;
export type InsertIncidentNote = typeof incidentNotesTable.$inferInsert;
export type TelegramAlert = typeof telegramAlertsTable.$inferSelect;
export type InsertTelegramAlert = typeof telegramAlertsTable.$inferInsert;

export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
    actorId: integer("actor_id"),
    actorUsername: text("actor_username"),
    actorRole: text("actor_role"),
    action: text("action").notNull(),
    resource: text("resource").notNull(),
    resourceId: text("resource_id"),
    // Human-readable entity name stored at time of logging (survives rename/delete)
    entityName: text("entity_name"),
    // If the action is related to a specific site, store its ID for filtering
    siteId: integer("site_id"),
    details: text("details"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    result: text("result").notNull().default("success"),
  },
  (t) => ({
    timestampIdx: index("audit_logs_timestamp_idx").on(t.timestamp),
    actorIdx: index("audit_logs_actor_idx").on(t.actorId),
    actionIdx: index("audit_logs_action_idx").on(t.action),
    resourceIdx: index("audit_logs_resource_idx").on(t.resource),
    siteIdx: index("audit_logs_site_idx").on(t.siteId),
  }),
);

export type AuditLog = typeof auditLogsTable.$inferSelect;
export type InsertAuditLog = typeof auditLogsTable.$inferInsert;

// ── SSL Targets ───────────────────────────────────────────────────────────────
// Standalone SSL certificate monitoring targets (can exist independently of monitored sites).
export const sslTargetsTable = pgTable(
  "ssl_targets",
  {
    id: serial("id").primaryKey(),
    host: text("host").notNull(),
    port: integer("port").notNull().default(443),
    siteId: integer("site_id").references(() => sitesTable.id, { onDelete: "set null" }),
    notes: text("notes"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastStatus: text("last_status"),
    lastDaysRemaining: integer("last_days_remaining"),
    lastIssuer: text("last_issuer"),
    lastSubject: text("last_subject"),
    lastValidFrom: text("last_valid_from"),
    lastValidTo: text("last_valid_to"),
    lastProtocol: text("last_protocol"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hostIdx: index("ssl_targets_host_idx").on(t.host),
  }),
);

export type SslTarget = typeof sslTargetsTable.$inferSelect;
export type InsertSslTarget = typeof sslTargetsTable.$inferInsert;

export const connectivityTargetsTable = pgTable("connectivity_targets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  host: text("host").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  timeoutMs: integer("timeout_ms").notNull().default(3000),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ConnectivityTarget = typeof connectivityTargetsTable.$inferSelect;
export type InsertConnectivityTarget = typeof connectivityTargetsTable.$inferInsert;
