/**
 * Turn event types emitted by the TrueFoundry Agent Harness.
 *
 * Mirrors the documented event stream:
 * https://www.truefoundry.com/docs/agent-platform/agent-harness/sdk/turn-events-reference
 *
 * Every event carries `id`, `created_at`, and a `thread_id` that is null for
 * turn-level events and set for events belonging to a sub-agent thread. The
 * thread id is what lets the UI render each capybara in its own lane.
 */

export type TurnEventType =
  | "turn.created"
  | "turn.done"
  | "model.message"
  | "model.message.delta"
  | "tool.response"
  | "tool.approval_required"
  | "tool.response_required"
  | "thread.created"
  | "thread.done"
  | "mcp.initialize"
  | "mcp.auth_required"
  | "sandbox.created";

export type TurnState = "running" | "done" | "cancelled" | "error";
export type ThreadState = "running" | "done" | "error";

export interface BaseEvent {
  id: string;
  type: TurnEventType;
  thread_id: string | null;
  created_at: string;
}

/**
 * Nested function payload, OpenAI-style.
 *
 * Streamed argument fragments arrive here rather than on the tool call itself,
 * which is why `parseToolArguments` has to look in both places.
 */
export interface ToolCallFunction {
  name?: string;
  arguments?: string;
}

/**
 * A tool call, as it appears on the wire.
 *
 * Streamed chunks are accumulated by `index`, not by `id`: only the first chunk
 * for a given call is guaranteed to carry an id, and later chunks may carry
 * nothing but an index and a fragment of `function.arguments`. Matching on id
 * alone splits one call into several entries and loses arguments.
 */
export interface ToolCall {
  index?: number;
  id?: string;
  /** Flat form, and where `mergeDelta` canonicalises the name to. */
  name?: string;
  function?: ToolCallFunction;
  /** Flat form, and where `mergeDelta` canonicalises argument text to. */
  arguments?: unknown;
  source_event_id?: string;
}

export interface TurnCreatedEvent extends BaseEvent {
  type: "turn.created";
  turn_id: string;
  previous_turn_id: string | null;
  state: TurnState;
  created_by?: string;
}

export interface TurnDoneEvent extends BaseEvent {
  type: "turn.done";
  state: TurnState;
  error?: string;
}

export interface ModelMessageEvent extends BaseEvent {
  type: "model.message";
  content: string;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  finish_reason?: string;
}

export interface ModelMessageDeltaEvent extends BaseEvent {
  type: "model.message.delta";
  content?: string;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  finish_reason?: string;
}

export interface ToolResponseEvent extends BaseEvent {
  type: "tool.response";
  tool_call_id: string;
  content: string;
}

export interface ToolApprovalRequiredEvent extends BaseEvent {
  type: "tool.approval_required";
  tool_calls: ToolCall[];
}

export interface ToolResponseRequiredEvent extends BaseEvent {
  type: "tool.response_required";
  tool_calls: ToolCall[];
}

export interface ThreadCreatedEvent extends BaseEvent {
  type: "thread.created";
  title?: string;
  parent?: string | null;
  agent_info?: { name?: string; description?: string };
}

export interface ThreadDoneEvent extends BaseEvent {
  type: "thread.done";
  state: ThreadState;
  output?: string;
  error?: string;
}

export interface McpInitializeEvent extends BaseEvent {
  type: "mcp.initialize";
  mcp_servers: Array<{ name: string; session_id?: string }>;
}

export interface McpAuthRequiredEvent extends BaseEvent {
  type: "mcp.auth_required";
  mcp_servers: Array<{ id: string; name: string; auth_url: string }>;
}

export interface SandboxCreatedEvent extends BaseEvent {
  type: "sandbox.created";
  sandbox_id: string;
}

export type TurnEvent =
  | TurnCreatedEvent
  | TurnDoneEvent
  | ModelMessageEvent
  | ModelMessageDeltaEvent
  | ToolResponseEvent
  | ToolApprovalRequiredEvent
  | ToolResponseRequiredEvent
  | ThreadCreatedEvent
  | ThreadDoneEvent
  | McpInitializeEvent
  | McpAuthRequiredEvent
  | SandboxCreatedEvent;

