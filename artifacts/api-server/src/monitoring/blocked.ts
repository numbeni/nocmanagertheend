// Evidence-based "blocked" detection.
//
// "Blocked" means the target is *actively rejecting* our access — geo/IP
// restriction, WAF, firewall challenge, security policy, etc.
//
// We refuse to classify these as "blocked":
//   - DNS failures
//   - Timeouts
//   - Connection refused / network errors
//   - SSL errors
//   - 5xx server errors
//
// Only HTTP 403 / 451 OR explicit body markers count.

const BLOCK_PHRASES: { re: RegExp; reason: string }[] = [
  { re: /access\s+denied/i, reason: "Body contains 'access denied'" },
  { re: /\bforbidden\b/i, reason: "Body contains 'forbidden'" },
  { re: /\byour\s+ip\s+(?:has\s+been\s+)?blocked/i, reason: "IP block notice in body" },
  { re: /\bgeo[\s-]?restrict(?:ion|ed)\b/i, reason: "Geo restriction notice" },
  { re: /\bsecurity\s+policy\b/i, reason: "Security policy block" },
  { re: /\bblocked\s+by\s+(?:waf|firewall|cloudflare|akamai|imperva|fastly)/i, reason: "WAF block notice" },
  { re: /attention required.*cloudflare/is, reason: "Cloudflare challenge page" },
  { re: /cf-chl-bypass|__cf_chl_/i, reason: "Cloudflare challenge token" },
  { re: /please enable javascript and cookies to continue/i, reason: "Bot/WAF challenge page" },
  { re: /sucuri website firewall/i, reason: "Sucuri firewall block" },
];

const BLOCK_HEADER_KEYS = [
  "cf-mitigated",
  "x-sucuri-block",
  "x-firewall-block",
];

export interface BlockedDetectionResult {
  blocked: boolean;
  reason: string | null;
}

export function detectBlockedStatus(input: {
  httpStatus: number | null;
  bodySample: string | null;
  headers?: Record<string, string> | null;
}): BlockedDetectionResult {
  const { httpStatus, bodySample, headers } = input;

  // Strict status-code signals
  if (httpStatus === 403) {
    return { blocked: true, reason: "HTTP 403 Forbidden" };
  }
  if (httpStatus === 451) {
    return { blocked: true, reason: "HTTP 451 Unavailable For Legal Reasons" };
  }

  // Header signals (e.g. Cloudflare's `cf-mitigated: challenge`)
  if (headers) {
    for (const k of BLOCK_HEADER_KEYS) {
      const v = headers[k];
      if (v && v.length > 0) {
        return { blocked: true, reason: `Block header ${k}: ${v}` };
      }
    }
    const cfMit = headers["cf-mitigated"];
    if (cfMit && cfMit.toLowerCase() !== "none") {
      return { blocked: true, reason: `Cloudflare mitigation: ${cfMit}` };
    }
  }

  // Body-content signals — only meaningful if we received a 2xx/4xx page
  // (5xx pages with the word "forbidden" are server bugs, not blocks).
  if (
    bodySample &&
    httpStatus !== null &&
    httpStatus >= 200 &&
    httpStatus < 500
  ) {
    for (const p of BLOCK_PHRASES) {
      if (p.re.test(bodySample)) {
        return { blocked: true, reason: p.reason };
      }
    }
  }

  return { blocked: false, reason: null };
}
