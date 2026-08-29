import { runStaticPass, STATIC_ONLY_CAVEAT } from "./patterns.ts";
import { sha256 } from "./pinning.ts";
import {
  deriveRisk,
  sortFindings,
  type InspectionEvent,
  type RiskLevel,
  type TimedInspectionEvent,
} from "./types.ts";

/**
 * Build an inspection trace from the offline pattern pass.
 *
 * Used when someone pastes their own artifact and no gateway is configured, so
 * the booth demo still returns a real result on real input rather than a
 * placeholder.
 */

/**
 * A static pass may not call anything malicious.
 *
 * The product's rule is that a verdict rests on observed behaviour, and nothing
 * was observed here — no sandbox, no execution, no hop followed. Matching
 * `~/.ssh/id_rsa` in a file is strong grounds for suspicion and weak grounds for
 * a conviction, so the ceiling is `suspicious` and the reason is stated in the
 * summary rather than hidden in a footnote.
 */
export function capForStaticOnly(risk: RiskLevel): RiskLevel {
  return risk === "malicious" ? "suspicious" : risk;
}

export async function buildStaticTrace(
  artifactName: string,
  source: string,
): Promise<TimedInspectionEvent[]> {
  const { findings, referencedUrls } = runStaticPass(source);
  const sorted = sortFindings(findings);
  const events: TimedInspectionEvent[] = [];

  // `Omit` over the event union would collapse it to the common keys, so the
  // parameter is the union itself and the delay is stamped on here.
  const push = (event: InspectionEvent, delayMs = 340) => {
    events.push({ ...event, delayMs });
  };

  push({ kind: "started", artifactName, mode: "replay" }, 120);
  push({
    kind: "narration",
    text: "No sandbox configured, so Momo reads it while the others sit this one out.",
  }, 420);

  push({ kind: "inspector_started", inspector: "momo", note: "Reading for poison patterns" }, 320);

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

  referencedUrls.forEach((url, i) => {
    push(
      {
        kind: "hop_discovered",
        hop: {
          id: `h-url-${i}`,
          hop: 1,
          source: artifactName,
          target: url,
          label: new URL(url).hostname,
          kind: "url",
          status: "unexplored",
          parentId: "h0",
          outcome: "Not followed. Following a hop requires a sandbox.",
        },
      },
      260,
    );
  });

  push({
    kind: "inspector_done",
    inspector: "momo",
    summary:
      sorted.length === 0
        ? "No known pattern matched."
        : `${sorted.length} pattern${sorted.length === 1 ? "" : "s"} matched.`,
  }, 320);

  const unexplored = [
    STATIC_ONLY_CAVEAT,
    ...referencedUrls.map(
      (url) => `${url} — referenced by the artifact and never followed, because no sandbox was available.`,
    ),
  ];

  const risk = capForStaticOnly(deriveRisk(sorted, unexplored.length));

  push(
    {
      kind: "verdict",
      verdict: {
        risk,
        summary: summarise(risk, sorted.length, referencedUrls.length),
        definitionHash: await sha256(source),
        findings: sorted,
        unexplored,
      },
    },
    600,
  );

  return events;
}

function summarise(risk: RiskLevel, findingCount: number, urlCount: number): string {
  const hops =
    urlCount > 0
      ? ` It also points at ${urlCount} external location${urlCount === 1 ? "" : "s"}, and whatever ${urlCount === 1 ? "it serves is" : "those serve are"} not part of what was reviewed here.`
      : "";

  if (findingCount === 0) {
    return `Nothing matched. That is not a clearance: this run read the text and executed nothing, so anything that only reveals itself when it runs would look exactly like this.${hops}`;
  }

  const noun = findingCount === 1 ? "pattern" : "patterns";
  const ceiling =
    risk === "suspicious"
      ? " Findings at this level would normally read as malicious, but nothing was executed to confirm it, so the verdict stops at suspicious."
      : "";

  return `${findingCount} known-bad ${noun} matched by reading alone.${ceiling}${hops} Connect a gateway to run this in a sandbox and find out what it actually does.`;
}
