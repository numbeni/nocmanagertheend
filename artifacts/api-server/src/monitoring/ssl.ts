import tls from "node:tls";

const TLS_TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 1200;

export type SslStatus =
  | "valid"
  | "expiring_soon"
  | "expired"
  | "hostname_mismatch"
  | "self_signed"
  | "invalid"
  | "timeout"
  | "unreachable"
  | "unknown";

export interface SslCheckResult {
  status: SslStatus;
  daysRemaining: number | null;
  issuer: string | null;
  subject: string | null;
  validFrom: string | null;
  validTo: string | null;
  protocol: string | null;
  error: string | null;
}

const KNOWN_CA_KEYWORDS = [
  "let's encrypt", "letsencrypt", "digicert", "sectigo", "comodo",
  "globalsign", "google", "amazon", "cloudflare", "zerossl",
  "identrust", "geotrust", "verisign", "thawte", "godaddy",
  "entrust", "trustwave", "rapidssl",
];

function isSelfSignedCert(cert: tls.PeerCertificate): boolean {
  const issuerCN = cert.issuer?.CN ?? "";
  const subjectCN = cert.subject?.CN ?? "";
  const issuerO = cert.issuer?.O ?? "";
  const subjectO = cert.subject?.O ?? "";

  if (issuerCN && subjectCN && issuerCN === subjectCN) return true;
  if (issuerO && subjectO && issuerO === subjectO) {
    const orgLower = issuerO.toLowerCase();
    if (!KNOWN_CA_KEYWORDS.some((k) => orgLower.includes(k))) return true;
  }
  return false;
}

function flatten(v: string | string[] | undefined): string | null {
  if (!v) return null;
  return Array.isArray(v) ? v.join(", ") : v;
}

function attemptSslCheck(host: string, port: number): Promise<SslCheckResult> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (r: SslCheckResult) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(r);
    };

    const hardTimer = setTimeout(() => {
      finish({
        status: "timeout",
        daysRemaining: null,
        issuer: null,
        subject: null,
        validFrom: null,
        validTo: null,
        protocol: null,
        error: "TLS handshake timeout",
      });
    }, TLS_TIMEOUT_MS);

    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        rejectUnauthorized: false,
        timeout: TLS_TIMEOUT_MS,
      },
      () => {
        clearTimeout(hardTimer);
        try {
          const cert = socket.getPeerCertificate(false);
          if (!cert || Object.keys(cert).length === 0) {
            return finish({
              status: "invalid",
              daysRemaining: null,
              issuer: null,
              subject: null,
              validFrom: null,
              validTo: null,
              protocol: null,
              error: "No certificate presented",
            });
          }

          const validToDate = cert.valid_to ? new Date(cert.valid_to) : null;
          const validFromDate = cert.valid_from ? new Date(cert.valid_from) : null;
          const daysRemaining = validToDate
            ? Math.floor((validToDate.getTime() - Date.now()) / 86_400_000)
            : null;

          const issuer = flatten(cert.issuer?.O) ?? flatten(cert.issuer?.CN) ?? null;
          const subject = flatten(cert.subject?.O) ?? flatten(cert.subject?.CN) ?? null;
          const protocol = (socket as any).getProtocol?.() ?? null;
          const meta = {
            issuer,
            subject,
            validFrom: validFromDate?.toISOString() ?? null,
            validTo: validToDate?.toISOString() ?? null,
            protocol,
          };

          if (daysRemaining !== null && daysRemaining < 0) {
            return finish({ status: "expired", daysRemaining, ...meta, error: "Certificate expired" });
          }

          if (!socket.authorized) {
            const reason = socket.authorizationError?.toString() ?? "";
            const reasonLo = reason.toLowerCase();

            if (/hostname/i.test(reason) || /altname/i.test(reason) || /does not match/i.test(reason)) {
              return finish({ status: "hostname_mismatch", daysRemaining, ...meta, error: reason });
            }

            if (
              isSelfSignedCert(cert) ||
              /self.?signed/i.test(reason) ||
              /unable to get local issuer/i.test(reasonLo) ||
              /depth zero/i.test(reasonLo) ||
              /certificate verify failed/i.test(reasonLo)
            ) {
              return finish({ status: "self_signed", daysRemaining, ...meta, error: reason || "Self-signed certificate" });
            }

            return finish({ status: "invalid", daysRemaining, ...meta, error: reason || "Certificate not authorized" });
          }

          if (daysRemaining !== null && daysRemaining < 30) {
            return finish({ status: "expiring_soon", daysRemaining, ...meta, error: null });
          }

          return finish({ status: "valid", daysRemaining, ...meta, error: null });
        } catch (e) {
          finish({
            status: "unknown",
            daysRemaining: null,
            issuer: null,
            subject: null,
            validFrom: null,
            validTo: null,
            protocol: null,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      },
    );

    socket.on("error", (err) => {
      clearTimeout(hardTimer);
      const msg = err.message ?? "";
      if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH/i.test(msg)) {
        finish({ status: "unreachable", daysRemaining: null, issuer: null, subject: null, validFrom: null, validTo: null, protocol: null, error: msg });
      } else {
        finish({ status: "unknown", daysRemaining: null, issuer: null, subject: null, validFrom: null, validTo: null, protocol: null, error: msg });
      }
    });

    socket.on("timeout", () => {
      clearTimeout(hardTimer);
      finish({ status: "timeout", daysRemaining: null, issuer: null, subject: null, validFrom: null, validTo: null, protocol: null, error: "Socket timeout" });
    });
  });
}

export async function checkSsl(host: string, port = 443): Promise<SslCheckResult> {
  const first = await attemptSslCheck(host, port);
  if (first.status === "timeout" || first.status === "unknown") {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return attemptSslCheck(host, port);
  }
  return first;
}
