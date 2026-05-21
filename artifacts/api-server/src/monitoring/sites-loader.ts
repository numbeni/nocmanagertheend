import fs from "node:fs/promises";
import path from "node:path";
import { db, sitesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { logEvent } from "./logger";
import { deriveHost } from "./engine";

interface SiteEntry {
  name: string;
  url: string;
  region?: string | null;
}

async function readSitesFile(filePath: string): Promise<SiteEntry[]> {
  const raw = await fs.readFile(filePath, "utf8");
  if (filePath.endsWith(".json")) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("sites.json must be an array");
    return parsed
      .filter((e) => e && typeof e.url === "string")
      .map((e) => ({
        name: e.name || e.url,
        url: e.url,
        region: typeof e.region === "string" ? e.region : null,
      }));
  }
  // .txt format — one URL per line
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((url) => ({ name: url, url }));
}

export async function loadSitesFromFile() {
  const candidates = [
    path.resolve(process.cwd(), "sites.json"),
    path.resolve(process.cwd(), "sites.txt"),
    path.resolve(process.cwd(), "artifacts/api-server/sites.json"),
    path.resolve(process.cwd(), "artifacts/api-server/sites.txt"),
  ];
  let chosen: string | null = null;
  for (const c of candidates) {
    try {
      await fs.access(c);
      chosen = c;
      break;
    } catch {
      /* try next */
    }
  }
  if (!chosen) {
    logger.info("No sites file found — skipping seed");
    return;
  }
  let entries: SiteEntry[];
  try {
    entries = await readSitesFile(chosen);
  } catch (err) {
    logger.error({ err, file: chosen }, "Failed to read sites file");
    return;
  }
  logger.info({ file: chosen, count: entries.length }, "Loading sites from file");
  logEvent("info", "system", `Loaded ${entries.length} sites from ${chosen}`);

  let added = 0;
  let updated = 0;
  for (const entry of entries) {
    const host = deriveHost(entry.url);
    const existing = await db
      .select()
      .from(sitesTable)
      .where(eq(sitesTable.url, entry.url))
      .limit(1);
    if (existing.length > 0) {
      // Sync region from file if it changed
      const cur = existing[0]!;
      if ((cur.region ?? null) !== (entry.region ?? null) || cur.name !== entry.name) {
        await db
          .update(sitesTable)
          .set({ region: entry.region ?? null, name: entry.name })
          .where(eq(sitesTable.id, cur.id));
        updated++;
      }
      continue;
    }
    const [row] = await db
      .insert(sitesTable)
      .values({
        name: entry.name,
        url: entry.url,
        host,
        enabled: true,
        region: entry.region ?? null,
      })
      .returning();
    added++;
    if (row) {
      logEvent("info", "system", `Site added from file: ${row.name} (${row.url})`, {
        siteId: row.id,
      });
    }
  }
  if (added > 0 || updated > 0) {
    logEvent(
      "info",
      "system",
      `Sites file synced: ${added} added, ${updated} updated`,
    );
  }
}
