import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HarnessError, loadHarnessConfig, parseSseStream } from "./client.ts";
import type { TurnEvent } from "./events.ts";

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of parseSseStream(stream)) events.push(event);
  return events;
}

describe("parseSseStream", () => {
  it("decodes newline-separated frames", async () => {
    const events = await collect(
      streamOf(
        'data: {"id":"1","type":"sandbox.created","thread_id":null,"created_at":"x","sandbox_id":"sb1"}\n\n',
        'data: {"id":"2","type":"turn.done","thread_id":null,"created_at":"x","state":"done"}\n\n',
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
    const events = await collect(
      streamOf('data: {"id":"1","type":"turn.done","thread_id":null,"created_at":"x","state":"done"}\r\n\r\n'),
    );
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
    const events = await collect(
      streamOf('data: {"id":"1","type":"turn.done","thread_id":null,"created_at":"x","state":"done"}'),
    );
    assert.equal(events.length, 1);
  });

  it("skips comments, keep-alives, and the [DONE] sentinel", async () => {
    const events = await collect(
      streamOf(
        ": keep-alive\n\n",
        "\n\n",
        "data: [DONE]\n\n",
        'data: {"id":"1","type":"turn.done","thread_id":null,"created_at":"x","state":"done"}\n\n',
      ),
    );
    assert.equal(events.length, 1);
  });

  it("skips malformed frames rather than aborting the inspection", async () => {
    const events = await collect(
      streamOf(
        "data: {not json}\n\n",
        "data: 42\n\n",
        'data: {"missing":"type"}\n\n',
        'data: {"id":"1","type":"turn.done","thread_id":null,"created_at":"x","state":"done"}\n\n',
      ),
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "turn.done");
  });

  it("stops early when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const events = await collect_(streamOf('data: {"id":"1","type":"turn.done"}\n\n'), controller.signal);
    assert.equal(events.length, 0);
  });

  it("rejects a stream that floods the frame buffer", async () => {
    // A hostile upstream must not be able to exhaust memory by never sending
    // a frame separator.
    const flood = "data: " + "x".repeat(1_100_000);
    await assert.rejects(() => collect(streamOf(flood)), HarnessError);
  });
});

async function collect_(stream: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of parseSseStream(stream, signal)) events.push(event);
  return events;
}

describe("loadHarnessConfig", () => {
  it("returns null when credentials are absent, so the app can fall back to replay mode", () => {
    assert.equal(loadHarnessConfig({}), null);
    assert.equal(loadHarnessConfig({ TFY_GATEWAY_URL: "https://example.com" }), null);
    assert.equal(loadHarnessConfig({ TFY_API_KEY: "k" }), null);
  });

  it("treats whitespace-only values as absent", () => {
    assert.equal(loadHarnessConfig({ TFY_GATEWAY_URL: "  ", TFY_API_KEY: "  " }), null);
  });

  it("strips trailing slashes so URL joining cannot double up", () => {
    const config = loadHarnessConfig({ TFY_GATEWAY_URL: "https://gw.example.com/tenant//", TFY_API_KEY: "k" });
    assert.equal(config?.baseUrl, "https://gw.example.com/tenant");
  });

  it("rejects a malformed gateway URL", () => {
    assert.throws(() => loadHarnessConfig({ TFY_GATEWAY_URL: "not a url", TFY_API_KEY: "k" }), HarnessError);
  });

  it("refuses to send the API key over plaintext http", () => {
    assert.throws(
      () => loadHarnessConfig({ TFY_GATEWAY_URL: "http://gw.example.com", TFY_API_KEY: "k" }),
      HarnessError,
    );
  });

  it("allows plaintext localhost for local testing", () => {
    const config = loadHarnessConfig({ TFY_GATEWAY_URL: "http://localhost:8080", TFY_API_KEY: "k" });
    assert.equal(config?.baseUrl, "http://localhost:8080");
  });
});
