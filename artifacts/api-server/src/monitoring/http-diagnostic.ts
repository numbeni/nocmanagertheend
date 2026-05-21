import { performance } from "node:perf_hooks";

const HTTP_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

export interface HttpDiagnosticHop {
  hop: number;
  url: string;
  method: string;
  status: number | null;
  statusText: string | null;
  responseTimeMs: number;
  /** Selected headers (lowercased keys), filtered to common ones for readability. */
  headers: Record<string, string>;
  redirectedTo: string | null;
  errorType: string | null;
  errorMessage: string | null;
}

export interface HttpDiagnosticReport {
  url: string;
  finalUrl: string;
  totalTimeMs: number;
  reachedFinal: boolean;
  hops: HttpDiagnosticHop[];
  /** Curl-style human-readable text dump. */
  curlText: string;
  generatedAt: string;
}

const INTERESTING_HEADERS = new Set([
  "content-type",
  "content-length",
  "server",
  "cache-control",
  "location",
  "x-powered-by",
  "cf-ray",
  "cf-cache-status",
  "x-cache",
  "x-served-by",
  "x-fastly-request-id",
  "strict-transport-security",
  "set-cookie",
  "etag",
  "date",
  "content-encoding",
  "vary",
]);

function pickHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (INTERESTING_HEADERS.has(k)) {
      out[k] = value;
    }
  });
  return out;
}

function classifyError(err: unknown): { type: string; message: string } {
  if (err instanceof Error) {
    const code =
      "code" in err && typeof (err as { code?: unknown }).code === "string"
        ? (err as { code: string }).code
        : "";
    if (code === "ENOTFOUND") return { type: "DNS", message: err.message };
    if (code === "ECONNREFUSED")
      return { type: "TCP_REFUSED", message: err.message };
    if (code === "ECONNRESET")
      return { type: "TCP_RESET", message: err.message };
    if (code === "ETIMEDOUT" || err.name === "AbortError")
      return { type: "TIMEOUT", message: err.message };
    if (code === "CERT_HAS_EXPIRED")
      return { type: "SSL", message: err.message };
    if (code.startsWith("ERR_TLS") || code.startsWith("ERR_SSL"))
      return { type: "SSL", message: err.message };
    return { type: "ERROR", message: err.message };
  }
  return { type: "ERROR", message: String(err) };
}

async function singleRequest(
  url: string,
  method: "GET" | "HEAD",
): Promise<HttpDiagnosticHop> {
  const start = performance.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      redirect: "manual",
      signal: ac.signal,
      headers: { "User-Agent": "NOC-Monitor-Diagnostic/1.0" },
    });
    const headers = pickHeaders(res.headers);
    const location = res.headers.get("location");
    return {
      hop: 0,
      url,
      method,
      status: res.status,
      statusText: res.statusText,
      responseTimeMs: Math.round(performance.now() - start),
      headers,
      redirectedTo: location,
      errorType: null,
      errorMessage: null,
    };
  } catch (err) {
    const { type, message } = classifyError(err);
    return {
      hop: 0,
      url,
      method,
      status: null,
      statusText: null,
      responseTimeMs: Math.round(performance.now() - start),
      headers: {},
      redirectedTo: null,
      errorType: type,
      errorMessage: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runHttpDiagnostic(
  initialUrl: string,
): Promise<HttpDiagnosticReport> {
  const totalStart = performance.now();
  const hops: HttpDiagnosticHop[] = [];
  let current = initialUrl;
  let reached = false;
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const hop = await singleRequest(current, "GET");
    hop.hop = i;
    hops.push(hop);
    if (hop.errorType) break;
    if (
      hop.status &&
      hop.status >= 300 &&
      hop.status < 400 &&
      hop.redirectedTo
    ) {
      try {
        current = new URL(hop.redirectedTo, current).toString();
        continue;
      } catch {
        break;
      }
    }
    reached = true;
    break;
  }

  const finalUrl = hops[hops.length - 1]?.url ?? initialUrl;
  return {
    url: initialUrl,
    finalUrl,
    totalTimeMs: Math.round(performance.now() - totalStart),
    reachedFinal: reached,
    hops,
    curlText: renderCurlText(initialUrl, hops),
    generatedAt: new Date().toISOString(),
  };
}

function renderCurlText(initialUrl: string, hops: HttpDiagnosticHop[]): string {
  const lines: string[] = [];
  lines.push(`$ curl -v -L "${initialUrl}"`);
  lines.push("");
  for (const hop of hops) {
    lines.push(`> ${hop.method} ${hop.url}`);
    if (hop.errorType) {
      lines.push(`! ${hop.errorType}: ${hop.errorMessage}`);
      lines.push(`  (${hop.responseTimeMs} ms)`);
      lines.push("");
      continue;
    }
    lines.push(`< HTTP/1.1 ${hop.status} ${hop.statusText ?? ""}`.trim());
    for (const [k, v] of Object.entries(hop.headers)) {
      lines.push(`< ${k}: ${v}`);
    }
    lines.push(`  (${hop.responseTimeMs} ms)`);
    if (hop.redirectedTo) {
      lines.push(`* redirect → ${hop.redirectedTo}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
