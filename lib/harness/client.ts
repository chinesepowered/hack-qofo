import type { TurnEvent } from "./events.ts";

/**
 * Thin server-side client for the TrueFoundry Agent Harness HTTP API.
 *
 * Deliberately talks to the documented HTTP surface rather than wrapping a
 * language SDK, because the inspection stream has to be re-broadcast to the
 * browser as SSE anyway.
 *
 * This module must only ever be imported from server code — it holds the API
 * key, which must never reach the client bundle.
 *
 * Note: no TypeScript parameter properties in here. Node's built-in type
 * stripping runs the tests directly from source and does not support them.
 */

export interface HarnessConfig {
  baseUrl: string;
  apiKey: string;
}

export interface Session {
  id: string;
  agent_name?: string;
  created_at?: string;
}

export interface UserMessageInput {
  role: "user";
  content: string;
}

export interface ToolApprovalInput {
  type: "tool_approval";
  thread_id: string | null;
  tool_call_id: string;
  approved: boolean;
  reason?: string;
}

export interface ToolResponseInput {
  type: "tool_response";
  thread_id: string | null;
  tool_call_id: string;
  content: string;
}

export type TurnInput = UserMessageInput | ToolApprovalInput | ToolResponseInput;

export class HarnessError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "HarnessError";
    this.status = status;
  }
}

/** Guard against a stream that never terminates or floods memory. */
const MAX_SSE_BUFFER_BYTES = 1_000_000;

export function loadHarnessConfig(
  env: Record<string, string | undefined> = process.env,
): HarnessConfig | null {
  const baseUrl = env.TFY_GATEWAY_URL?.trim();
  const apiKey = env.TFY_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new HarnessError("TFY_GATEWAY_URL is not a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new HarnessError("TFY_GATEWAY_URL must use https (or point at localhost for testing)");
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

export class HarnessClient {
  private readonly config: HarnessConfig;

  constructor(config: HarnessConfig) {
    this.config = config;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  /**
   * Error text is deliberately truncated and never includes request headers,
   * so an upstream failure cannot echo the API key into logs.
   */
  private async assertOk(res: Response, action: string): Promise<void> {
    if (res.ok) return;
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 400);
    } catch {
      /* body already consumed or unreadable */
    }
    throw new HarnessError(
      `${action} failed (${res.status})${detail ? `: ${detail}` : ""}`,
      res.status,
    );
  }

  async createSession(agentName: string, signal?: AbortSignal): Promise<Session> {
    const res = await fetch(`${this.config.baseUrl}/agents/sessions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ agent_name: agentName }),
      signal,
    });
    await this.assertOk(res, "Creating session");

    const payload = (await res.json()) as { data?: Session } & Partial<Session>;
    const session = payload.data ?? (payload as Session);
    if (!session?.id) throw new HarnessError("Session response contained no id");
    return session;
  }

  /**
   * Create a turn and yield harness events as they stream in.
   *
   * Resuming after an approval or a client-side tool response uses this same
   * call with the pending responses as `input`.
   */
  async *streamTurn(
    sessionId: string,
    input: TurnInput[],
    signal?: AbortSignal,
  ): AsyncGenerator<TurnEvent> {
    const res = await fetch(
      `${this.config.baseUrl}/agents/sessions/${encodeURIComponent(sessionId)}/turns`,
      {
        method: "POST",
        headers: this.headers({ Accept: "text/event-stream" }),
        body: JSON.stringify({ input, stream: true }),
        signal,
      },
    );
    await this.assertOk(res, "Creating turn");
    if (!res.body) throw new HarnessError("Turn response had no body to stream");

    yield* parseSseStream(res.body, signal);
  }

  /** Pull a file the agent produced inside its sandbox (e.g. the report). */
  async downloadSandboxFile(
    sessionId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    const url = new URL(
      `${this.config.baseUrl}/agents/sessions/${encodeURIComponent(sessionId)}/sandbox/files`,
    );
    url.searchParams.set("path", path);

    const res = await fetch(url, { headers: this.headers(), signal });
    await this.assertOk(res, "Downloading sandbox file");
    return res.arrayBuffer();
  }
}

/**
 * Parse a `text/event-stream` body into typed harness events.
 *
 * Frames are separated by a blank line; `data:` lines within a frame join with
 * newlines. Non-JSON frames and SSE comments are skipped rather than throwing,
 * since a malformed keep-alive should not abort an inspection mid-flight.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<TurnEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) return;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      if (buffer.length > MAX_SSE_BUFFER_BYTES) {
        throw new HarnessError("Event stream exceeded the maximum buffered frame size");
      }

      let end = findFrameEnd(buffer);
      while (end !== -1) {
        const separatorLength = buffer.startsWith("\r\n\r\n", end) ? 4 : 2;
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + separatorLength);

        const event = decodeFrame(frame);
        if (event) yield event;

        end = findFrameEnd(buffer);
      }
    }

    const trailing = decodeFrame(buffer);
    if (trailing) yield trailing;
  } finally {
    await reader.cancel().catch(() => {
      /* stream already closed */
    });
  }
}

/** Index of the first frame separator, whether it is LF LF or CRLF CRLF. */
function findFrameEnd(buffer: string): number {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

function decodeFrame(frame: string): TurnEvent | null {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();

  if (!data || data === "[DONE]") return null;

  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<TurnEvent>;
    return typeof candidate.type === "string" ? (candidate as TurnEvent) : null;
  } catch {
    return null;
  }
}
