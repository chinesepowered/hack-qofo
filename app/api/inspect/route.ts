import { NextResponse } from "next/server";

import { loadHarnessConfig } from "@/lib/harness/client";
import { getReplayTrace } from "@/lib/inspector/replay";
import { SAMPLE_BY_ID } from "@/lib/inspector/samples";
import { buildStaticTrace } from "@/lib/inspector/static-trace";
import type { TimedInspectionEvent } from "@/lib/inspector/types";

/**
 * Returns an inspection trace for the dashboard to play back.
 *
 * Three modes, in descending order of what they can actually prove:
 *   live    — a real harness session (requires a configured gateway)
 *   replay  — a recorded inspection of a known sample
 *   static  — the offline pattern pass over content someone pasted
 *
 * Playback pacing and approval gating live on the client, so a paused approval
 * costs no server state and the demo cannot be broken by a dropped connection.
 */

/** Refuse anything large enough to be a denial-of-service rather than a skill. */
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_NAME_LENGTH = 120;

export type InspectMode = "live" | "replay" | "static";

export interface InspectResponse {
  mode: InspectMode;
  artifactName: string;
  events: TimedInspectionEvent[];
  /** Present when the result is weaker than a full inspection would be. */
  caveat?: string;
}

interface InspectRequest {
  sampleId?: unknown;
  source?: unknown;
  name?: unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: InspectRequest;
  try {
    body = (await request.json()) as InspectRequest;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof body.sampleId === "string") {
    return inspectSample(body.sampleId);
  }

  if (typeof body.source === "string") {
    return inspectPastedSource(body.source, body.name);
  }

  return NextResponse.json(
    { error: "Provide either a sampleId or a source to inspect." },
    { status: 400 },
  );
}

function inspectSample(sampleId: string): NextResponse {
  const sample = SAMPLE_BY_ID[sampleId];
  const events = getReplayTrace(sampleId);

  if (!sample || !events) {
    return NextResponse.json({ error: "Unknown sample." }, { status: 404 });
  }

  const response: InspectResponse = {
    mode: "replay",
    artifactName: sample.name,
    events,
    caveat: "Recorded inspection. The events are exactly what the live run emitted.",
  };
  return NextResponse.json(response);
}

async function inspectPastedSource(source: string, rawName: unknown): Promise<NextResponse> {
  // Byte length, not string length: a multi-byte payload would otherwise slip
  // past a character count.
  const byteLength = new TextEncoder().encode(source).length;
  if (byteLength === 0) {
    return NextResponse.json({ error: "Nothing to inspect." }, { status: 400 });
  }
  if (byteLength > MAX_SOURCE_BYTES) {
    return NextResponse.json(
      { error: `Artifact is larger than the ${MAX_SOURCE_BYTES / 1024} KB limit.` },
      { status: 413 },
    );
  }

  const artifactName = sanitiseName(rawName);

  // A configured gateway would run the full sandboxed inspection here. Until
  // one is present, the static pass is what can honestly be offered, and the
  // response says so rather than dressing it up as a full result.
  const harnessConfigured = safeHarnessCheck();

  const events = await buildStaticTrace(artifactName, source);
  const response: InspectResponse = {
    mode: "static",
    artifactName,
    events,
    caveat: harnessConfigured
      ? "Static pass. Live sandboxed inspection of pasted artifacts is not wired up yet."
      : "Static pass only — no gateway is configured, so nothing was executed and no hop was followed.",
  };
  return NextResponse.json(response);
}

/**
 * The name is echoed straight back into the UI, so it is reduced to a plain
 * label. Anything that could read as instruction is not welcome in a field that
 * gets rendered next to a verdict.
 */
function sanitiseName(raw: unknown): string {
  if (typeof raw !== "string") return "pasted artifact";
  const cleaned = raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\w .,()@/-]/g, "")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return cleaned || "pasted artifact";
}

/** Never let a malformed gateway URL take down the static path. */
function safeHarnessCheck(): boolean {
  try {
    return loadHarnessConfig() !== null;
  } catch {
    return false;
  }
}
