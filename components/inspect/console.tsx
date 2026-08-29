"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { Capybara } from "@/components/capybara";
import type { InspectorRole } from "@/components/inspectors";
import { ChainMap } from "./chain-map";
import {
  ApprovalGate,
  CostReadout,
  InspectorLanes,
  LiveFeed,
  VerdictCard,
  type FeedItem,
  type LaneState,
} from "./panels";
import { buildDeniedVerdict, pendingHops } from "@/lib/inspector/denial";
import { SAMPLE_ARTIFACTS } from "@/lib/inspector/samples";
import type {
  ApprovalRequest,
  ChainHop,
  CostSnapshot,
  Finding,
  InspectionEvent,
  TimedInspectionEvent,
  Verdict,
} from "@/lib/inspector/types";

/**
 * The inspection console.
 *
 * Playback is driven entirely on the client: each event carries the delay to
 * wait before showing it, and an `approval_required` event simply stops the
 * clock until a human decides. Keeping the pacing here means a paused approval
 * holds no server state and a dropped connection cannot strand a demo midway.
 */

type Status = "idle" | "loading" | "running" | "paused" | "done" | "error";

interface State {
  status: Status;
  artifactName: string;
  caveat?: string;
  sandboxId?: string;
  hops: ChainHop[];
  feed: FeedItem[];
  lanes: Record<InspectorRole, LaneState>;
  cost?: CostSnapshot;
  verdict?: Verdict;
  approval?: ApprovalRequest;
  error?: string;
}

const IDLE_LANES: Record<InspectorRole, LaneState> = {
  nibbles: { status: "waiting" },
  momo: { status: "waiting" },
  yuzu: { status: "waiting" },
  pip: { status: "waiting" },
};

const INITIAL: State = {
  status: "idle",
  artifactName: "",
  hops: [],
  feed: [],
  lanes: IDLE_LANES,
};

type Action =
  | { type: "loading" }
  | { type: "loaded"; artifactName: string; caveat?: string }
  | { type: "event"; event: InspectionEvent }
  | { type: "approved" }
  | { type: "denied"; request: ApprovalRequest; definitionHash: string }
  | { type: "finished" }
  | { type: "error"; message: string };

let feedSeq = 0;
function nextFeedId(prefix: string): string {
  feedSeq += 1;
  return `${prefix}-${feedSeq}`;
}

function narrate(state: State, text: string): FeedItem[] {
  return [...state.feed, { id: nextFeedId("feed"), type: "narration", text }];
}

/** Findings actually streamed so far — the only evidence a verdict may cite. */
function observedFindings(state: State): Finding[] {
  return state.feed.filter((item) => item.type === "finding").map((item) => item.finding);
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "loading":
      return { ...INITIAL, status: "loading" };

    case "loaded":
      return { ...INITIAL, status: "running", artifactName: action.artifactName, caveat: action.caveat };

    case "approved":
      if (!state.approval) return state;
      return {
        ...state,
        status: "running",
        approval: undefined,
        feed: narrate(state, "You let Capy proceed."),
      };

    case "denied":
      return applyDenial(state, action.request, action.definitionHash);

    case "finished":
      return { ...state, status: "done" };

    case "error":
      return { ...state, status: "error", error: action.message };

    case "event":
      return applyEvent(state, action.event);
  }
}

/** See `buildDeniedVerdict` — a denied step must never be reported as observed. */
function applyDenial(state: State, request: ApprovalRequest, definitionHash: string): State {
  const verdict = buildDeniedVerdict({
    observed: observedFindings(state),
    pendingHops: pendingHops(state.hops),
    request,
    definitionHash,
  });

  return {
    ...state,
    status: "done",
    approval: undefined,
    verdict,
    hops: state.hops.map((h) =>
      h.status === "pending" || h.status === "following"
        ? { ...h, status: "blocked", outcome: "You denied this step." }
        : h,
    ),
    feed: narrate(state, "You denied it. The inspection stops here, and says so."),
  };
}

