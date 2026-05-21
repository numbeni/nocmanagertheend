const HTTP_TIMEOUT_MS = 10000;
const SLOW_THRESHOLD_MS = 3000;
const BODY_SAMPLE_BYTES = 8192; // 8 KB is enough to spot WAF / block pages

export interface HttpCheckResult {
  status: "ok" | "slow" | "server_error" | "client_error" | "down" | "timeout";
  httpStatus: number | null;
  responseTimeMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
  /** First few KB of response body (text only). Used by blocked-status detector. */
  bodySample: string | null;
  /** Lowercased header map. Used by blocked-status detector. */
  headers: Record<string, string> | null;
}

function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

export async function checkHttp(url: string): Promise<HttpCheckResult> {
  const start = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ac.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; NOC-Monitor/1.0; +monitoring)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const responseTimeMs = Date.now() - start;
    const httpStatus = res.status;
    const headers = headersToObject(res.headers);

    // Read a bounded slice of the body so we can detect block pages without
    // pulling huge payloads into memory.
    let bodySample: string | null = null;
    try {
      const buf = await res.arrayBuffer();
      const slice = buf.slice(0, BODY_SAMPLE_BYTES);
      bodySample = new TextDecoder("utf-8", { fatal: false }).decode(slice);
    } catch {
      bodySample = null;
    }

    if (httpStatus >= 500) {
      return {
        status: "server_error",
        httpStatus,
        responseTimeMs,
        errorType: "server_error",
        errorMessage: `HTTP ${httpStatus}`,
        bodySample,
        headers,
      };
    }
    if (httpStatus >= 400) {
      return {
        status: "client_error",
        httpStatus,
        responseTimeMs,
        errorType: "client_error",
        errorMessage: `HTTP ${httpStatus}`,
        bodySample,
        headers,
      };
    }
    if (responseTimeMs > SLOW_THRESHOLD_MS) {
      return {
        status: "slow",
        httpStatus,
        responseTimeMs,
        errorType: "slow",
        errorMessage: `Response took ${responseTimeMs}ms`,
        bodySample,
        headers,
      };
    }
    return {
      status: "ok",
      httpStatus,
      responseTimeMs,
      errorType: null,
      errorMessage: null,
      bodySample,
      headers,
    };
  } catch (err) {
    const responseTimeMs = Date.now() - start;
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" || /aborted/i.test(err.message));
    return {
      status: isAbort ? "timeout" : "down",
      httpStatus: null,
      responseTimeMs,
      errorType: isAbort ? "timeout" : "network",
      errorMessage: err instanceof Error ? err.message : String(err),
      bodySample: null,
      headers: null,
    };
  } finally {
    clearTimeout(timer);
  }
}
