import { performance } from "node:perf_hooks";

const HOMEPAGE_TIMEOUT_MS = 12_000;
const URL_PROBE_TIMEOUT_MS = 8_000;
const MAX_SAMPLES = 5;
const MIN_SAMPLES = 3;
const MAX_LINKS_TO_PARSE = 400;

export type ProductCheckStatus =
  | "ok"        // at least one product/category URL responds
  | "warning"   // links found but some failed
  | "failed"    // links found but none worked
  | "unknown"   // no links found anywhere
  | "error"     // homepage unreachable / unexpected error
  | "skipped";  // disabled for this site

export type ProductCheckSource = "homepage" | "sitemap" | "none";

export interface ProductCheckResult {
  /** Was the check actually executed (true) or just disabled (false). */
  enabled: boolean;
  url: string;
  status: ProductCheckStatus;
  productPagesFound: boolean;
  source: ProductCheckSource;
  /** URLs we sampled and probed. */
  checkedUrls: string[];
  /** URLs that returned 200/301/302. */
  workingUrls: string[];
  /** Operator-friendly bilingual message. */
  message: string;
  responseTimeMs: number;
  errorMessage: string | null;
  generatedAt: string;
}

// Patterns are matched as path segments — we want hrefs that contain a
// /product, /category etc. component, not just letters in a query string.
const PRODUCT_PATTERNS = [
  /\/product(s)?(\/|$)/i,
  /\/item(s)?(\/|$)/i,
  /\/shop(\/|$)/i,
  /\/store(\/|$)/i,
  /\/category|\/categories|\/cat\/|\/collection(s)?(\/|$)/i,
  /\/cart(\/|$)/i,
  /\/checkout(\/|$)/i,
  /\/p\/[^/?#]+/i, // shopify-style /p/<slug>
];

const SITEMAP_CANDIDATES = [
  "/product-sitemap.xml",
  "/sitemap_products_1.xml",
  "/sitemap-products.xml",
  "/wp-sitemap-posts-product-1.xml",
  "/sitemap.xml",
];

const HREF_RE = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
const SITEMAP_LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;

function normalize(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // Strip fragments — they confuse de-dup
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function looksProductLike(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  return PRODUCT_PATTERNS.some((re) => re.test(path));
}

function shuffleSample<T>(arr: T[], n: number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, n);
}

interface FetchTextResult {
  ok: boolean;
  status: number | null;
  text: string;
  errorMessage: string | null;
}

async function fetchText(
  url: string,
  timeoutMs: number,
): Promise<FetchTextResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ac.signal,
      headers: { "User-Agent": "NOC-Monitor-ProductCheck/2.0" },
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        text: "",
        errorMessage: `HTTP ${res.status}`,
      };
    }
    const text = await res.text();
    return { ok: true, status: res.status, text, errorMessage: null };
  } catch (err) {
    return {
      ok: false,
      status: null,
      text: "",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeUrl(url: string): Promise<boolean> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), URL_PROBE_TIMEOUT_MS);
  try {
    // Use GET (HEAD is unreliable on many shop hosts) but stop early.
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: ac.signal,
      headers: { "User-Agent": "NOC-Monitor-ProductCheck/2.0" },
    });
    return res.status === 200 || res.status === 301 || res.status === 302;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function extractHomepageLinks(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  let count = 0;
  let m: RegExpExecArray | null;
  HREF_RE.lastIndex = 0;
  while ((m = HREF_RE.exec(html)) !== null) {
    if (++count > MAX_LINKS_TO_PARSE) break;
    const abs = normalize(m[1]!, baseUrl);
    if (abs && looksProductLike(abs)) links.add(abs);
  }
  return Array.from(links);
}

function extractSitemapLinks(xml: string): string[] {
  const links = new Set<string>();
  let m: RegExpExecArray | null;
  SITEMAP_LOC_RE.lastIndex = 0;
  while ((m = SITEMAP_LOC_RE.exec(xml)) !== null) {
    const url = m[1]!.trim();
    if (looksProductLike(url)) links.add(url);
    if (links.size >= 60) break;
  }
  return Array.from(links);
}