function applyEvent(state: State, event: InspectionEvent): State {
  switch (event.kind) {
    case "started":
      return { ...state, artifactName: event.artifactName };

    case "sandbox_ready":
      return {
        ...state,
        sandboxId: event.sandboxId,
        feed: narrate(state, `Sandbox ${event.sandboxId} is up.`),
      };

    case "inspector_started":
      return {
        ...state,
        lanes: { ...state.lanes, [event.inspector]: { status: "working", note: event.note } },
      };

    case "inspector_done":
      return {
        ...state,
        lanes: { ...state.lanes, [event.inspector]: { status: "done", summary: event.summary } },
      };

    case "hop_discovered":
      return { ...state, hops: [...state.hops, event.hop] };

    case "hop_updated":
      return {
        ...state,
        hops: state.hops.map((h) =>
          h.id === event.hopId ? { ...h, status: event.status, outcome: event.outcome ?? h.outcome } : h,
        ),
      };

    case "observation":
      return {
        ...state,
        feed: [...state.feed, { id: nextFeedId("feed"), type: "observation", observation: event.observation }],
      };

    case "finding":
      return {
        ...state,
        feed: [...state.feed, { id: nextFeedId("feed"), type: "finding", finding: event.finding }],
      };

    case "narration":
      return { ...state, feed: narrate(state, event.text) };

    case "approval_required":
      return { ...state, status: "paused", approval: event.request };

    case "approval_resolved":
      return state;

    case "cost":
      return { ...state, cost: event.cost };

    case "verdict":
      return { ...state, verdict: event.verdict, cost: event.verdict.cost ?? state.cost };

    case "error":
      return { ...state, status: "error", error: event.message };
  }
}

