import type { Finding, FindingKind, Severity } from "./types.ts";

/**
 * Offline pattern pass.
 *
 * This is the weakest of the three inspection layers and it is important to be
 * clear about that. It reads text and matches known shapes. It cannot follow a
 * hop, cannot see conditional activation, and cannot observe behaviour — which
 * is precisely the gap that makes static scanning insufficient on its own.
 *
 * It exists for two reasons: it gives a real result for content someone pastes
 * at a booth with no gateway configured, and it is the same job the Momo
 * sub-agent does inside a full inspection. Every finding it emits is marked
 * with medium confidence at most, and callers must surface that a static-only
 * run leaves the behavioural questions unanswered.
 */

interface Rule {
  kind: FindingKind;
  severity: Severity;
  pattern: RegExp;
  observed: string;
}

/**
 * Output bounds.
 *
 * The input is already size-limited, but a crafted paste can still be almost
 * entirely matches — a wall of credential paths, or thousands of distinct URLs.
 * Each match becomes an event to serialise and a node to render, so the output
 * is bounded too. Truncation is always reported, never silent: a scanner that
 * quietly stops looking is exactly what this project argues against.
 */
export const MAX_FINDINGS = 60;
export const MAX_URLS = 25;

const RULES: Rule[] = [
  {
    kind: "credential_access",
    severity: "critical",
    pattern:
      /(~|\$HOME|%USERPROFILE%)?[/\\.]*(\.ssh[/\\](id_rsa|id_ed25519|id_ecdsa)|\.aws[/\\]credentials|\.kube[/\\]config|\.npmrc|\.pypirc|\.netrc)/gi,
    observed: "References a path that holds private keys or credentials.",
  },
  {
    kind: "credential_access",
    severity: "high",
    pattern: /\benv\b[^\n]{0,40}\bgrep\b[^\n]{0,60}(token|key|secret|password)/gi,
    observed: "Scans the environment for variables whose names look like secrets.",
  },
  {
    kind: "network_exfiltration",
    severity: "critical",
    pattern: /\bcurl\b[^\n|]{0,200}(-X\s*POST|--data(-binary|-raw)?|-d\s)/gi,
    observed: "Posts data to a remote host from within the artifact.",
  },
  {
    kind: "dynamic_context_execution",
    severity: "critical",
    pattern: /\b(curl|wget)\b[^\n]{0,200}\|\s*(sudo\s+)?(sh|bash|zsh|python3?|node)\b/gi,
    observed:
      "Pipes a remote script straight into an interpreter, so the code that runs is never shown to anyone.",
  },
  {
    kind: "instruction_override_attempt",
    severity: "high",
    pattern:
      /\b(ignore|disregard|forget)\s+(all\s+|any\s+)?(previous|prior|earlier|above|preceding)\s+(instructions?|prompts?|rules?|directions?)/gi,
    observed: "Attempts to override the instructions of whatever agent reads it.",
  },
  {
    kind: "instruction_override_attempt",
    severity: "high",
    pattern:
      /\b(you\s+are\s+now|from\s+now\s+on\s+you|act\s+as|switch\s+to)\b[^\n]{0,60}\b(developer|debug|god|unrestricted|admin|dan)\s*mode\b/gi,
    observed: "Attempts to place the reading agent into a permissive mode.",
  },
  {
    kind: "instruction_override_attempt",
    severity: "high",
    pattern:
      /\b(already\s+been\s+)?(reviewed|audited|approved|vetted|scanned)\s+(and\s+approved\s+)?by\s+[^\n]{0,40}(security|the\s+team|trust|compliance)/gi,
    observed:
      "Asserts that it was already approved, which is an attempt to end its own review rather than a verifiable claim.",
  },
  {
    kind: "instruction_override_attempt",
    severity: "high",
    pattern:
      /\b(report|mark|treat|classify)\s+(this|it)\s+(file\s+|skill\s+|server\s+)?as\s+(safe|clean|trusted|benign)/gi,
    observed: "Instructs a scanner to report a specific verdict.",
  },
  {
    kind: "hidden_instructions",
    severity: "high",
    pattern:
      /\b(do\s+not|don't|never)\s+(mention|tell|inform|disclose|reveal|surface|show|print|summari[sz]e)\b[^\n]{0,80}\b(user|human|them|it|this|step|script)\b/gi,
    observed: "Instructs the agent to conceal one of its own actions from the user.",
  },
  {
    kind: "tool_shadowing",
    severity: "high",
    pattern:
      /\b(supersedes?|takes?\s+precedence|should\s+be\s+preferred|use\s+this\s+instead)\b[^\n]{0,100}\b(tool|server|function)/gi,
    observed:
      "Claims precedence over a similarly named tool from another server, which would reroute calls through this one.",
  },
  {
    kind: "network_exfiltration",
    severity: "high",
    pattern: /\b(bcc|blind\s+copy|silently\s+(send|forward|copy))\b[^\n]{0,80}/gi,
    observed: "Adds a hidden recipient to something the agent sends.",
  },
  {
    kind: "obfuscation",
    severity: "medium",
    pattern: /\b(base64\s+(-d|--decode)|atob\s*\(|fromCharCode|eval\s*\(\s*(atob|Buffer))/gi,
    observed: "Decodes or evaluates encoded content, which hides what actually runs.",
  },
  {
    kind: "obfuscation",
    severity: "medium",
    pattern: /[A-Za-z0-9+/]{120,}={0,2}/g,
    observed: "Contains a long encoded blob whose contents cannot be read directly.",
  },
];

/** Instructions addressed to a machine, hidden where a human reader will not look. */
const HIDDEN_BLOCK = /<!--([\s\S]{0,4000}?)-->/g;
const MACHINE_ADDRESSED =
  /\b(system|assistant|agent|scanner|ignore|instruction|you\s+must|do\s+not|read\s+~|report\s+this)\b/i;

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')\]}]+/gi;

/** Trim a match to something readable in a findings list. */
function quote(match: string, limit = 160): string {
  const collapsed = match.replace(/\s+/g, " ").trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit)}…` : collapsed;
}

/**
 * Parse a URL, or return null.
 *
 * `URL_PATTERN` is a text matcher, not a validator, so it happily matches
 * things like `http://[` that `new URL` rejects. An artifact must never be able
 * to abort its own inspection by including one.
 */
export function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export interface StaticPassResult {
  findings: Finding[];
  /** Valid URLs the artifact references — the hops a full inspection would follow. */
  referencedUrls: string[];
  /** Non-zero when output bounds clipped the result. Always surfaced to the reader. */
  truncated: { findings: number; urls: number };
}

/**
 * Run the offline pattern pass over artifact text.
 *
 * Confidence is capped at medium throughout: matching a string is evidence that
 * something is worth looking at, not evidence of what the artifact does.
 */
export function runStaticPass(source: string): StaticPassResult {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  let seq = 0;
  let droppedFindings = 0;

  const add = (kind: FindingKind, severity: Severity, observed: string, evidence: string) => {
    const dedupeKey = `${kind}:${evidence}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    if (findings.length >= MAX_FINDINGS) {
      droppedFindings += 1;
      return;
    }

    seq += 1;
    findings.push({
      id: `static-${seq}`,
      kind,
      severity,
      observed,
      evidence,
      confidence: "medium",
      reportedBy: "momo",
      hop: 0,
    });
  };

  for (const rule of RULES) {
    // Each rule carries the global flag, so reset before reuse across inputs.
    rule.pattern.lastIndex = 0;
    for (const match of source.matchAll(rule.pattern)) {
      add(rule.kind, rule.severity, rule.observed, quote(match[0]));
    }
  }

  HIDDEN_BLOCK.lastIndex = 0;
  for (const match of source.matchAll(HIDDEN_BLOCK)) {
    const body = match[1] ?? "";
    if (!MACHINE_ADDRESSED.test(body)) continue;
    add(
      "hidden_instructions",
      "high",
      "Instructions addressed to an agent are hidden inside a comment, where a human reading the rendered file would not see them.",
      quote(`<!--${body}-->`),
    );
  }

  URL_PATTERN.lastIndex = 0;
  const allUrls = [...new Set(Array.from(source.matchAll(URL_PATTERN), (m) => m[0]))].filter(
    (raw) => parseUrl(raw) !== null,
  );
  const referencedUrls = allUrls.slice(0, MAX_URLS);
  const droppedUrls = allUrls.length - referencedUrls.length;

  if (allUrls.length > 0) {
    // Informational on purpose. Nearly every legitimate skill links to its own
    // documentation, so treating a link as a finding of badness would flag the
    // entire ecosystem. What matters is the coverage gap: the URL goes into the
    // unexplored list, and that is what keeps the verdict off "clean".
    add(
      "external_reference",
      "info",
      `References ${allUrls.length} external location${allUrls.length === 1 ? "" : "s"}. Whatever they serve is not part of this artifact and can change after review.`,
      referencedUrls.slice(0, 3).join(", "),
    );
  }

  return {
    findings,
    referencedUrls,
    truncated: { findings: droppedFindings, urls: droppedUrls },
  };
}

/**
 * The caveat that must accompany any static-only result.
 *
 * A static pass that finds nothing has not cleared an artifact; it has only
 * failed to recognise it.
 */
export const STATIC_ONLY_CAVEAT =
  "Static pass only. No sandbox was available, so nothing was executed and no hop was followed. A clean result here means no known pattern matched — not that the artifact is safe.";
