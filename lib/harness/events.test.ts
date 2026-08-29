import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isDelta,
  isPausing,
  isTerminal,
  mergeDelta,
  parseToolArguments,
  type ModelMessageDeltaEvent,
  type ModelMessageEvent,
  type ToolApprovalRequiredEvent,
  type TurnDoneEvent,
} from "./events.ts";

function baseMessage(overrides: Partial<ModelMessageEvent> = {}): ModelMessageEvent {
  return {
    id: "msg_1",
    type: "model.message",
    thread_id: null,
    created_at: "2026-08-29T00:00:00Z",
    content: "",
    ...overrides,
  };
}

function delta(overrides: Partial<ModelMessageDeltaEvent> = {}): ModelMessageDeltaEvent {
  return {
    id: "msg_1",
    type: "model.message.delta",
    thread_id: null,
    created_at: "2026-08-29T00:00:00Z",
    ...overrides,
  };
}

describe("mergeDelta", () => {
  it("appends streamed text rather than replacing it", () => {
    const base = baseMessage({ content: "Inspecting" });
    mergeDelta(base, delta({ content: " the" }));
    mergeDelta(base, delta({ content: " artifact" }));
    assert.equal(base.content, "Inspecting the artifact");
  });

  it("accumulates reasoning content separately from visible content", () => {
    const base = baseMessage({ content: "visible" });
    mergeDelta(base, delta({ reasoning_content: "step 1" }));
    mergeDelta(base, delta({ reasoning_content: " step 2" }));
    assert.equal(base.content, "visible");
    assert.equal(base.reasoning_content, "step 1 step 2");
  });

  it("reassembles a tool call whose arguments arrive across several deltas", () => {
    const base = baseMessage();
    mergeDelta(base, delta({ tool_calls: [{ id: "c1", name: "run_in_sandbox", arguments: '{"cmd":' }] }));
    mergeDelta(base, delta({ tool_calls: [{ id: "c1", name: "", arguments: '"ls -la"}' }] }));

    assert.equal(base.tool_calls?.length, 1);
    assert.equal(base.tool_calls?.[0].name, "run_in_sandbox");
    assert.deepEqual(parseToolArguments(base.tool_calls![0]), { cmd: "ls -la" });
  });

  it("keeps distinct tool calls apart", () => {
    const base = baseMessage();
    mergeDelta(base, delta({ tool_calls: [{ id: "c1", name: "fetch_url" }] }));
    mergeDelta(base, delta({ tool_calls: [{ id: "c2", name: "hash_definition" }] }));
    assert.deepEqual(base.tool_calls?.map((c) => c.id), ["c1", "c2"]);
  });

  it("records the finish reason when it arrives late", () => {
    const base = baseMessage();
    mergeDelta(base, delta({ content: "done" }));
    mergeDelta(base, delta({ finish_reason: "stop" }));
    assert.equal(base.finish_reason, "stop");
  });
});

describe("parseToolArguments", () => {
  it("parses a JSON string payload", () => {
    assert.deepEqual(parseToolArguments({ id: "c", name: "n", arguments: '{"a":1}' }), { a: 1 });
  });

  it("passes an object payload through", () => {
    assert.deepEqual(parseToolArguments({ id: "c", name: "n", arguments: { a: 1 } }), { a: 1 });
  });

  it("returns an empty object for malformed JSON instead of throwing", () => {
    // A truncated or hostile argument payload must not abort an inspection.
    assert.deepEqual(parseToolArguments({ id: "c", name: "n", arguments: '{"a":' }), {});
  });

  it("returns an empty object for missing or non-object payloads", () => {
    assert.deepEqual(parseToolArguments({ id: "c", name: "n" }), {});
    assert.deepEqual(parseToolArguments({ id: "c", name: "n", arguments: "42" }), {});
    assert.deepEqual(parseToolArguments({ id: "c", name: "n", arguments: "null" }), {});
  });
});

describe("event predicates", () => {
  const approval: ToolApprovalRequiredEvent = {
    id: "e1",
    type: "tool.approval_required",
    thread_id: "t1",
    created_at: "2026-08-29T00:00:00Z",
    tool_calls: [{ id: "c1", name: "fetch_url" }],
  };

  const done: TurnDoneEvent = {
    id: "e2",
    type: "turn.done",
    thread_id: null,
    created_at: "2026-08-29T00:00:00Z",
    state: "done",
  };

  it("identifies deltas", () => {
    assert.equal(isDelta(delta()), true);
    assert.equal(isDelta(baseMessage()), false);
  });

  it("identifies events that halt the stream awaiting a client response", () => {
    assert.equal(isPausing(approval), true);
    assert.equal(isPausing(done), false);
  });

  it("identifies the terminal event", () => {
    assert.equal(isTerminal(done), true);
    assert.equal(isTerminal(approval), false);
  });
});