export function InspectConsole() {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const [pasted, setPasted] = useState("");

  const queue = useRef<TimedInspectionEvent[]>([]);
  const index = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepRef = useRef<() => void>(undefined);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const step = useCallback(() => {
    const events = queue.current;
    const i = index.current;

    if (i >= events.length) {
      dispatch({ type: "finished" });
      return;
    }

    const event = events[i];
    index.current = i + 1;
    dispatch({ type: "event", event });

    // An approval stops the clock. It restarts when the human decides.
    if (event.kind === "approval_required") return;

    const next = events[index.current];
    if (!next) {
      dispatch({ type: "finished" });
      return;
    }
    timer.current = setTimeout(() => stepRef.current?.(), next.delayMs);
  }, []);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => clearTimer, [clearTimer]);

  const run = useCallback(
    async (payload: { sampleId: string } | { source: string; name: string }) => {
      clearTimer();
      queue.current = [];
      index.current = 0;
      dispatch({ type: "loading" });

      try {
        const res = await fetch("/api/inspect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = (await res.json()) as {
          error?: string;
          artifactName?: string;
          caveat?: string;
          events?: TimedInspectionEvent[];
        };

        if (!res.ok || !data.events) {
          dispatch({ type: "error", message: data.error ?? "The inspection could not be started." });
          return;
        }

        queue.current = data.events;
        index.current = 0;
        dispatch({ type: "loaded", artifactName: data.artifactName ?? "artifact", caveat: data.caveat });

        const first = data.events[0];
        timer.current = setTimeout(() => stepRef.current?.(), first?.delayMs ?? 0);
      } catch {
        dispatch({ type: "error", message: "Could not reach the inspector." });
      }
    },
    [clearTimer],
  );

  const decide = useCallback(
    (approved: boolean, request: ApprovalRequest) => {
      if (!approved) {
        clearTimer();
        // Only the artifact hash is carried over from the unplayed trace; it
        // describes the file we were given, not behaviour we never watched.
        const pending = queue.current.slice(index.current).find((e) => e.kind === "verdict");
        const definitionHash = pending?.kind === "verdict" ? pending.verdict.definitionHash : "";
        dispatch({ type: "denied", request, definitionHash });
        return;
      }

      dispatch({ type: "approved" });
      const next = queue.current[index.current];
      timer.current = setTimeout(() => stepRef.current?.(), next?.delayMs ?? 0);
    },
    [clearTimer],
  );

  const busy = state.status === "loading" || state.status === "running" || state.status === "paused";
  const started = state.status !== "idle";

  return (
    <section id="inspect" className="scroll-mt-8 pb-16 pt-2">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--color-spring)]">
          Try it
        </p>
        <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          Hand something over
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--text-muted)]">
          Pick one of the samples, or paste a skill someone gave you.
        </p>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SAMPLE_ARTIFACTS.map((sample) => (
          <button
            key={sample.id}
            type="button"
            disabled={busy}
            onClick={() => void run({ sampleId: sample.id })}
            className="panel group p-4 text-left transition hover:-translate-y-1 hover:shadow-[var(--shadow-lift)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
              {sample.kind}
            </span>
            <h3 className="mt-1 font-display text-sm font-bold">{sample.name}</h3>
            <p className="mt-1.5 text-xs leading-snug text-[var(--text-muted)]">{sample.teaser}</p>
            <p className="mt-2 text-[11px] italic leading-snug text-[var(--text-faint)]">
              {sample.provenance}
            </p>
          </button>
        ))}
      </div>

      <div className="panel mt-4 p-4">
        <label htmlFor="paste" className="text-sm font-semibold">
          Or paste your own
        </label>
        <textarea
          id="paste"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={4}
          spellCheck={false}
          placeholder="Paste a SKILL.md, an MCP server definition, or the instructions someone told you to give your agent."
          className="mt-2 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--bg-sunken)] p-3 font-mono text-xs leading-relaxed outline-none focus:border-[var(--color-spring)]"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[var(--text-faint)]">
            Pasted artifacts get the static pass only — no sandbox, so nothing is executed.
          </p>
          <button
            type="button"
            disabled={busy || pasted.trim().length === 0}
            onClick={() => void run({ source: pasted, name: "pasted artifact" })}
            className="rounded-full bg-[var(--color-spring)] px-5 py-2.5 font-display text-sm font-bold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Taste it
          </button>
        </div>
      </div>

      {state.status === "error" && (
        <p className="panel mt-4 border-l-4 border-l-[var(--color-danger)] p-4 text-sm">{state.error}</p>
      )}

      {started && state.status !== "error" && (
        <div className="mt-8 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
          {/* min-w-0: grid items default to min-width:auto, so a wide child in
              either column would refuse to shrink and squeeze the other one. */}
          <div className="flex min-w-0 flex-col gap-4">
            <div className="panel p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-base font-bold">Instruction chain</h3>
                {state.sandboxId && (
                  <span className="font-mono text-[11px] text-[var(--text-faint)]">
                    sandbox {state.sandboxId}
                  </span>
                )}
              </div>
              <ChainMap hops={state.hops} />
            </div>

            <InspectorLanes lanes={state.lanes} />

            {state.cost && (
              <div className="panel flex items-center justify-between gap-3 p-3">
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  This inspection cost
                </span>
                <CostReadout cost={state.cost} />
              </div>
            )}
          </div>

          {/* min-w-0: grid items default to min-width:auto, so a wide child in
              either column would refuse to shrink and squeeze the other one. */}
          <div className="flex min-w-0 flex-col gap-4">
            {state.verdict ? (
              <VerdictCard verdict={state.verdict} caveat={state.caveat} />
            ) : (
              <div className="panel flex items-center gap-3 p-4">
                <Capybara size={54} mood="curious" bob={busy} />
                <div>
                  <p className="font-display text-sm font-bold">
                    {state.status === "loading" ? "Getting ready…" : `Tasting ${state.artifactName}`}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {state.status === "paused" ? "Waiting for your decision." : "Nobody swallows yet."}
                  </p>
                </div>
              </div>
            )}

            <div className="panel max-h-[32rem] overflow-y-auto p-4">
              <h3 className="mb-3 font-display text-base font-bold">What Capy saw</h3>
              <LiveFeed items={state.feed} />
            </div>
          </div>
        </div>
      )}

      {state.approval && (
        <ApprovalGate
          request={state.approval}
          onDecide={(approved) => decide(approved, state.approval!)}
        />
      )}
    </section>
  );
}
