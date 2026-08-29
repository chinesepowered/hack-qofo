import type { Finding } from "./types.ts";

/**
 * Definition pinning — the defence against sleeper rug-pulls.
 *
 * The `postmark-mcp` incident is the reference case: the package was benign for
 * fifteen versions and then v1.0.16 added a silent BCC of every email to an
 * attacker domain. Nothing was wrong at approval time, which is the entire
 * design of the attack. Scanning once at install cannot catch it.
 *
 * So we record a hash of exactly what was approved, per tool where the artifact
 * exposes tools, and re-check it. A definition that changes after approval is
 * reported as drift, and drift on a tool *description* is treated as more
 * serious than drift on a schema: descriptions are what steer the model, which
 * is what makes them the tool-poisoning surface.
 */

export interface ToolFingerprint {
  name: string;
  /** Hash of the description alone — the prompt-injection surface. */
  descriptionHash: string;
  /** Hash of the parameter schema alone. */
  schemaHash: string;
}

export interface DefinitionPin {
  artifactId: string;
  /** Hash of the whole artifact as approved. */
  hash: string;
  algorithm: "SHA-256";
  pinnedAt: string;
  /** Present when the artifact declares tools. */
  tools?: ToolFingerprint[];
}

export interface DriftResult {
  changed: boolean;
  findings: Finding[];
}

const encoder = new TextEncoder();

/**
 * Hash raw bytes, with no normalisation.
 *
 * Normalising first (trimming whitespace, collapsing case) would let an
 * attacker craft two definitions that hash alike but read differently to a
 * model. Byte-exact is the only honest comparison here; the cost is that a
 * reformat shows up as drift, which is the safe direction to be wrong in.
 */
export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface DeclaredTool {
  name?: unknown;
  description?: unknown;
  /** MCP's own name for the argument schema. */
  inputSchema?: unknown;
  /** OpenAI-style function calling uses this name instead. */
  parameters?: unknown;
}

/**
 * The argument schema, under whichever key the document uses.
 *
 * The MCP specification calls this `inputSchema`; OpenAI-style tool
 * definitions call it `parameters`. Reading only one of them silently hashes
 * every schema as `null`, which would make schema drift invisible and quietly
 * downgrade a rug-pull to generic medium drift.
 */
function argumentSchema(tool: DeclaredTool): unknown {
  return tool.inputSchema ?? tool.parameters ?? null;
}

/**
 * Pull per-tool fingerprints out of an MCP server definition.
 *
 * Returns undefined for anything that is not a tool-declaring JSON document,
 * which is the common case for a SKILL.md.
 */
export async function fingerprintTools(source: string): Promise<ToolFingerprint[] | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== "object") return undefined;
  const tools = (parsed as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return undefined;

  const fingerprints: ToolFingerprint[] = [];
  for (const entry of tools) {
    if (!entry || typeof entry !== "object") continue;
    const tool = entry as DeclaredTool;
    const name = typeof tool.name === "string" ? tool.name : "(unnamed)";
    fingerprints.push({
      name,
      descriptionHash: await sha256(typeof tool.description === "string" ? tool.description : ""),
      schemaHash: await sha256(JSON.stringify(argumentSchema(tool))),
    });
  }
  return fingerprints;
}

export async function pinDefinition(
  artifactId: string,
  source: string,
  pinnedAt: string,
): Promise<DefinitionPin> {
  return {
    artifactId,
    hash: await sha256(source),
    algorithm: "SHA-256",
    pinnedAt,
    tools: await fingerprintTools(source),
  };
}

let driftFindingSeq = 0;
function driftFinding(finding: Omit<Finding, "id">): Finding {
  driftFindingSeq += 1;
  return { id: `drift-${driftFindingSeq}`, ...finding };
}

/**
 * Compare a newly seen definition against what was approved.
 *
 * Reported severities reflect what each kind of change can actually do:
 *   - a new tool appearing is `critical`; it was never reviewed at all
 *   - a changed description is `critical`; that is the model-steering surface
 *   - a changed schema is `high`
 *   - a removed tool is `medium`; suspicious, but not directly exploitable
 *   - a whole-artifact hash change with no tool-level explanation is `medium`
 */
export function detectDrift(approved: DefinitionPin, current: DefinitionPin): DriftResult {
  if (approved.hash === current.hash) return { changed: false, findings: [] };

  const findings: Finding[] = [];
  const approvedTools = new Map((approved.tools ?? []).map((t) => [t.name, t]));
  const currentTools = new Map((current.tools ?? []).map((t) => [t.name, t]));

  for (const [name, tool] of currentTools) {
    const before = approvedTools.get(name);

    if (!before) {
      findings.push(
        driftFinding({
          kind: "definition_drift",
          severity: "critical",
          observed: `Tool "${name}" appeared after approval and has never been reviewed.`,
          evidence: `Approved pin ${approved.hash.slice(0, 12)}… declared no tool named "${name}".`,
          confidence: "high",
          reportedBy: "yuzu",
        }),
      );
      continue;
    }

    if (before.descriptionHash !== tool.descriptionHash) {
      findings.push(
        driftFinding({
          kind: "tool_poisoning",
          severity: "critical",
          observed: `The description of "${name}" changed after approval. Tool descriptions steer the model, so this is the tool-poisoning surface.`,
          evidence: `description hash ${before.descriptionHash.slice(0, 12)}… → ${tool.descriptionHash.slice(0, 12)}…`,
          confidence: "high",
          reportedBy: "momo",
        }),
      );
    }

    if (before.schemaHash !== tool.schemaHash) {
      findings.push(
        driftFinding({
          kind: "definition_drift",
          severity: "high",
          observed: `The parameter schema of "${name}" changed after approval.`,
          evidence: `schema hash ${before.schemaHash.slice(0, 12)}… → ${tool.schemaHash.slice(0, 12)}…`,
          confidence: "high",
          reportedBy: "momo",
        }),
      );
    }
  }

  for (const name of approvedTools.keys()) {
    if (currentTools.has(name)) continue;
    findings.push(
      driftFinding({
        kind: "definition_drift",
        severity: "medium",
        observed: `Tool "${name}" was removed after approval.`,
        evidence: `Approved pin ${approved.hash.slice(0, 12)}… declared "${name}"; the current definition does not.`,
        confidence: "high",
        reportedBy: "momo",
      }),
    );
  }

  if (findings.length === 0) {
    findings.push(
      driftFinding({
        kind: "definition_drift",
        severity: "medium",
        observed:
          "The artifact changed after approval, but not in a way that maps to a specific tool. Re-inspection is required.",
        evidence: `artifact hash ${approved.hash.slice(0, 12)}… → ${current.hash.slice(0, 12)}…`,
        confidence: "high",
        reportedBy: "momo",
      }),
    );
  }

  return { changed: true, findings };
}