async function discoverFromSitemaps(baseOrigin: string): Promise<string[]> {
  for (const path of SITEMAP_CANDIDATES) {
    const url = baseOrigin + path;
    const res = await fetchText(url, HOMEPAGE_TIMEOUT_MS);
    if (!res.ok || !res.text.includes("<")) continue;
    const links = extractSitemapLinks(res.text);
    if (links.length > 0) return links;
  }
  return [];
}

function buildMessage(
  status: ProductCheckStatus,
  source: ProductCheckSource,
  workingCount: number,
  checkedCount: number,
  firstWorking: string | null,
): string {
  switch (status) {
    case "ok":
      return firstWorking
        ? `Product/category page is reachable: ${firstWorking}`
        : `Product/category pages are accessible (${workingCount}/${checkedCount}).`;
    case "warning":
      return `Some product/category pages failed (${workingCount}/${checkedCount} working) — source: ${source}.`;
    case "failed":
      return `Homepage is reachable, but no product/category pages could be opened (${checkedCount} tried).`;
    case "unknown":
      return "Homepage is reachable, but no product/category links were found on the homepage or sitemap.";
    case "error":
      return "Homepage was unreachable — could not run product check.";
    case "skipped":
      return "Product check is disabled for this site.";
  }
}

export async function runProductCheck(
  url: string,
): Promise<ProductCheckResult> {
  const start = performance.now();
  const generatedAt = new Date().toISOString();

  // 1) Fetch homepage
  const home = await fetchText(url, HOMEPAGE_TIMEOUT_MS);
  if (!home.ok) {
    return {
      enabled: true,
      url,
      status: "error",
      productPagesFound: false,
      source: "none",
      checkedUrls: [],
      workingUrls: [],
      message: buildMessage("error", "none", 0, 0, null),
      responseTimeMs: Math.round(performance.now() - start),
      errorMessage: home.errorMessage,
      generatedAt,
    };
  }

  let candidates = extractHomepageLinks(home.text, url);
  let source: ProductCheckSource = candidates.length > 0 ? "homepage" : "none";

  // 2) Fallback: try sitemaps
  if (candidates.length === 0) {
    let baseOrigin: string;
    try {
      baseOrigin = new URL(url).origin;
    } catch {
      baseOrigin = url;
    }
    candidates = await discoverFromSitemaps(baseOrigin);
    if (candidates.length > 0) source = "sitemap";
  }

  if (candidates.length === 0) {
    return {
      enabled: true,
      url,
      status: "unknown",
      productPagesFound: false,
      source: "none",
      checkedUrls: [],
      workingUrls: [],
      message: buildMessage("unknown", "none", 0, 0, null),
      responseTimeMs: Math.round(performance.now() - start),
      errorMessage: null,
      generatedAt,
    };
  }

  // 3) Sample 3-5
  const sampleSize = Math.min(
    MAX_SAMPLES,
    Math.max(MIN_SAMPLES, Math.min(candidates.length, MAX_SAMPLES)),
  );
  const samples = shuffleSample(candidates, sampleSize);

  // 4) Probe — small concurrency (2) is fine here, the homepage host is warmed up
  const results = await Promise.all(samples.map((s) => probeUrl(s)));
  const workingUrls: string[] = [];
  samples.forEach((s, i) => {
    if (results[i]) workingUrls.push(s);
  });

  let status: ProductCheckStatus;
  if (workingUrls.length === samples.length) status = "ok";
  else if (workingUrls.length > 0) status = "warning";
  else status = "failed";

  const message = buildMessage(
    status,
    source,
    workingUrls.length,
    samples.length,
    workingUrls[0] ?? null,
  );

  return {
    enabled: true,
    url,
    status,
    productPagesFound: workingUrls.length > 0,
    source,
    checkedUrls: samples,
    workingUrls,
    message,
    responseTimeMs: Math.round(performance.now() - start),
    errorMessage: null,
    generatedAt,
  };
}
