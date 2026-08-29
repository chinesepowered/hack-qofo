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

export interface ToolCall {
  id: string;
  name: string;
  /** Arguments as returned by the model. May be a JSON string or an object. */
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

/**
 * Merge a streamed delta into its assembled base message.
 *
 * The harness streams partial model output as `model.message.delta` events that
 * share an `id` with the `model.message` they belong to. Text fields append;
 * tool calls accumulate by index so that argument fragments arriving across
 * several deltas reassemble into one call.
 */
export function mergeDelta(base: ModelMessageEvent, delta: ModelMessageDeltaEvent): void {
  if (delta.content) base.content = (base.content ?? "") + delta.content;
  if (delta.reasoning_content) {
    base.reasoning_content = (base.reasoning_content ?? "") + delta.reasoning_content;
  }
  if (delta.finish_reason) base.finish_reason = delta.finish_reason;

  if (delta.tool_calls?.length) {
    base.tool_calls = base.tool_calls ?? [];
    for (const incoming of delta.tool_calls) {
      const existing = base.tool_calls.find((c) => c.id === incoming.id);
      if (!existing) {
        base.tool_calls.push({ ...incoming });
        continue;
      }
      if (incoming.name) existing.name = incoming.name;
      // Argument fragments arrive as string chunks; anything else replaces.
      if (typeof incoming.arguments === "string" && typeof existing.arguments === "string") {
        existing.arguments += incoming.arguments;
      } else if (incoming.arguments !== undefined) {
        existing.arguments = incoming.arguments;
      }
    }
  }
}

/** Best-effort parse of tool-call arguments, which may arrive as a JSON string. */
export function parseToolArguments(call: ToolCall): Record<string, unknown> {
  const raw = call.arguments;
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
