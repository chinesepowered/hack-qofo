import { parseUrl, runStaticPass, STATIC_ONLY_CAVEAT } from "./patterns.ts";
import { sha256 } from "./pinning.ts";
import {
  deriveRisk,
  sortFindings,
  type ApprovalRequest,
  type Finding,
  type InspectionEvent,
  type RiskLevel,
  type TimedInspectionEvent,
} from "./types.ts";

/**
 * Build an inspection trace for an artifact somebody pasted.
 *
 * The pattern pass reads the artifact. If it points anywhere, the trace stops
 * at an approval gate rather than at a shrug: retrieving a hop is only a read,
 * so it does not need a sandbox, and following the chain is precisely what a
 * static scanner cannot do. The actual fetch happens in `followHop` once a
 * human approves it.
 */

/**
 * A static pass may not call anything malicious.
 *
 * The product's rule is that a verdict rests on observed behaviour, and nothing
 * was executed here — hops were read, not run. Matching `~/.ssh/id_rsa` in a
 * file is strong grounds for suspicion and weak grounds for a conviction, so
 * the ceiling is `suspicious` and the reason is stated in the summary rather
 * than hidden in a footnote.
 */
export function capForStaticOnly(risk: RiskLevel): RiskLevel {
  return risk === "malicious" ? "suspicious" : risk;
}

/** Must match the id `followHop` updates for hop 1. */
const FIRST_HOP_ID = "h-follow-1";

export interface StaticTrace {
  events: TimedInspectionEvent[];
  /** Needed by the follow endpoint to carry a stable pin through the chain. */
  definitionHash: string;
  /** Findings so far, threaded into the follow request. */
  findings: Finding[];
}

export async function buildStaticTrace(artifactName: string, source: string): Promise<StaticTrace> {
  const { findings, referencedUrls, truncated } = runStaticPass(source);
  const sorted = sortFindings(findings);
  const definitionHash = await sha256(source);

  const events: TimedInspectionEvent[] = [];
  const push = (event: InspectionEvent, delayMs = 340) => {
    events.push({ ...event, delayMs });
  };

  push({ kind: "started", artifactName, mode: "replay" }, 120);
  push({ kind: "inspector_started", inspector: "momo", note: "Reading for poison patterns" }, 300);

  push({
    kind: "hop_discovered",
    hop: {
      id: "h0",
      hop: 0,
      source: "pasted by you",
      target: artifactName,
      label: artifactName,
      kind: "artifact",
      status: "followed",
      parentId: null,
      outcome: "Read without executing.",
    },
  });

  for (const finding of sorted) {
    push({ kind: "finding", finding }, 380);
  }

  push(
    {
      kind: "inspector_done",
      inspector: "momo",
      summary: sorted.length === 0 ? "No known pattern matched." : `${sorted.length} matched.`,
    },
    320,
  );

  // Nothing to chase: finish here.
  if (referencedUrls.length === 0) {
    push(
      {
        kind: "verdict",
        verdict: {
          risk: capForStaticOnly(deriveRisk(sorted, truncationNotes(truncated).length + 1)),
          summary: summariseNoHops(sorted),
          definitionHash,
          findings: sorted,
          unexplored: [STATIC_ONLY_CAVEAT, ...truncationNotes(truncated)],
        },
      },
      600,
    );
    return { events, definitionHash, findings: sorted };
  }

  // The first hop becomes a real, followable node. The rest are named so a
  // reviewer can see what else is out there.
  const [first, ...rest] = referencedUrls;

  push({
    kind: "hop_discovered",
    hop: {
      id: FIRST_HOP_ID,
      hop: 1,
      source: artifactName,
      target: first,
      label: parseUrl(first)?.hostname ?? first.slice(0, 40),
      kind: "url",
      status: "pending",
      parentId: "h0",
    },
  });

  rest.forEach((url, i) => {
    push(
      {
        kind: "hop_discovered",
        hop: {
          id: `h-alt-${i}`,
          hop: 1,
          source: artifactName,
          target: url,
          label: parseUrl(url)?.hostname ?? url.slice(0, 40),
          kind: "url",
          status: "unexplored",
          parentId: "h0",
          outcome: "Also referenced. Not followed in this run.",
        },
      },
      220,
    );
  });

  push({ kind: "narration", text: "It points somewhere. We can read what that serves." }, 420);
  push({ kind: "approval_required", request: firstHopApproval(first) }, 520);

  return { events, definitionHash, findings: sorted };
}

function firstHopApproval(url: string): ApprovalRequest {
  return {
    id: "a-follow-1",
    toolCallId: "fetch-1",
    threadId: "thread-nibbles",
    title: "Nibbles wants to follow the link",
    plainLanguage:
      "This artifact points at a URL, and whatever that serves is not part of what you pasted. Retrieving it is only a read — nothing is executed — but it is an outbound request, so it is your call.",
    destination: parseUrl(url)?.hostname ?? url,
    payloadPreview: `GET ${url}`,
    risk: "medium",
    followUrl: url,
    followHop: 1,
    followParentId: "h0",
  };
}

function truncationNotes(truncated: { findings: number; urls: number }): string[] {
  const notes: string[] = [];
  if (truncated.urls > 0) {
    notes.push(
      `${truncated.urls} further referenced URL${truncated.urls === 1 ? "" : "s"} not listed — output was capped.`,
    );
  }
  if (truncated.findings > 0) {
    notes.push(
      `${truncated.findings} further pattern match${truncated.findings === 1 ? "" : "es"} not listed — output was capped.`,
    );
  }
  return notes;
}

function summariseNoHops(findings: Finding[]): string {
  const actionable = findings.filter((f) => f.severity !== "info" && f.severity !== "low").length;

  if (actionable === 0) {
    return "No known-bad pattern matched, and it points nowhere else. That is not a clearance: this run read the text and executed nothing, so anything that only reveals itself when it runs would look exactly like this.";
  }

  const noun = actionable === 1 ? "pattern" : "patterns";
  return `${actionable} known-bad ${noun} matched by reading alone. Nothing was executed to confirm it, so the verdict stops short of a conviction. Connect a harness with a sandbox to find out what it actually does.`;
}
