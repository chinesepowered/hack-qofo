import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { REPLAY_TRACES, getReplayTrace } from "./replay.ts";
import { SAMPLE_ARTIFACTS } from "./samples.ts";
import { deriveRisk, sortFindings, type Finding, type Severity } from "./types.ts";

function finding(severity: Severity, kind: Finding["kind"] = "hidden_instructions"): Finding {
  return {
    id: `f-${severity}-${kind}`,
    kind,
    severity,
    observed: "o",
    evidence: "e",
    confidence: "high",
    reportedBy: "momo",
  };
}

describe("deriveRisk", () => {
  it("returns clean only when there is nothing to report and nothing was skipped", () => {
    assert.equal(deriveRisk([], 0), "clean");
    assert.equal(deriveRisk([finding("info")], 0), "clean");
  });

  it("degrades a clean result to undetermined when hops were left unexplored", () => {
    // Coverage gaps must never be presented as a clearance.
    assert.equal(deriveRisk([], 1), "undetermined");
    assert.equal(deriveRisk([finding("info")], 2), "undetermined");
  });

  it("treats any critical finding as malicious", () => {
    assert.equal(deriveRisk([finding("critical")], 0), "malicious");
  });

  it("treats a high-severity observed behaviour as malicious", () => {
    assert.equal(deriveRisk([finding("high", "network_exfiltration")], 0), "malicious");
    assert.equal(deriveRisk([finding("high", "credential_access")], 0), "malicious");
  });

  it("treats a high-severity textual finding as suspicious rather than malicious", () => {
    // Reading something alarming is weaker evidence than watching it happen.
    assert.equal(deriveRisk([finding("high", "hidden_instructions")], 0), "suspicious");
  });

  it("treats medium findings as suspicious", () => {
    assert.equal(deriveRisk([finding("medium")], 0), "suspicious");
  });

  it("does not let unexplored hops downgrade a real verdict", () => {
    assert.equal(deriveRisk([finding("critical")], 3), "malicious");
    assert.equal(deriveRisk([finding("medium")], 3), "suspicious");
  });
});

describe("sortFindings", () => {
  it("puts the most severe finding first and does not mutate the input", () => {
    const input = [finding("low"), finding("critical"), finding("medium")];
    const sorted = sortFindings(input);
    assert.deepEqual(sorted.map((f) => f.severity), ["critical", "medium", "low"]);
    assert.deepEqual(input.map((f) => f.severity), ["low", "critical", "medium"]);
  });
});

describe("replay traces", () => {
  it("provides a trace for every sample artifact", () => {
    for (const sample of SAMPLE_ARTIFACTS) {
      assert.ok(getReplayTrace(sample.id), `missing replay trace for ${sample.id}`);
    }
  });

  it("returns null for an unknown artifact", () => {
    assert.equal(getReplayTrace("does-not-exist"), null);
  });

  it("returns a fresh array each call so one playthrough cannot mutate the next", () => {
    const a = getReplayTrace("tidy-dates");
    const b = getReplayTrace("tidy-dates");
    assert.notEqual(a, b);
    assert.deepEqual(a, b);
  });

  for (const id of Object.keys(REPLAY_TRACES)) {
    describe(id, () => {
      const events = getReplayTrace(id)!;

      it("starts with a started event and ends with a verdict", () => {
        assert.equal(events[0].kind, "started");
        assert.equal(events.at(-1)?.kind, "verdict");
      });

      it("emits exactly one verdict", () => {
        assert.equal(events.filter((e) => e.kind === "verdict").length, 1);
      });

      it("never references a hop before it is discovered", () => {
        const known = new Set<string>();
        for (const event of events) {
          if (event.kind === "hop_discovered") known.add(event.hop.id);
          if (event.kind === "hop_updated") {
            assert.ok(known.has(event.hopId), `${id}: hop_updated before hop_discovered for ${event.hopId}`);
          }
        }
      });

      it("gives every event a non-negative delay", () => {
        for (const event of events) assert.ok(event.delayMs >= 0);
      });

      it("agrees with deriveRisk on its own verdict", () => {
        // The narrative traces must not claim a risk level the scoring rules
        // would not produce from the same findings.
        const verdictEvent = events.find((e) => e.kind === "verdict");
        assert.ok(verdictEvent && verdictEvent.kind === "verdict");
        const { findings, unexplored, risk } = verdictEvent.verdict;
        assert.equal(risk, deriveRisk(findings, unexplored.length));
      });

      it("uses a well-formed definition hash", () => {
        const verdictEvent = events.find((e) => e.kind === "verdict");
        assert.ok(verdictEvent && verdictEvent.kind === "verdict");
        assert.match(verdictEvent.verdict.definitionHash, /^[0-9a-f]{64}$/);
      });

      it("only cites findings that were streamed during the run", () => {
        const streamed = new Set(
          events.filter((e) => e.kind === "finding").map((e) => (e.kind === "finding" ? e.finding.id : "")),
        );
        const verdictEvent = events.find((e) => e.kind === "verdict");
        assert.ok(verdictEvent && verdictEvent.kind === "verdict");
        for (const f of verdictEvent.verdict.findings) {
          assert.ok(streamed.has(f.id), `${id}: verdict cites finding ${f.id} that was never streamed`);
        }
      });
    });
  }
});
