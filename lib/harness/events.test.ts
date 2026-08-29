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

  it("records the finish reason when it arrives late", () => {
    const base = baseMessage();
    mergeDelta(base, delta({ content: "done" }));
    mergeDelta(base, delta({ finish_reason: "stop" }));
    assert.equal(base.finish_reason, "stop");
  });
});

describe("mergeDelta tool calls (documented wire format)", () => {
  it("accumulates by index when later chunks omit the id", () => {
    // The documented format only guarantees an id on the first chunk; later
    // chunks carry an index and a fragment of function.arguments.
    const base = baseMessage();
    mergeDelta(
      base,
      delta({ tool_calls: [{ index: 0, id: "c1", function: { name: "run_in_sandbox", arguments: '{"cmd":' } }] }),
    );
    mergeDelta(base, delta({ tool_calls: [{ index: 0, function: { arguments: '"ls -la"}' } }] }));

    assert.equal(base.tool_calls?.length, 1);
    assert.equal(base.tool_calls?.[0].id, "c1");
    assert.equal(base.tool_calls?.[0].name, "run_in_sandbox");
    assert.deepEqual(parseToolArguments(base.tool_calls![0]), { cmd: "ls -la" });
  });

  it("keeps calls at different indexes apart even when interleaved", () => {
    const base = baseMessage();
    mergeDelta(base, delta({ tool_calls: [{ index: 0, id: "c1", function: { name: "fetch_url", arguments: '{"u":' } }] }));
    mergeDelta(base, delta({ tool_calls: [{ index: 1, id: "c2", function: { name: "hash", arguments: '{"p":' } }] }));
    mergeDelta(base, delta({ tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] }));
    mergeDelta(base, delta({ tool_calls: [{ index: 1, function: { arguments: '"b"}' } }] }));

    assert.equal(base.tool_calls?.length, 2);
    assert.deepEqual(parseToolArguments(base.tool_calls![0]), { u: "a" });
    assert.deepEqual(parseToolArguments(base.tool_calls![1]), { p: "b" });
  });

  it("starts a new call when an unseen index reuses an existing id", () => {
    const base = baseMessage();
    mergeDelta(base, delta({ tool_calls: [{ index: 0, id: "c1", function: { name: "a" } }] }));
    mergeDelta(base, delta({ tool_calls: [{ index: 1, id: "c1", function: { name: "b" } }] }));
    assert.equal(base.tool_calls?.length, 2);
  });

  it("still merges by id for streams that omit index entirely", () => {
    const base = baseMessage();
    mergeDelta(base, delta({ tool_calls: [{ id: "c1", name: "run", arguments: '{"cmd":' }] }));
    mergeDelta(base, delta({ tool_calls: [{ id: "c1", arguments: '"ls"}' }] }));
    assert.equal(base.tool_calls?.length, 1);
    assert.deepEqual(parseToolArguments(base.tool_calls![0]), { cmd: "ls" });
  });

  it("canonicalises the nested function form onto flat fields", () => {
    const base = baseMessage();
    mergeDelta(base, delta({ tool_calls: [{ index: 0, function: { name: "n", arguments: "{}" } }] }));
    assert.equal(base.tool_calls?.[0].name, "n");
    assert.equal(base.tool_calls?.[0].arguments, "{}");
  });
});

describe("parseToolArguments", () => {
  it("parses a JSON string payload from either form", () => {
    assert.deepEqual(parseToolArguments({ id: "c", name: "n", arguments: '{"a":1}' }), { a: 1 });
    assert.deepEqual(parseToolArguments({ id: "c", function: { arguments: '{"a":1}' } }), { a: 1 });
  });

  it("prefers the nested form when both are present", () => {
    assert.deepEqual(
      parseToolArguments({ id: "c", arguments: '{"a":1}', function: { arguments: '{"b":2}' } }),
      { b: 2 },
    );
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