/** Events that halt the stream until the client sends something back. */
export type PausingEvent =
  | ToolApprovalRequiredEvent
  | ToolResponseRequiredEvent
  | McpAuthRequiredEvent;

export function isDelta(event: TurnEvent): event is ModelMessageDeltaEvent {
  return event.type === "model.message.delta";
}

export function isPausing(event: TurnEvent): event is PausingEvent {
  return (
    event.type === "tool.approval_required" ||
    event.type === "tool.response_required" ||
    event.type === "mcp.auth_required"
  );
}

export function isTerminal(event: TurnEvent): boolean {
  return event.type === "turn.done";
}

/** Name from either the flat or the nested form. */
function toolCallName(call: ToolCall): string | undefined {
  return call.function?.name ?? call.name;
}

/** Argument text from either form, when it is a string fragment. */
function toolCallArgumentText(call: ToolCall): string | undefined {
  if (typeof call.function?.arguments === "string") return call.function.arguments;
  if (typeof call.arguments === "string") return call.arguments;
  return undefined;
}

/**
 * Locate the accumulator entry a streamed chunk belongs to.
 *
 * Index is authoritative because it is present on every chunk. Id is only a
 * fallback for streams that omit index, and is checked second so that a chunk
 * carrying both cannot be matched to the wrong entry.
 */
function findTarget(existing: ToolCall[], incoming: ToolCall): ToolCall | undefined {
  if (typeof incoming.index === "number") {
    const byIndex = existing.find((c) => c.index === incoming.index);
    if (byIndex) return byIndex;
    // An index that has not been seen starts a new call, even if an id matches.
    return undefined;
  }
  if (incoming.id) return existing.find((c) => c.id === incoming.id);
  return undefined;
}

/**
 * Merge a streamed delta into its assembled base message.
 *
 * Text fields append. Tool calls accumulate by index so that argument fragments
 * arriving across several chunks reassemble into one call, and are canonicalised
 * onto the flat `name` / `arguments` fields so consumers do not have to know
 * which form the gateway used.
 */
export function mergeDelta(base: ModelMessageEvent, delta: ModelMessageDeltaEvent): void {
  if (delta.content) base.content = (base.content ?? "") + delta.content;
  if (delta.reasoning_content) {
    base.reasoning_content = (base.reasoning_content ?? "") + delta.reasoning_content;
  }
  if (delta.finish_reason) base.finish_reason = delta.finish_reason;

  if (!delta.tool_calls?.length) return;

  base.tool_calls = base.tool_calls ?? [];

  for (const incoming of delta.tool_calls) {
    const existing = findTarget(base.tool_calls, incoming);

    if (!existing) {
      base.tool_calls.push({
        index: incoming.index,
        id: incoming.id,
        name: toolCallName(incoming),
        arguments: toolCallArgumentText(incoming) ?? incoming.arguments,
        source_event_id: incoming.source_event_id,
      });
      continue;
    }

    // Only the first chunk is guaranteed to carry these.
    if (incoming.id) existing.id = incoming.id;
    if (incoming.source_event_id) existing.source_event_id = incoming.source_event_id;

    const name = toolCallName(incoming);
    if (name) existing.name = name;

    const fragment = toolCallArgumentText(incoming);
    if (fragment !== undefined) {
      existing.arguments =
        typeof existing.arguments === "string" ? existing.arguments + fragment : fragment;
    } else if (incoming.arguments !== undefined) {
      // A non-string payload is a complete value, not a fragment.
      existing.arguments = incoming.arguments;
    }
  }
}

/** Best-effort parse of tool-call arguments, which may arrive as a JSON string. */
export function parseToolArguments(call: ToolCall): Record<string, unknown> {
  const raw = call.function?.arguments ?? call.arguments;
  if (raw == null) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
