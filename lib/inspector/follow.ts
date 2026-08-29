import { fetchHopText } from "./fetcher.ts";
import { runStaticPass, STATIC_ONLY_CAVEAT } from "./patterns.ts";
import { sha256 } from "./pinning.ts";
import {
  deriveRisk,
  sortFindings,
  type ApprovalRequest,
  type Finding,
  type InspectionEvent,
  type TimedInspectionEvent,
} from "./types.ts";
import { capForStaticOnly } from "./static-trace.ts";

/**
 * Chain-following without a sandbox.
 *
 * Reading what a URL serves needs no sandbox — only *executing* it does. That
 * distinction is what lets the static path do the thing static scanners cannot:
 * the payload in these attacks is usually not in the artifact you were handed,
 * it is behind a link, and following that link is just an HTTP GET.
 *
 * What this still cannot do is watch behaviour, so nothing here ever produces a
 * conviction on its own — the ceiling stays at `suspicious`, and a verdict that
 * ran out of hops says so.
 */

/** Deliberately short. A chase that never ends is its own denial of service. */
export const MAX_CHAIN_HOPS = 4;

export interface FollowRequest {
  url: string;
  /** Hop number this fetch becomes. Hop 0 is the pasted artifact. */
  hop: number;
  /** Chain-map node the new hop attaches under. */
  parentId: string;
  /** Every URL already retrieved in this inspection, to break cycles. */
  visited: string[];
  /** Findings gathered so far, so the final verdict can cite all of them. */
  priorFindings: Finding[];
  artifactName: string;
  definitionHash: string;
}

function nodeId(hop: number): string {
  return `h-follow-${hop}`;
}

function approvalFor(url: string, hop: number, parentId: string): ApprovalRequest {
  return {
    id: `a-follow-${hop}`,
    toolCallId: `fetch-${hop}`,
    threadId: "thread-nibbles",
    title: "Nibbles wants to follow the next hop",
    plainLanguage:
      "The last thing we read points somewhere else. Retrieving it is how we find out what this actually does — it is only a read, nothing gets executed.",
    destination: safeHost(url),
    payloadPreview: `GET ${url}`,
    risk: hop >= 2 ? "high" : "medium",
    followUrl: url,
    followHop: hop,
    followParentId: parentId,
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 60);
  }
}

/**
 * Follow one hop and return the events describing what happened.
 *
 * Always terminates in either another approval request or a verdict, so the
 * client is never left waiting on something that will not arrive.
 */
