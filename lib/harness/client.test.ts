import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HarnessError,
  loadHarnessConfig,
  newStreamDiagnostics,
  parseSseStream,
  redactSecrets,
  type StreamOptions,
} from "./client.ts";
import type { TurnEvent } from "./events.ts";

const DONE_FRAME = '{"id":"1","type":"turn.done","thread_id":null,"created_at":"x","state":"done"}';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** A stream that stays open and never produces a chunk. */
function idleStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({ start() {} });
}

async function collect(
  stream: ReadableStream<Uint8Array>,
  options: StreamOptions = {},
): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of parseSseStream(stream, options)) events.push(event);
  return events;
}

describe("parseSseStream", () => {
  it("decodes newline-separated frames", async () => {
    const events = await collect(
      streamOf(
        'data: {"id":"1","type":"sandbox.created","thread_id":null,"created_at":"x","sandbox_id":"sb1"}\n\n',
        `data: ${DONE_FRAME}\n\n`,
      ),
    );
    assert.deepEqual(events.map((e) => e.type), ["sandbox.created", "turn.done"]);
  });

  it("reassembles a frame split across chunk boundaries", async () => {
    // The network decides where chunks break, not the sender.
    const events = await collect(
      streamOf('data: {"id":"1","type":"turn.', 'done","thread_id":null,"created_at":"x","state":"done"}\n\n'),
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "turn.done");
  });

  it("handles CRLF frame separators", async () => {
    const events = await collect(streamOf(`data: ${DONE_FRAME}\r\n\r\n`));
    assert.equal(events.length, 1);
  });

  it("joins multiple data lines within one frame", async () => {
    const events = await collect(
      streamOf('data: {"id":"1","type":"turn.done",\ndata: "thread_id":null,"created_at":"x","state":"done"}\n\n'),
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].id, "1");
  });

  it("emits a trailing frame that arrives without a final blank line", async () => {
    const events = await collect(streamOf(`data: ${DONE_FRAME}`));
    assert.equal(events.length, 1);
  });

  it("skips comments, keep-alives, and the [DONE] sentinel without counting them as damage", async () => {
    const diagnostics = newStreamDiagnostics();
    const events = await collect(
      streamOf(": keep-alive\n\n", "\n\n", "data: [DONE]\n\n", `data: ${DONE_FRAME}\n\n`),
      { diagnostics },
    );
    assert.equal(events.length, 1);
    assert.equal(diagnostics.malformedFrames, 0);
  });

  it("skips malformed frames rather than aborting the inspection", async () => {
    const events = await collect(
      streamOf("data: {not json}\n\n", "data: 42\n\n", 'data: {"missing":"type"}\n\n', `data: ${DONE_FRAME}\n\n`),
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "turn.done");
  });

  it("counts every dropped frame so the caller can report reduced coverage", async () => {
    // A dropped frame may have carried the observation that changes a verdict,
    // so losing one silently would let a clean result stand on partial evidence.
    const diagnostics = newStreamDiagnostics();
    await collect(
      streamOf("data: {not json}\n\n", "data: 42\n\n", 'data: {"missing":"type"}\n\n', `data: ${DONE_FRAME}\n\n`),
      { diagnostics },
    );
    assert.equal(diagnostics.malformedFrames, 3);
  });

  it("stops early when the caller aborts before reading", async () => {
    const controller = new AbortController();
    controller.abort();
    const events = await collect(streamOf(`data: ${DONE_FRAME}\n\n`), { signal: controller.signal });
    assert.equal(events.length, 0);
  });

  it("stops promptly when aborted while the upstream is idle", { timeout: 5000 }, async () => {
    // Polling the signal only before the read would hang here forever: the
    // pending read never settles, so the loop never gets to look again.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25);
    try {
      const events = await collect(idleStream(), { signal: controller.signal });
      assert.equal(events.length, 0);
    } finally {
      clearTimeout(timer);
    }
  });

  it("rejects a stream that floods the frame buffer", async () => {
    // A hostile upstream must not be able to exhaust memory by never sending
    // a frame separator.
    const flood = "data: " + "x".repeat(1_100_000);
    await assert.rejects(() => collect(streamOf(flood)), HarnessError);
  });
});

describe("redactSecrets", () => {
  it("removes the configured key wherever it appears", () => {
    const out = redactSecrets("upstream said: key sk-abc123 was rejected", "sk-abc123");
    assert.ok(!out.includes("sk-abc123"));
    assert.match(out, /\[redacted\]/);
  });

  it("removes an echoed Authorization header even if it is not our key", () => {
    // A proxy may echo a different token than the one we hold.
    const out = redactSecrets("failed with Authorization: Bearer eyJhbGciOi.J9.sig", "other");
    assert.ok(!out.includes("eyJhbGciOi.J9.sig"));
  });

  it("removes labelled credentials in the body", () => {
    const out = redactSecrets('{"api_key": "abcdef0123456789"}', "");
    assert.ok(!out.includes("abcdef0123456789"));
  });

  it("leaves ordinary text alone", () => {
    assert.equal(redactSecrets("session not found", "sk-abc"), "session not found");
  });
});

describe("loadHarnessConfig", () => {
  it("returns null when no harness is configured, so the app stays offline-first", () => {
    // Without this, every user who has not started TrueForge would hit errors
    // instead of the replay and static paths the demo runs on.
    assert.equal(loadHarnessConfig({}), null);
    assert.equal(loadHarnessConfig({ TRUEFORGE_TOKEN: "t" }), null);
  });

  it("treats a whitespace-only base URL as absent", () => {
    assert.equal(loadHarnessConfig({ TRUEFORGE_BASE_URL: "   " }), null);
  });

  it("needs no token, because standalone TrueForge has no login", () => {
    const config = loadHarnessConfig({ TRUEFORGE_BASE_URL: "http://localhost:8790" });
    assert.equal(config?.baseUrl, "http://localhost:8790");
    assert.equal(config?.token, undefined);
  });

  it("carries a token when OIDC login is enabled", () => {
    const config = loadHarnessConfig({
      TRUEFORGE_BASE_URL: "https://forge.example.com",
      TRUEFORGE_TOKEN: "id-token",
    });
    assert.equal(config?.token, "id-token");
  });

  it("treats a whitespace-only token as absent rather than sending an empty bearer", () => {
    const config = loadHarnessConfig({
      TRUEFORGE_BASE_URL: "http://localhost:8790",
      TRUEFORGE_TOKEN: "  ",
    });
    assert.equal(config?.token, undefined);
  });

  it("strips trailing slashes so URL joining cannot double up", () => {
    const config = loadHarnessConfig({ TRUEFORGE_BASE_URL: "http://localhost:8790//" });
    assert.equal(config?.baseUrl, "http://localhost:8790");
  });

  it("rejects a malformed base URL", () => {
    assert.throws(() => loadHarnessConfig({ TRUEFORGE_BASE_URL: "not a url" }), HarnessError);
  });

  it("allows plaintext http on loopback, which is how standalone runs", () => {
    for (const host of ["http://localhost:8790", "http://127.0.0.1:8790"]) {
      assert.equal(loadHarnessConfig({ TRUEFORGE_BASE_URL: host })?.baseUrl, host);
    }
  });

  it("refuses plaintext http to any non-loopback host", () => {
    // A remote harness over http would put the token, and every artifact we
    // send it, on the wire in the clear.
    assert.throws(
      () => loadHarnessConfig({ TRUEFORGE_BASE_URL: "http://forge.example.com" }),
      HarnessError,
    );
  });
});
