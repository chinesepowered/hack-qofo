import type { TurnEvent } from "./events.ts";

/**
 * Server-side client for the TrueForge agent harness.
 *
 * TrueForge is the open-source harness that TrueFoundry's managed Agent
 * Harness is built on. It runs standalone on a developer machine — SQLite, no
 * account, no gateway, no tenant — and serves both a chat UI and an HTTP API
 * on http://localhost:8790 by default.
 *
 * Endpoints follow the published OpenAPI surface under /api/v1. Standalone
 * deployments accept requests without credentials; when OIDC is configured,
 * routes want an ID token as a bearer. There is no API-key scheme, so
 * TRUEFORGE_TOKEN is optional and omitted entirely when unset.
 *
 * This module must only ever be imported from server code — it can hold a
 * token, which must never reach the client bundle.
 *
 * Note: no TypeScript parameter properties in here. Node's built-in type
 * stripping runs the tests directly from source and does not support them.
 */

export const DEFAULT_TRUEFORGE_BASE_URL = "http://localhost:8790";

export interface HarnessConfig {
  baseUrl: string;
  /** Absent in standalone (no-login) mode, which is the common case. */
  token?: string;
}

export interface Session {
  id: string;
  title?: string;
  created_at?: string;
}

/** Input items accepted by POST /api/v1/sessions/{id}/turns. */
export interface UserMessageInput {
  type: "user.message";
  content: string;
}

export interface ToolApprovalInput {
  type: "user.tool_approval";
  thread_id: string | null;
  tool_call_id: string;
  status: "allow" | "deny";
  reason?: string;
}

export interface ToolResponseInput {
  type: "user.tool_response";
  thread_id: string | null;
  tool_call_id: string;
  content: string;
}

export type TurnInput = UserMessageInput | ToolApprovalInput | ToolResponseInput;

/** Reference an agent by saved name, or inline its spec for a one-off run. */
export type AgentRef = { name: string } | { spec: Record<string, unknown> };

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

/** Cap on any single file pulled out of a sandbox. */
export const MAX_SANDBOX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Counters for things that went wrong without stopping the stream.
 *
 * A dropped frame is not cosmetic: it may have carried the one observation that
 * would have changed a verdict. Callers must treat a non-zero
 * `malformedFrames` as a coverage gap and degrade the result to
 * `undetermined` rather than reporting a clean inspection.
 */
export interface StreamDiagnostics {
  malformedFrames: number;
}

export function newStreamDiagnostics(): StreamDiagnostics {
  return { malformedFrames: 0 };
}