export async function followHop(request: FollowRequest): Promise<TimedInspectionEvent[]> {
  const events: TimedInspectionEvent[] = [];
  const push = (event: InspectionEvent, delayMs = 320) => {
    events.push({ ...event, delayMs });
  };

  const id = nodeId(request.hop);
  const findings: Finding[] = [...request.priorFindings];
  const visited = [...request.visited, request.url];

  push({ kind: "inspector_started", inspector: "nibbles", note: `Retrieving hop ${request.hop}` }, 200);
  push({ kind: "hop_updated", hopId: id, status: "following" }, 260);

  const outcome = await fetchHopText(request.url);

  if (!outcome.ok) {
    push(
      {
        kind: "hop_updated",
        hopId: id,
        status: "blocked",
        outcome: outcome.detail ?? "Could not be retrieved.",
      },
      420,
    );

    // A refusal to reach a reserved address is itself worth reporting: an
    // artifact pointing at cloud metadata is telling you something.
    if (outcome.refusal === "blocked-address") {
      findings.push({
        id: `follow-${request.hop}-ssrf`,
        kind: "network_exfiltration",
        severity: "high",
        observed:
          "Points at a host that resolves to a reserved address — a private network or cloud metadata endpoint. We refused to retrieve it.",
        evidence: request.url,
        confidence: "high",
        reportedBy: "nibbles",
        hop: request.hop,
      });
      push({ kind: "finding", finding: findings[findings.length - 1] }, 380);
    }

    push({ kind: "inspector_done", inspector: "nibbles", summary: "Hop could not be read." }, 260);
    return [...events, ...finalVerdict(request, findings, visited, [
      `${request.url} — ${outcome.detail ?? "could not be retrieved"}.`,
    ])];
  }

  for (const redirect of outcome.redirects ?? []) {
    push({ kind: "narration", text: `Redirected to ${safeHost(redirect)}.` }, 240);
  }

  push(
    {
      kind: "observation",
      observation: {
        id: `obs-${request.hop}`,
        at: new Date(0).toISOString(),
        channel: "network",
        detail: `Retrieved ${outcome.finalUrl} — ${outcome.status}, ${outcome.contentType || "no content type"}${outcome.truncated ? ", truncated at the size cap" : ""}.`,
        contained: true,
      },
    },
    420,
  );

  const pass = runStaticPass(outcome.body ?? "");
  const fresh = sortFindings(pass.findings).map((f) => ({
    ...f,
    id: `hop${request.hop}-${f.id}`,
    reportedBy: "nibbles" as const,
    hop: request.hop,
  }));

  push(
    {
      kind: "hop_updated",
      hopId: id,
      status: "followed",
      outcome:
        fresh.length === 0
          ? "Retrieved. Nothing known-bad in what it served."
          : `Retrieved. ${fresh.length} pattern${fresh.length === 1 ? "" : "s"} matched in what it served.`,
    },
    300,
  );

  for (const finding of fresh) {
    findings.push(finding);
    push({ kind: "finding", finding }, 360);
  }

  // Anything this page points at that we have not already read.
  const nextUrls = pass.referencedUrls.filter((u) => !visited.includes(u));
  const nextHop = request.hop + 1;

  if (nextUrls.length > 0 && nextHop <= MAX_CHAIN_HOPS) {
    const next = nextUrls[0];
    push(
      {
        kind: "hop_discovered",
        hop: {
          id: nodeId(nextHop),
          hop: nextHop,
          source: safeHost(outcome.finalUrl ?? request.url),
          target: next,
          label: safeHost(next),
          kind: "url",
          status: "pending",
          parentId: id,
        },
      },
      380,
    );
    push({ kind: "inspector_done", inspector: "nibbles", summary: `Hop ${request.hop} read. One more edge found.` }, 260);
    push({ kind: "approval_required", request: approvalFor(next, nextHop, id) }, 520);
    return events;
  }

  push({ kind: "inspector_done", inspector: "nibbles", summary: `Hop ${request.hop} read. No further edges.` }, 260);

  const unexplored: string[] = [];
  if (nextUrls.length > 0) {
    unexplored.push(
      `${nextUrls.length} further hop${nextUrls.length === 1 ? "" : "s"} not followed — the chain reached the ${MAX_CHAIN_HOPS}-hop limit.`,
    );
  }

  return [...events, ...finalVerdict(request, findings, visited, unexplored)];
}

function finalVerdict(
  request: FollowRequest,
  findings: Finding[],
  visited: string[],
  extraUnexplored: string[],
): TimedInspectionEvent[] {
  const sorted = sortFindings(findings);
  const unexplored = [
    "Nothing was executed. Hops were read, not run, so behaviour that only appears at runtime is still unknown.",
    ...extraUnexplored,
  ];

  const risk = capForStaticOnly(deriveRisk(sorted, unexplored.length));
  const actionable = sorted.filter((f) => f.severity !== "info" && f.severity !== "low").length;

  const hopsRead = visited.length;
  const summary =
    actionable === 0
      ? `Followed ${hopsRead} hop${hopsRead === 1 ? "" : "s"} and read what each one served. No known-bad pattern matched anywhere along the chain. That is not a clearance — nothing was executed, so anything that only reveals itself at runtime would look exactly like this.`
      : `Followed ${hopsRead} hop${hopsRead === 1 ? "" : "s"}. ${actionable} known-bad pattern${actionable === 1 ? "" : "s"} matched — including in content the artifact itself never contained, which is the part a static scanner cannot reach. Nothing was executed to confirm behaviour, so the verdict stops at ${risk}.`;

  return [
    {
      kind: "verdict",
      delayMs: 620,
      verdict: {
        risk,
        summary,
        definitionHash: request.definitionHash,
        findings: sorted,
        unexplored,
      },
    },
  ];
}

/** Kept next to the follower so the caveat and the capability stay in sync. */
export const CHAIN_CAVEAT = STATIC_ONLY_CAVEAT;

export async function hashSource(source: string): Promise<string> {
  return sha256(source);
}
