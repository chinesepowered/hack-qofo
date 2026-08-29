import type { InspectorRole } from "@/components/inspectors";

/**
 * The UI-facing inspection model.
 *
 * Deliberately independent of the harness event stream. A live inspection maps
 * `TurnEvent`s onto these; a recorded inspection replays them directly. The
 * dashboard cannot tell the difference, which is what makes the demo safe to
 * run without network access — and what keeps the UI from being coupled to the
 * harness wire format.
 */

export type RiskLevel = "clean" | "suspicious" | "malicious" | "undetermined";
export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type Confidence = "low" | "medium" | "high";

/** What kind of thing the inspector saw. Behavioural kinds outrank textual ones. */
export type FindingKind =
  | "network_exfiltration"
  | "credential_access"
  | "file_write"
  | "process_spawn"
  | "instruction_override_attempt"
  | "hidden_instructions"
  | "tool_poisoning"
  | "tool_shadowing"
  | "dynamic_context_execution"
  | "obfuscation"
  | "chain_cycle"
  | "definition_drift"
  | "benign_capability";

export interface Finding {
  id: string;
  kind: FindingKind;
  severity: Severity;
  /** What happened, in behavioural terms. */
  observed: string;
  /** Verbatim quote or logged event. Never a paraphrase. */
  evidence: string;
  confidence: Confidence;
  /** Which capybara reported it. */
  reportedBy: InspectorRole;
  /** Index of the chain hop this was seen at, when applicable. */
  hop?: number;
}

/** One step in the instruction chain. Hop 0 is the artifact the user handed over. */
export interface ChainHop {
  id: string;
  hop: number;
  /** Where this hop came from, e.g. "SKILL.md line 14". */
  source: string;
  /** What it pointed at. */
  target: string;
  label: string;
  kind: "artifact" | "url" | "script" | "instruction" | "binary";
  status: "pending" | "following" | "followed" | "blocked" | "unexplored";
  /** Plain-language result once followed. */
  outcome?: string;
  parentId: string | null;
}

/** Something the sandbox actually observed happening. This is the evidence base. */
export interface Observation {
  id: string;
  at: string;
  channel: "file" | "process" | "network" | "env";
  detail: string;
  /** True when the sandbox refused or honeypotted the action. */
  contained: boolean;
}

export interface ApprovalRequest {
  id: string;
  toolCallId: string;
  threadId: string | null;
  title: string;
  /** Plain language, because a human has to decide in a few seconds. */
  plainLanguage: string;
  destination?: string;
  payloadPreview?: string;
  risk: Severity;
}

export interface CostSnapshot {
  tokens: number;
  usd: number;
  toolCalls: number;
  elapsedMs: number;
}

export interface Verdict {
  risk: RiskLevel;
  summary: string;
  /** Hash of the inspected definition, so later drift can be detected. */
  definitionHash: string;
  findings: Finding[];
  /** Hops deliberately not followed. Honesty beats false coverage. */
  unexplored: string[];
  cost?: CostSnapshot;
}

/**
 * Events the dashboard consumes.
 *
 * `delayMs` exists only for recorded inspections: it is how long to wait before
 * emitting this event, so a replay paces like the real thing instead of
 * dumping the whole trace in one frame.
 */
export type InspectionEvent =
  | { kind: "started"; artifactName: string; mode: "live" | "replay" }
  | { kind: "sandbox_ready"; sandboxId: string }
  | { kind: "inspector_started"; inspector: InspectorRole; note: string }
  | { kind: "inspector_done"; inspector: InspectorRole; summary: string }
  | { kind: "hop_discovered"; hop: ChainHop }
  | { kind: "hop_updated"; hopId: string; status: ChainHop["status"]; outcome?: string }
  | { kind: "observation"; observation: Observation }
  | { kind: "finding"; finding: Finding }
  | { kind: "approval_required"; request: ApprovalRequest }
  | { kind: "approval_resolved"; requestId: string; approved: boolean }
  | { kind: "cost"; cost: CostSnapshot }
  | { kind: "narration"; text: string }
  | { kind: "verdict"; verdict: Verdict }
  | { kind: "error"; message: string };

export type TimedInspectionEvent = InspectionEvent & { delayMs: number };

/** Severity ordering, for sorting findings so the worst thing is read first. */
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_RANK[b] - SEVERITY_RANK[a];
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => compareSeverity(a.severity, b.severity));
}

/**
 * Derive the overall risk from findings.
 *
 * Kept as plain, testable code rather than left to the model: the headline a
 * reviewer acts on should not be something an artifact can talk its way out of.
 * `unexploredCount` matters because coverage gaps must degrade a clean result
 * to `undetermined` rather than being silently ignored.
 */
export function deriveRisk(findings: Finding[], unexploredCount: number): RiskLevel {
  const behavioural = new Set<FindingKind>([
    "network_exfiltration",
    "credential_access",
    "process_spawn",
    "file_write",
  ]);

  const hasCritical = findings.some((f) => f.severity === "critical");
  const hasBehaviouralHigh = findings.some(
    (f) => behavioural.has(f.kind) && (f.severity === "high" || f.severity === "critical"),
  );
  if (hasCritical || hasBehaviouralHigh) return "malicious";

  const hasConcern = findings.some((f) => f.severity === "high" || f.severity === "medium");
  if (hasConcern) return "suspicious";

  // No concerns found, but the chase was incomplete: say so rather than
  // implying the artifact was cleared.
  if (unexploredCount > 0) return "undetermined";

  return "clean";
}
