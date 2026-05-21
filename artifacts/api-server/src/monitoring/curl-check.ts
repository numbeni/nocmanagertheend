import { performance } from "node:perf_hooks";

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 10;
const BODY_PREVIEW_BYTES = 600;

export type StatusGroup = "1xx" | "2xx" | "3xx" | "4xx" | "5xx" | "none";

export interface RedirectHop {
  url: string;
  status: number;
  location: string | null;
}

export interface CurlCheckResult {
  url: string;
  finalUrl: string;
  statusCode: number | null;
  statusGroup: StatusGroup;
  responseTimeMs: number;
  redirectCount: number;
  redirectChain: RedirectHop[];
  contentType: string | null;
  server: string | null;
  responseHeaders: Record<string, string>;
  bodyPreview: string | null;
  ok: boolean;
  errorMessage: string | null;
  generatedAt: string;
}

function groupOf(status: number | null): StatusGroup {
  if (status == null) return "none";
  if (status >= 100 && status < 200) return "1xx";
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return "none";
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * Full curl -L style probe. Follows redirects manually, capturing each hop,
 * final response headers, and a body preview.
 *
 * NOTE: This is a DIAGNOSTIC. It must never affect a site's overall status.
 */
export async function runCurlCheck(initialUrl: string): Promise<CurlCheckResult> {
  const generatedAt = new Date().toISOString();
  const start = performance.now();
  let current = initialUrl;
  let redirectCount = 0;
  const redirectChain: RedirectHop[] = [];
  let lastStatus: number | null = null;
  let lastContentType: string | null = null;
  let lastServer: string | null = null;
  let lastHeaders: Record<string, string> = {};
  let bodyPreview: string | null = null;
  let errorMessage: string | null = null;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: ac.signal,
        headers: {
          "User-Agent": "curl/8.7.1",
          "Accept": "*/*",
        },
      });
      lastStatus = res.status;
      lastContentType = res.headers.get("content-type");
      lastServer = res.headers.get("server");

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        redirectChain.push({ url: current, status: res.status, location });
        if (!location) break;
        try {
          const next = new URL(location, current).toString();
          if (next === current) break;
          current = next;
          redirectCount++;
          // Drain body to avoid keep-alive stall
          try { await res.body?.cancel(); } catch { /* ignore */ }
          continue;
        } catch {
          break;
        }
      }

      // Final response — collect headers and body preview
      lastHeaders = headersToRecord(res.headers);
      try {
        const buf = await res.arrayBuffer();
        const text = new TextDecoder("utf-8", { fatal: false }).decode(
          buf.slice(0, BODY_PREVIEW_BYTES),
        );
        bodyPreview = text.replace(/\r\n/g, "\n").trimEnd();
        if (buf.byteLength > BODY_PREVIEW_BYTES) bodyPreview += "\n…";
      } catch {
        bodyPreview = null;
      }
      break;
    } catch (err) {
      errorMessage =
        err instanceof Error
          ? err.name === "AbortError"
            ? `Timed out after ${TIMEOUT_MS / 1000}s`
            : err.message
          : String(err);
      lastStatus = null;
      break;
    } finally {
      clearTimeout(timer);
    }
  }

  const responseTimeMs = Math.round(performance.now() - start);
  const ok =
    lastStatus !== null &&
    ((lastStatus >= 200 && lastStatus < 400));

  return {
    url: initialUrl,
    finalUrl: current,
    statusCode: lastStatus,
    statusGroup: groupOf(lastStatus),
    responseTimeMs,
    redirectCount,
    redirectChain,
    contentType: lastContentType,
    server: lastServer,
    responseHeaders: lastHeaders,
    bodyPreview,
    ok,
    errorMessage,
    generatedAt,
  };
}
