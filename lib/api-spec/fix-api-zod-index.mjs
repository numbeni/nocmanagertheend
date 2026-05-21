import fs from "node:fs/promises";
import path from "node:path";

const indexPath = path.resolve(
  new URL(".", import.meta.url).pathname,
  "..",
  "api-zod",
  "src",
  "index.ts",
);

await fs.writeFile(
  indexPath,
  `// AUTO-PATCHED by lib/api-spec/fix-api-zod-index.mjs
// Re-exporting both ./generated/api (zod schema values) and ./generated/types
// (TS types) causes TS2308 duplicate-export errors for shared names like
// CreateSiteBody. We export only the zod schemas; TS types are consumed via
// @workspace/api-client-react in the frontend and via the DB layer in the API.
export * from "./generated/api";
`,
);
console.log("patched lib/api-zod/src/index.ts");
