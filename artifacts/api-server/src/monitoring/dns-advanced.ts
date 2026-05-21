import { Resolver } from "node:dns/promises";
import { lookup as dnsLookup } from "node:dns";
import { promisify } from "node:util";

const lookupAsync = promisify(dnsLookup);

const DNS_TIMEOUT_MS = 5000;
const MAX_CNAME_HOPS = 10;
/**
 * Default to "system" so we use whatever resolvers the host has configured
 * (typically the local DNS resolver). This is the most reliable option in
 * sandboxed environments where outbound UDP/53 to public resolvers may be
 * blocked. Callers that want a specific resolver can pass one explicitly.
 */
const DEFAULT_RESOLVER = "system";

export type DnsRecordCode =
  | "OK"
  | "NXDOMAIN"
  | "SERVFAIL"
  | "TIMEOUT"
  | "NO_RECORD"
  | "REFUSED"
  | "ERROR";

export interface DnsRecordResult {
  type: "A" | "AAAA" | "CNAME";
  records: string[];
  code: DnsRecordCode;
  errorMessage: string | null;
  responseTimeMs: number;
}

export interface CnameChainHop {
  hop: number;
  from: string;
  cname: string | null;
  /** Final A records resolved (if this is the last hop). */
  resolvedA: string[];
  code: DnsRecordCode;
  errorMessage: string | null;
}

export interface CnameChainResult {
  startHost: string;
  chain: CnameChainHop[];
  finalTarget: string;
  truncated: boolean;
  /** Whether we found a CNAME loop. */
  loop: boolean;
}

export interface AdvancedDnsReport {
  host: string;
  resolver: string;
  a: DnsRecordResult;
  aaaa: DnsRecordResult;
  cname: DnsRecordResult;
  cnameChain: CnameChainResult;
  /** Result of node's libuv-backed `dns.lookup` (mirrors what most apps actually do). */
  systemLookup: {
    address: string | null;
    family: number | null;
    code: DnsRecordCode;
    errorMessage: string | null;
    responseTimeMs: number;
  };
  generatedAt: string;
}

function makeResolver(server = DEFAULT_RESOLVER): Resolver {
  const r = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 });
  if (server && server !== "system") {
    r.setServers([server]);
  }
  return r;
}

function classifyError(err: unknown): DnsRecordCode {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code).toUpperCase()
      : "";
  if (code === "ENOTFOUND" || code === "ENODATA") return "NO_RECORD";
  if (code === "NXDOMAIN") return "NXDOMAIN";
  if (code === "SERVFAIL") return "SERVFAIL";
  if (code === "TIMEOUT" || code === "ETIMEOUT") return "TIMEOUT";
  if (code === "REFUSED") return "REFUSED";
  return "ERROR";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function resolveRecord(
  type: "A" | "AAAA" | "CNAME",
  host: string,
  server: string,
): Promise<DnsRecordResult> {
  const resolver = makeResolver(server);
  const start = Date.now();
  try {
    let records: string[] = [];
    if (type === "A") records = await resolver.resolve4(host);
    else if (type === "AAAA") records = await resolver.resolve6(host);
    else records = await resolver.resolveCname(host);
    return {
      type,
      records,
      code: records.length > 0 ? "OK" : "NO_RECORD",
      errorMessage: null,
      responseTimeMs: Date.now() - start,
    };
  } catch (err) {
    const code = classifyError(err);
    return {
      type,
      records: [],
      code,
      errorMessage: errorMessage(err),
      responseTimeMs: Date.now() - start,
    };
  }
}

async function resolveCnameChain(
  host: string,
  server: string,
): Promise<CnameChainResult> {
  const chain: CnameChainHop[] = [];
  const seen = new Set<string>();
  let current = host;
  let truncated = false;
  let loop = false;
  let finalTarget = host;

  for (let hop = 0; hop < MAX_CNAME_HOPS; hop++) {
    if (seen.has(current.toLowerCase())) {
      loop = true;
      break;
    }
    seen.add(current.toLowerCase());

    const resolver = makeResolver(server);
    let cname: string | null = null;
    let cnameCode: DnsRecordCode = "NO_RECORD";
    let cnameErr: string | null = null;
    try {
      const records = await resolver.resolveCname(current);
      if (records.length > 0) {
        cname = records[0] ?? null;
        cnameCode = "OK";
      }
    } catch (err) {
      cnameCode = classifyError(err);
      cnameErr = errorMessage(err);
      // NO_RECORD here just means "no CNAME, we're at the leaf" — keep going.
    }

    if (cname) {
      chain.push({
        hop,
        from: current,
        cname,
        resolvedA: [],
        code: cnameCode,
        errorMessage: cnameErr,
      });
      current = cname;
      finalTarget = cname;
      continue;
    }

    // Leaf — try to resolve A records.
    const a = await resolveRecord("A", current, server);
    chain.push({
      hop,
      from: current,
      cname: null,
      resolvedA: a.records,
      code: a.code === "OK" ? "OK" : a.code,
      errorMessage: a.errorMessage,
    });
    finalTarget = current;
    return { startHost: host, chain, finalTarget, truncated: false, loop: false };
  }

  truncated = true;
  return { startHost: host, chain, finalTarget, truncated, loop };
}

async function systemLookup(host: string) {
  const start = Date.now();
  try {
    const res = await lookupAsync(host);
    return {
      address: res.address,
      family: res.family,
      code: "OK" as DnsRecordCode,
      errorMessage: null,
      responseTimeMs: Date.now() - start,
    };
  } catch (err) {
    return {
      address: null,
      family: null,
      code: classifyError(err),
      errorMessage: errorMessage(err),
      responseTimeMs: Date.now() - start,
    };
  }
}

export async function getAdvancedDnsReport(
  host: string,
  server: string = DEFAULT_RESOLVER,
): Promise<AdvancedDnsReport> {
  const [a, aaaa, cname, chain, sys] = await Promise.all([
    resolveRecord("A", host, server),
    resolveRecord("AAAA", host, server),
    resolveRecord("CNAME", host, server),
    resolveCnameChain(host, server),
    systemLookup(host),
  ]);
  return {
    host,
    resolver: server,
    a,
    aaaa,
    cname,
    cnameChain: chain,
    systemLookup: sys,
    generatedAt: new Date().toISOString(),
  };
}
