import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDeniedVerdict, pendingHops } from "./denial.ts";
import { getReplayTrace } from "./replay.ts";
import type { ApprovalRequest, ChainHop, Finding } from "./types.ts";

const HASH = "b".repeat(64);

const REQUEST: ApprovalRequest = {
  id: "a1",
  toolCallId: "call_1",
  threadId: "t1",
  title: "Nibbles wants to leave the sandbox",
  plainLanguage: "…",
  destination: "cdn.devtools-quickstart.example.com",
  payloadPreview: "GET /v2/setup-instructions.txt",
  risk: "medium",
};

function finding(id: string, severity: Finding["severity"]): Finding {
  return {
    id,
    kind: "hidden_instructions",
    severity,
    observed: "o",
    evidence: "e",
    confidence: "high",
    reportedBy: "momo",
  };
}

function hop(id: string, status: ChainHop["status"]): ChainHop {
  return {
    id,
    hop: 1,
    source: "s",
    target: `https://example.com/${id}`,
    label: id,
    kind: "url",
    status,
    parentId: "h0",
  };
}

describe("buildDeniedVerdict", () => {
  it("reports nothing at all when the denial came before any finding", () => {
    const verdict = buildDeniedVerdict({
      observed: [],
      pendingHops: [],
      request: REQUEST,
      definitionHash: HASH,
    });

    assert.equal(verdict.findings.length, 0);
    assert.equal(verdict.risk, "undetermined");
    assert.match(verdict.summary, /not a clean result, it is an absent one/);
  });

  it("never reports a clean result, because coverage is always missing", () => {
    const verdict = buildDeniedVerdict({
      observed: [],
      pendingHops: [],
      request: REQUEST,
      definitionHash: HASH,
    });
    assert.notEqual(verdict.risk, "clean");
  });

  it("cites only findings that were observed before the gate", () => {
    const observed = [finding("f1", "medium")];
    const verdict = buildDeniedVerdict({
      observed,
      pendingHops: [],
      request: REQUEST,
      definitionHash: HASH,
    });

    assert.deepEqual(verdict.findings.map((f) => f.id), ["f1"]);
    assert.equal(verdict.risk, "suspicious");
  });

  it("records the denied step and every unreached hop as unexplored", () => {
    const verdict = buildDeniedVerdict({
      observed: [],
      pendingHops: [hop("h1", "pending"), hop("h2", "following")],
      request: REQUEST,
      definitionHash: HASH,
    });

    assert.equal(verdict.unexplored.length, 3);
    assert.match(verdict.unexplored[0], /denied this step/);
    assert.ok(verdict.unexplored.some((u) => u.includes("h1")));
    assert.ok(verdict.unexplored.some((u) => u.includes("h2")));
  });

  it("carries the artifact hash, which is not behavioural evidence", () => {
    const verdict = buildDeniedVerdict({
      observed: [],
      pendingHops: [],
      request: REQUEST,
      definitionHash: HASH,
    });
    assert.equal(verdict.definitionHash, HASH);
  });

  it("never inherits the unplayed trace's conclusions", () => {
    // The regression this function exists to prevent: denying the first gate
    // of the multi-hop sample must not report the credential theft and
    // exfiltration that only happen further down a branch that never ran.
    const trace = getReplayTrace("devtools-quickstart")!;
    const gateIndex = trace.findIndex((e) => e.kind === "approval_required");
    assert.ok(gateIndex > 0, "sample should pause at an approval");

    const observed = trace
      .slice(0, gateIndex)
      .filter((e) => e.kind === "finding")
      .map((e) => (e.kind === "finding" ? e.finding : null))
      .filter((f): f is Finding => f !== null);

    const verdict = buildDeniedVerdict({
      observed,
      pendingHops: [],
      request: REQUEST,
      definitionHash: HASH,
    });

    const kinds = new Set(verdict.findings.map((f) => f.kind));
    assert.ok(!kinds.has("network_exfiltration"), "must not report exfiltration that never ran");
    assert.ok(!kinds.has("credential_access"), "must not report credential access that never ran");
    assert.notEqual(verdict.risk, "malicious");

    const full = trace.find((e) => e.kind === "verdict");
    assert.ok(full && full.kind === "verdict");
    assert.equal(full.verdict.risk, "malicious");
    assert.notEqual(verdict.risk, full.verdict.risk);
  });
});

describe("pendingHops", () => {
  it("selects only hops that were never followed", () => {
    const hops = [
      hop("a", "followed"),
      hop("b", "pending"),
      hop("c", "following"),
      hop("d", "unexplored"),
      hop("e", "blocked"),
    ];
    assert.deepEqual(pendingHops(hops).map((h) => h.id), ["b", "c"]);
  });
});
