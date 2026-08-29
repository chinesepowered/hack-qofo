import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Guarded outbound fetch for chain-following.
 *
 * Following a hop means our server retrieves a URL an untrusted artifact chose.
 * That is a server-side request forgery primitive if it is built naively: the
 * artifact could point at cloud metadata (169.254.169.254), at something on the
 * host's loopback, or at a private range it cannot otherwise reach.
 *
 * So every destination is resolved and checked against the reserved ranges
 * before a request is made, redirects are followed manually with the same check
 * applied to each new location, and the response is bounded in both time and
 * size. We read text; we never execute anything here.
 *
 * Known residual risk: DNS rebinding. We validate the addresses a hostname
 * resolves to and then let fetch resolve it again, so a record with a very
 * short TTL could return a different address the second time. Closing that
 * properly needs a pinned-IP connection with SNI preserved. It is documented
 * rather than hidden, and the deployment guidance is to run this egress path
 * from a network that has nothing private worth reaching.
 */

export const MAX_FETCH_BYTES = 512 * 1024;
export const FETCH_TIMEOUT_MS = 8_000;
export const MAX_REDIRECTS = 3;

export type FetchRefusal =
  | "unsupported-scheme"
  | "unresolvable-host"
  | "blocked-address"
  | "too-many-redirects"
  | "too-large"
  | "timeout"
  | "unreachable"
  | "not-text";

export interface FetchOutcome {
  ok: boolean;
  /** Final URL after redirects, when we got that far. */
  finalUrl?: string;
  status?: number;
  contentType?: string;
  body?: string;
  truncated?: boolean;
  refusal?: FetchRefusal;
  /** Plain-language reason, safe to show a reviewer. */
  detail?: string;
  /** Each redirect we followed, for the chain map. */
  redirects?: string[];
}

/** IPv4 ranges that must never be reachable from a chain follower. */
function isBlockedIpv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast and reserved
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true; // unspecified, loopback
  if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique local
  if (v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) {
    return true; // link-local
  }
  if (v.startsWith("ff")) return true; // multicast

  // IPv4-mapped (::ffff:a.b.c.d) inherits the IPv4 rules.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true; // not an address we understand: refuse
}

/**
 * Resolve a hostname and refuse if *any* address it maps to is reserved.
 *
 * Any, not all: a host that resolves to both a public and a private address
 * could still be used to reach the private one.
 */
export async function resolvesToPublicAddress(
  hostname: string,
  resolver: (host: string) => Promise<Array<{ address: string }>> = (host) =>
    lookup(host, { all: true, verbatim: true }),
): Promise<{ ok: boolean; addresses: string[] }> {
  // A literal address needs no lookup.
  if (isIP(hostname)) {
    return { ok: !isBlockedAddress(hostname), addresses: [hostname] };
  }
  // Bracketed IPv6 literal from a URL.
  const bracketed = /^\[(.+)\]$/.exec(hostname);
  if (bracketed) {
    return { ok: !isBlockedAddress(bracketed[1]), addresses: [bracketed[1]] };
  }

  let records: Array<{ address: string }>;
  try {
    records = await resolver(hostname);
  } catch {
    return { ok: false, addresses: [] };
  }

  const addresses = records.map((r) => r.address);
  if (addresses.length === 0) return { ok: false, addresses };
  return { ok: !addresses.some(isBlockedAddress), addresses };
}

const TEXTUAL = /^(text\/|application\/(json|xml|javascript|x-sh|x-shellscript|yaml|x-yaml))/i;

export interface FetchDeps {
  fetchImpl?: typeof fetch;
  resolver?: (host: string) => Promise<Array<{ address: string }>>;
}

/**
 * Retrieve a URL as text, or explain why we refused.
 *
 * Redirects are followed manually so each new destination goes through the same
 * address check — a permissive redirect is otherwise a way straight past it.
 */
export async function fetchHopText(rawUrl: string, deps: FetchDeps = {}): Promise<FetchOutcome> {
  const doFetch = deps.fetchImpl ?? fetch;
  const redirects: string[] = [];
  let current: URL;

  try {
    current = new URL(rawUrl);
  } catch {
    return { ok: false, refusal: "unsupported-scheme", detail: "Not a valid URL." };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      return {
        ok: false,
        refusal: "unsupported-scheme",
        detail: `Refused: ${current.protocol} is not http or https.`,
      };
    }

    const resolution = await resolvesToPublicAddress(current.hostname, deps.resolver);
    if (!resolution.ok) {
      return {
        ok: false,
        refusal: resolution.addresses.length === 0 ? "unresolvable-host" : "blocked-address",
        detail:
          resolution.addresses.length === 0
            ? `Refused: ${current.hostname} does not resolve.`
            : `Refused: ${current.hostname} resolves to a reserved address (${resolution.addresses[0]}). Following it could reach a private network or cloud metadata.`,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res: Response;
    try {
      res = await doFetch(current.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          // Identify honestly. We are not pretending to be a browser.
          "User-Agent": "CapyGuard-Inspector/0.1 (+chain-follower; reads only)",
          Accept: "text/*, application/json;q=0.9, */*;q=0.1",
        },
      });
    } catch (error) {
      clearTimeout(timer);
      const aborted = error instanceof Error && error.name === "AbortError";
      return {
        ok: false,
        refusal: aborted ? "timeout" : "unreachable",
        detail: aborted
          ? `No response within ${FETCH_TIMEOUT_MS / 1000}s.`
          : "The host could not be reached.",
      };
    }
    clearTimeout(timer);

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        return { ok: false, refusal: "unreachable", detail: `Redirect with no location (${res.status}).` };
      }
      if (hop === MAX_REDIRECTS) {
        return {
          ok: false,
          refusal: "too-many-redirects",
          detail: `Stopped after ${MAX_REDIRECTS} redirects.`,
          redirects,
        };
      }
      current = new URL(location, current);
      redirects.push(current.toString());
      continue;
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType && !TEXTUAL.test(contentType)) {
      return {
        ok: false,
        refusal: "not-text",
        status: res.status,
        contentType,
        finalUrl: current.toString(),
        redirects,
        detail: `Served ${contentType.split(";")[0]}, which this pass does not read.`,
      };
    }

    const advertised = Number(res.headers.get("content-length"));
    if (Number.isFinite(advertised) && advertised > MAX_FETCH_BYTES) {
      return {
        ok: false,
        refusal: "too-large",
        status: res.status,
        finalUrl: current.toString(),
        redirects,
        detail: `Response advertises ${advertised} bytes, over the ${MAX_FETCH_BYTES} byte limit.`,
      };
    }

    const { text, truncated } = await readBounded(res);
    return {
      ok: true,
      finalUrl: current.toString(),
      status: res.status,
      contentType,
      body: text,
      truncated,
      redirects,
    };
  }

  return { ok: false, refusal: "too-many-redirects", detail: "Redirect loop.", redirects };
}

/** Read the body, stopping at the cap rather than trusting Content-Length. */
async function readBounded(res: Response): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: "", truncated: false };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let total = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      if (total + value.byteLength > MAX_FETCH_BYTES) {
        parts.push(decoder.decode(value.slice(0, MAX_FETCH_BYTES - total), { stream: false }));
        truncated = true;
        break;
      }
      total += value.byteLength;
      parts.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => {
      /* already closed */
    });
  }

  if (!truncated) parts.push(decoder.decode());
  return { text: parts.join(""), truncated };
}
