import { NextResponse } from "next/server";

import { followHop, MAX_CHAIN_HOPS } from "@/lib/inspector/follow";
import type { Finding, TimedInspectionEvent } from "@/lib/inspector/types";

/**
 * Follow one hop of an instruction chain, on explicit human approval.
 *
 * Retrieving a hop is a read, not an execution, so this works without a
 * sandbox — and it is the step a static scanner never takes. Every outbound
 * request goes through the guarded fetcher, which resolves the destination and
 * refuses reserved addresses before connecting.
 *
 * Stateless by design: the client carries the chain state and hands it back,
 * so an abandoned inspection costs the server nothing.
 */

const MAX_URL_LENGTH = 2048;
const MAX_VISITED = 16;
const MAX_PRIOR_FINDINGS = 80;
const MAX_BODY_BYTES = 128 * 1024;

interface FollowBody {
  url?: unknown;
  hop?: unknown;
  parentId?: unknown;
  visited?: unknown;
  priorFindings?: unknown;
  artifactName?: unknown;
  definitionHash?: unknown;
}

function bad(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  const advertised = Number(request.headers.get("content-length"));
  if (Number.isFinite(advertised) && advertised > MAX_BODY_BYTES) {
    return bad("Request too large.", 413);
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return bad("Expected a JSON body.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return bad("Expected a JSON object.");
  }
  const body = parsed as FollowBody;

  if (typeof body.url !== "string" || body.url.length === 0 || body.url.length > MAX_URL_LENGTH) {
    return bad("A url is required.");
  }

  // Scheme is checked again inside the fetcher; rejecting here keeps an
  // obviously wrong request from getting as far as DNS.
  let target: URL;
  try {
    target = new URL(body.url);
  } catch {
    return bad("That is not a valid URL.");
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return bad("Only http and https can be followed.");
  }

  const hop = typeof body.hop === "number" && Number.isInteger(body.hop) ? body.hop : 1;
  if (hop < 1 || hop > MAX_CHAIN_HOPS) {
    return bad(`Hop must be between 1 and ${MAX_CHAIN_HOPS}.`);
  }

  const visited = Array.isArray(body.visited)
    ? body.visited.filter((v): v is string => typeof v === "string").slice(0, MAX_VISITED)
    : [];

  // A chain that revisits a URL is looping, and following it again would let an
  // artifact keep us busy indefinitely.
  if (visited.includes(body.url)) {
    return bad("That hop has already been followed in this inspection.");
  }

  const priorFindings = Array.isArray(body.priorFindings)
    ? (body.priorFindings.filter(isFinding).slice(0, MAX_PRIOR_FINDINGS) as Finding[])
    : [];

  const definitionHash =
    typeof body.definitionHash === "string" && /^[0-9a-f]{64}$/.test(body.definitionHash)
      ? body.definitionHash
      : "0".repeat(64);

  const artifactName =
    typeof body.artifactName === "string" ? body.artifactName.slice(0, 120) : "pasted artifact";

  let events: TimedInspectionEvent[];
  try {
    events = await followHop({
      url: body.url,
      hop,
      parentId: typeof body.parentId === "string" ? body.parentId : "h0",
      visited,
      priorFindings,
      artifactName,
      definitionHash,
    });
  } catch {
    // An artifact must never be able to abort its own inspection.
    return NextResponse.json(
      { error: "The hop could not be followed. This is a bug, not a verdict." },
      { status: 500 },
    );
  }

  return NextResponse.json({ events });
}

/** Findings round-trip through the client, so re-validate their shape. */
function isFinding(value: unknown): value is Finding {
  if (!value || typeof value !== "object") return false;
  const f = value as Partial<Finding>;
  return (
    typeof f.id === "string" &&
    typeof f.kind === "string" &&
    typeof f.severity === "string" &&
    typeof f.observed === "string" &&
    typeof f.evidence === "string"
  );
}
