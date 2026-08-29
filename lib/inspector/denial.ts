import {
  deriveRisk,
  sortFindings,
  type ApprovalRequest,
  type ChainHop,
  type Finding,
  type Verdict,
} from "./types.ts";

/**
 * Build the verdict for an inspection a human stopped at an approval gate.
 *
 * This exists as its own function because getting it wrong is the worst bug
 * this product can have. A recorded or in-flight inspection knows what the
 * artifact *would* have done next; once the step is denied, none of that was
 * observed. Reporting it anyway would be fabricating behavioural evidence —
 * precisely the failure the whole design argues against — so the verdict is
 * rebuilt from findings that actually streamed, the denied branch is recorded
 * as unexplored, and the risk level is recomputed rather than inherited.
 *
 * With coverage missing, `deriveRisk` lands on `undetermined` unless something
 * concrete had already been seen. That is the honest answer: not "clean", and
 * not the conviction the unplayed trace was holding.
 */
export function buildDeniedVerdict(input: {
  /** Findings actually streamed before the gate. */
  observed: Finding[];
  /** Hops not yet followed when the human said no. */
  pendingHops: ChainHop[];
  request: ApprovalRequest;
  /** Hash of the artifact we were given. Not behavioural evidence. */
  definitionHash: string;
}): Verdict {
  const findings = sortFindings(input.observed);
  const target = input.request.destination ?? input.request.payloadPreview ?? input.request.title;

  const unexplored = [
    `${target} — you denied this step, so it never ran and nothing past it was observed.`,
    ...input.pendingHops.map(
      (hop) => `${hop.target} — not reached, because the inspection stopped here.`,
    ),
  ];

  return {
    risk: deriveRisk(findings, unexplored.length),
    summary:
      findings.length === 0
        ? "Stopped at your request before anything ran. Nothing was observed, so there is nothing to report either way — this is not a clean result, it is an absent one."
        : "Stopped at your request. Everything below was seen before the inspection halted; nothing beyond the denied step was observed, so anything the artifact would have done next is unknown rather than absent.",
    definitionHash: input.definitionHash,
    findings,
    unexplored,
  };
}

/** Hops that had not been followed yet when the inspection stopped. */
export function pendingHops(hops: ChainHop[]): ChainHop[] {
  return hops.filter((hop) => hop.status === "pending" || hop.status === "following");
}
