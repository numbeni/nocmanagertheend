// AUTO-PATCHED by lib/api-spec/fix-api-zod-index.mjs
// Re-exporting both ./generated/api (zod schema values) and ./generated/types
// (TS types) causes TS2308 duplicate-export errors for shared names like
// CreateSiteBody. We export only the zod schemas; TS types are consumed via
// @workspace/api-client-react in the frontend and via the DB layer in the API.
export * from "./generated/api";
