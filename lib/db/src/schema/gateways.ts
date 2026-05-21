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
import { sitesTable } from "./sites";

export const paymentGatewaysTable = pgTable(
  "payment_gateways",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    provider: text("provider").notNull().default("other"),
    baseDomain: text("base_domain").notNull(),
    apiUrl: text("api_url"),
    paymentPageUrl: text("payment_page_url"),
    enabled: boolean("enabled").notNull().default(true),
    // overall derived status: up | degraded | down | unknown
    status: text("status").notNull().default("unknown"),
    tags: text("tags"), // comma-separated
    notes: text("notes"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("pg_domain_idx").on(t.baseDomain),
    index("pg_status_idx").on(t.status),
  ],
);

export type PaymentGateway = typeof paymentGatewaysTable.$inferSelect;
export type InsertPaymentGateway = typeof paymentGatewaysTable.$inferInsert;

export const paymentGatewayChecksTable = pgTable(
  "payment_gateway_checks",
  {
    id: serial("id").primaryKey(),
    gatewayId: integer("gateway_id")
      .notNull()
      .references(() => paymentGatewaysTable.id, { onDelete: "cascade" }),
    // DNS
    dnsStatus: text("dns_status"), // ok | failed | timeout
    dnsResolveMs: doublePrecision("dns_resolve_ms"),
    resolvedIp: text("resolved_ip"),
    // SSL
    sslStatus: text("ssl_status"), // valid | expiring_soon | expired | invalid | unknown
    sslDaysRemaining: integer("ssl_days_remaining"),
    sslIssuer: text("ssl_issuer"),
    // HTTP main domain
    httpStatus: integer("http_status"),
    httpResponseTimeMs: doublePrecision("http_response_time_ms"),
    httpCheckStatus: text("http_check_status"), // ok | slow | down | error
    // Payment page
    paymentPageStatus: integer("payment_page_status"),
    paymentPageResponseTimeMs: doublePrecision("payment_page_response_time_ms"),
    paymentPageCheckStatus: text("payment_page_check_status"), // ok | slow | down | error
    // Overall
    overallStatus: text("overall_status").notNull().default("unknown"), // up | degraded | down | unknown
    errorMessage: text("error_message"),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("pgc_gateway_time_idx").on(t.gatewayId, t.checkedAt),
    index("pgc_time_idx").on(t.checkedAt),
  ],
);

export type PaymentGatewayCheck = typeof paymentGatewayChecksTable.$inferSelect;
export type InsertPaymentGatewayCheck =
  typeof paymentGatewayChecksTable.$inferInsert;

export const siteGatewayLinksTable = pgTable(
  "site_gateway_links",
  {
    id: serial("id").primaryKey(),
    siteId: integer("site_id")
      .notNull()
      .references(() => sitesTable.id, { onDelete: "cascade" }),
    gatewayId: integer("gateway_id")
      .notNull()
      .references(() => paymentGatewaysTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sgl_site_idx").on(t.siteId),
    index("sgl_gateway_idx").on(t.gatewayId),
  ],
);

export type SiteGatewayLink = typeof siteGatewayLinksTable.$inferSelect;