export interface StreamOptions {
  signal?: AbortSignal;
  diagnostics?: StreamDiagnostics;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLoopback(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * Read harness configuration from the environment.
 *
 * Returns null when TRUEFORGE_BASE_URL is unset, so the app stays offline-first:
 * without an explicitly configured harness, samples replay and pasted artifacts
 * get the static pass rather than erroring against a server nobody started.
 */
export function loadHarnessConfig(
  env: Record<string, string | undefined> = process.env,
): HarnessConfig | null {
  const baseUrl = env.TRUEFORGE_BASE_URL?.trim();
  if (!baseUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new HarnessError("TRUEFORGE_BASE_URL is not a valid URL");
  }

  const token = env.TRUEFORGE_TOKEN?.trim() || undefined;

  // A token over plaintext to a non-loopback host would put it on the wire.
  // Standalone TrueForge is http on localhost and carries no token, which is
  // fine; anything else must be https.
  if (parsed.protocol !== "https:" && !isLoopback(parsed)) {
    throw new HarnessError(
      "TRUEFORGE_BASE_URL must use https unless it points at loopback (TrueForge standalone runs on http://localhost:8790)",
    );
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
}

/**
 * Strip credentials from text that came back from upstream.
 *
 * A proxy that echoes the Authorization header into its error body would
 * otherwise copy the token straight into our logs. The literal token is removed
 * first, then anything that still looks like a bearer token.
 */
export function redactSecrets(text: string, token?: string): string {
  let out = text;
  if (token) out = out.split(token).join("[redacted]");
  return (
    out
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
      // The label may be quoted, as in a JSON body: {"api_key": "…"}.
      .replace(
        /\b(api[_-]?key|token|secret)\b"?\s*[:=]\s*"?[A-Za-z0-9._~+/-]{8,}"?/gi,
        "$1: [redacted]",
      )
  );
}

export class HarnessClient {
  private readonly config: HarnessConfig;

  constructor(config: HarnessConfig) {
    this.config = config;
  }

  private url(path: string): string {
    return `${this.config.baseUrl}/api/v1${path}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "Content-Type": "application/json",
      // Omitted entirely in standalone mode — TrueForge has no API-key scheme.
      ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
      ...extra,
    };
  }

  /**
   * Error text is truncated and redacted, and never includes request headers,
   * so an upstream failure cannot echo a token into logs.
   */
  private async assertOk(res: Response, action: string): Promise<void> {
    if (res.ok) return;
    let detail = "";
    try {
      detail = redactSecrets((await res.text()).slice(0, 400), this.config.token);
    } catch {
      /* body already consumed or unreadable */
    }
    throw new HarnessError(
      `${action} failed (${res.status})${detail ? `: ${detail}` : ""}`,
      res.status,
    );
  }

  /** GET /api/v1/models — also the cheapest liveness check. */
  async listModels(signal?: AbortSignal): Promise<Array<{ name?: string; id?: string }>> {
    const res = await fetch(this.url("/models"), { headers: this.headers(), signal });
    await this.assertOk(res, "Listing models");
    const payload = (await res.json()) as
      | { data?: Array<{ name?: string; id?: string }> }
      | Array<{ name?: string; id?: string }>;
    return Array.isArray(payload) ? payload : (payload.data ?? []);
  }

  /** GET /api/v1/agents */
  async listAgents(signal?: AbortSignal): Promise<Array<{ name?: string; id?: string }>> {
    const res = await fetch(this.url("/agents"), { headers: this.headers(), signal });
    await this.assertOk(res, "Listing agents");
    const payload = (await res.json()) as
      | { data?: Array<{ name?: string; id?: string }> }
      | Array<{ name?: string; id?: string }>;
    return Array.isArray(payload) ? payload : (payload.data ?? []);
  }

  /** POST /api/v1/agents — stores a spec under an immutable name. */
  async createAgent(
    name: string,
    manifest: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ id?: string; name?: string }> {
    const res = await fetch(this.url("/agents"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ name, manifest }),
      signal,
    });
    await this.assertOk(res, "Creating agent");
    const payload = (await res.json()) as { data?: { id?: string; name?: string } };
    return payload.data ?? (payload as { id?: string; name?: string });
  }

  /** GET /api/v1/agents/{id} — returns the stored spec, not just the name. */
  async getAgent(
    agentId: string,
    signal?: AbortSignal,
  ): Promise<{ id?: string; name?: string; manifest?: Record<string, unknown> }> {
    const res = await fetch(this.url(`/agents/${encodeURIComponent(agentId)}`), {
      headers: this.headers(),
      signal,
    });
    await this.assertOk(res, "Reading agent");
    const payload = (await res.json()) as {
      data?: { id?: string; name?: string; manifest?: Record<string, unknown> };
    };
    return payload.data ?? (payload as { id?: string; name?: string; manifest?: Record<string, unknown> });
  }

  /** PUT /api/v1/agents/{id} — replace the stored spec of an existing agent. */
  async updateAgent(
    agentId: string,
    name: string,
    manifest: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch(this.url(`/agents/${encodeURIComponent(agentId)}`), {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify({ name, manifest }),
      signal,
    });
    await this.assertOk(res, "Updating agent");
  }

  /**
   * GET /api/v1/settings/sandbox-providers
   *
   * Worth checking explicitly: the sandbox is off by default in TrueForge, and
   * without a configured provider this product cannot do the one thing it
   * claims to do — nor can it load its name-only skills.
   */
  async listSandboxProviders(signal?: AbortSignal): Promise<Array<{ name?: string; type?: string }>> {
    const res = await fetch(this.url("/settings/sandbox-providers"), {
      headers: this.headers(),
      signal,
    });
    await this.assertOk(res, "Reading sandbox providers");
    const payload = (await res.json()) as
      | { data?: Array<{ name?: string; type?: string }> }
      | Array<{ name?: string; type?: string }>;
    return Array.isArray(payload) ? payload : (payload.data ?? []);
  }

  /** POST /api/v1/sessions — by saved agent name, or with an inline spec. */
  async createSession(agent: AgentRef, signal?: AbortSignal): Promise<Session> {
    const res = await fetch(this.url("/sessions"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ agent }),
      signal,
    });
    await this.assertOk(res, "Creating session");

    const payload = (await res.json()) as { data?: Session } & Partial<Session>;
    const session = payload.data ?? (payload as Session);
    if (!session?.id) throw new HarnessError("Session response contained no id");
    return session;
  }

  /**
   * POST /api/v1/sessions/{id}/turns — yields harness events as they stream.
   *
   * Resuming after an approval or a client-side tool response uses this same
   * call with the pending responses as `input`.
   */
  async *streamTurn(
    sessionId: string,
    input: TurnInput[],
    options: StreamOptions = {},
  ): AsyncGenerator<TurnEvent> {
    const res = await fetch(this.url(`/sessions/${encodeURIComponent(sessionId)}/turns`), {
      method: "POST",
      headers: this.headers({ Accept: "text/event-stream" }),
      body: JSON.stringify({ input, stream: true }),
      signal: options.signal,
    });
    await this.assertOk(res, "Creating turn");
    if (!res.body) throw new HarnessError("Turn response had no body to stream");

    yield* parseSseStream(res.body, options);
  }

  /**
   * GET /api/v1/sessions/{id}/turns/{turnId}/subscribe — rejoin a running turn.
   *
   * `afterSequenceNumber` is an exclusive cursor, so a reconnect resumes
   * without replaying events the UI already rendered.
   */
  async *subscribeToTurn(
    sessionId: string,
    turnId: string,
    afterSequenceNumber?: number,
    options: StreamOptions = {},
  ): AsyncGenerator<TurnEvent> {
    const url = new URL(
      this.url(
        `/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/subscribe`,
      ),
    );
    if (afterSequenceNumber !== undefined) {
      url.searchParams.set("after_sequence_number", String(afterSequenceNumber));
    }

    const res = await fetch(url, {
      headers: this.headers({ Accept: "text/event-stream" }),
      signal: options.signal,
    });
    await this.assertOk(res, "Subscribing to turn");
    if (!res.body) throw new HarnessError("Subscribe response had no body to stream");

    yield* parseSseStream(res.body, options);
  }

  /**
   * GET /api/v1/sessions/{id}/turns/{turnId}/download-sandbox-file
   *
   * The inspected artifact can influence what ends up in the sandbox, so the
   * size is bounded twice: once on the advertised Content-Length, and again
   * while reading, since that header is not trustworthy.
   */
  async downloadSandboxFile(
    sessionId: string,
    turnId: string,
    path: string,
    options: { signal?: AbortSignal; maxBytes?: number } = {},
  ): Promise<Uint8Array> {
    const maxBytes = options.maxBytes ?? MAX_SANDBOX_FILE_BYTES;

    const url = new URL(
      this.url(
        `/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/download-sandbox-file`,
      ),
    );
    url.searchParams.set("path", path);

    const res = await fetch(url, { headers: this.headers(), signal: options.signal });
    await this.assertOk(res, "Downloading sandbox file");

    const advertised = Number(res.headers.get("content-length"));
    if (Number.isFinite(advertised) && advertised > maxBytes) {
      throw new HarnessError(
        `Sandbox file is larger than the ${maxBytes} byte limit (advertised ${advertised})`,
      );
    }
    if (!res.body) return new Uint8Array(0);

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        total += value.byteLength;
        if (total > maxBytes) {
          throw new HarnessError(`Sandbox file exceeded the ${maxBytes} byte limit while reading`);
        }
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {
        /* already closed */
      });
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
}

/** Sentinel resolved by the abort race below. */
const ABORTED = Symbol("aborted");

/**
 * Await the next chunk, but give up promptly if the caller aborts.
 *
 * Polling `signal.aborted` before the read is not enough: if the upstream goes
 * idle, the pending read never settles, so the loop cannot notice the abort and
 * the `finally` that cancels the reader cannot run.
 */
async function readOrAbort<T>(
  reader: ReadableStreamDefaultReader<T>,
  signal: AbortSignal | undefined,
): Promise<ReadableStreamReadResult<T> | typeof ABORTED> {
  if (!signal) return reader.read();
  if (signal.aborted) return ABORTED;

  let onAbort!: () => void;
  const aborted = new Promise<typeof ABORTED>((resolve) => {
    onAbort = () => resolve(ABORTED);
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([reader.read(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Parse a `text/event-stream` body into typed harness events.
 *
 * Frames are separated by a blank line; `data:` lines within a frame join with
 * newlines. A malformed frame is skipped rather than throwing — one bad
 * keep-alive should not abort an inspection — but it is counted in
 * `diagnostics` so the caller can report reduced coverage instead of silently
 * losing evidence.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  options: StreamOptions = {},
): AsyncGenerator<TurnEvent> {
  const { signal, diagnostics } = options;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const decode = (frame: string): TurnEvent | null => {
    const result = decodeFrame(frame);
    if (result === MALFORMED) {
      if (diagnostics) diagnostics.malformedFrames += 1;
      return null;
    }
    return result;
  };

  try {
    while (true) {
      const result = await readOrAbort(reader, signal);
      if (result === ABORTED) return;

      const { done, value } = result;
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

        const event = decode(frame);
        if (event) yield event;

        end = findFrameEnd(buffer);
      }
    }

    const trailing = decode(buffer);
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

/** Distinguishes "nothing here" from "there was data and we could not read it". */
const MALFORMED = Symbol("malformed");

function decodeFrame(frame: string): TurnEvent | null | typeof MALFORMED {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();

  // Comments, keep-alives, and the end sentinel are expected, not failures.
  if (!data || data === "[DONE]") return null;

  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== "object") return MALFORMED;
    const candidate = parsed as Partial<TurnEvent>;
    return typeof candidate.type === "string" ? (candidate as TurnEvent) : MALFORMED;
  } catch {
    return MALFORMED;
  }
}
