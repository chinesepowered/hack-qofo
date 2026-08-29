"use client";

import { Capybara } from "@/components/capybara";
import { INSPECTORS, type InspectorRole } from "@/components/inspectors";
import type {
  ApprovalRequest,
  CostSnapshot,
  Finding,
  Observation,
  RiskLevel,
  Severity,
  Verdict,
} from "@/lib/inspector/types";

/* ------------------------------ shared bits ------------------------------ */

const SEVERITY_STYLE: Record<Severity, { bg: string; fg: string; label: string }> = {
  critical: { bg: "var(--color-danger)", fg: "#fff", label: "Critical" },
  high: { bg: "var(--color-danger)", fg: "#fff", label: "High" },
  medium: { bg: "var(--color-yuzu)", fg: "#3d2c1e", label: "Medium" },
  low: { bg: "var(--color-spring)", fg: "#fff", label: "Low" },
  info: { bg: "var(--bg-sunken)", fg: "var(--text-muted)", label: "Info" },
};

const RISK_STYLE: Record<RiskLevel, { color: string; title: string; mood: "calm" | "alert" | "alarmed" }> = {
  clean: { color: "var(--color-safe)", title: "Looks clean", mood: "calm" },
  suspicious: { color: "var(--color-yuzu)", title: "Suspicious", mood: "alert" },
  malicious: { color: "var(--color-danger)", title: "Do not install", mood: "alarmed" },
  undetermined: { color: "var(--text-muted)", title: "Undetermined", mood: "alert" },
};

function SeverityChip({ severity }: { severity: Severity }) {
  const s = SEVERITY_STYLE[severity];
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

/* ------------------------------ inspector lanes ------------------------------ */

export type LaneStatus = "waiting" | "working" | "done";

export interface LaneState {
  status: LaneStatus;
  note?: string;
  summary?: string;
}

export function InspectorLanes({ lanes }: { lanes: Record<InspectorRole, LaneState> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {INSPECTORS.map((ins) => {
        const lane = lanes[ins.id];
        const working = lane.status === "working";
        const done = lane.status === "done";

        return (
          <div
            key={ins.id}
            className="panel flex items-center gap-3 p-3 transition"
            style={{
              borderColor: working ? ins.accent : undefined,
              opacity: lane.status === "waiting" ? 0.55 : 1,
            }}
          >
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl"
              style={{ background: `color-mix(in srgb, ${ins.accent} 16%, transparent)` }}
            >
              <Capybara
                size={52}
                accessory={ins.accessory}
                mood={working ? "alert" : done ? "calm" : "sleepy"}
                bob={working}
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-display text-sm font-bold">{ins.name}</span>
                {working && (
                  <span
                    className="animate-soft-pulse h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: ins.accent }}
                  />
                )}
              </div>
              <p className="truncate text-xs text-[var(--text-muted)]">
                {lane.summary ?? lane.note ?? ins.title}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------ live feed ------------------------------ */

export type FeedItem =
  | { id: string; type: "finding"; finding: Finding }
  | { id: string; type: "observation"; observation: Observation }
  | { id: string; type: "narration"; text: string };

const CHANNEL_ICON: Record<Observation["channel"], string> = {
  file: "📄",
  process: "⚙️",
  network: "🌐",
  env: "🔑",
};

export function LiveFeed({ items }: { items: FeedItem[] }) {
  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-[var(--text-faint)]">
        Findings and observations land here as they happen.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => {
        if (item.type === "narration") {
          return (
            <li
              key={item.id}
              className="animate-rise px-1 py-1 text-center text-sm italic text-[var(--text-muted)]"
            >
              {item.text}
            </li>
          );
        }

        if (item.type === "observation") {
          const o = item.observation;
          return (
            <li key={item.id} className="animate-rise sunken flex items-start gap-2.5 p-3">
              <span aria-hidden="true">{CHANNEL_ICON[o.channel]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug">{o.detail}</p>
                {o.contained && (
                  <p className="mt-1 text-[11px] font-semibold text-[var(--color-safe)]">
                    Contained in the sandbox
                  </p>
                )}
              </div>
            </li>
          );
        }

        const f = item.finding;
        return (
          <li
            key={item.id}
            className="animate-rise panel border-l-4 p-3"
            style={{ borderLeftColor: SEVERITY_STYLE[f.severity].bg }}
          >
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <SeverityChip severity={f.severity} />
              <span className="font-mono text-[11px] text-[var(--text-faint)]">{f.kind}</span>
            </div>
            <p className="text-sm leading-snug">{f.observed}</p>
            {/* Wrap rather than scroll: evidence hidden off the right edge is
                evidence a reviewer will not read. */}
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-[var(--bg-sunken)] p-2 font-mono text-[11px] leading-relaxed text-[var(--text-muted)]">
              {f.evidence}
            </pre>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------ approval gate ------------------------------ */

export function ApprovalGate({
  request,
  onDecide,
}: {
  request: ApprovalRequest;
  onDecide: (approved: boolean) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        className="panel panel-lift animate-rise w-full max-w-lg overflow-hidden"
      >
        <div
          className="flex items-center gap-3 px-5 py-4"
          style={{ background: "color-mix(in srgb, var(--color-yuzu) 22%, transparent)" }}
        >
          <Capybara size={56} accessory="headlamp" mood="curious" bob />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Waiting for you
            </p>
            <h3 id="approval-title" className="font-display text-lg font-bold">
              {request.title}
            </h3>
          </div>
        </div>

        <div className="space-y-3 p-5">
          <p className="leading-relaxed text-[var(--text-muted)]">{request.plainLanguage}</p>

          <dl className="sunken space-y-1.5 p-3 font-mono text-xs">
            {request.destination && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-[var(--text-faint)]">destination</dt>
                <dd className="min-w-0 break-all">{request.destination}</dd>
              </div>
            )}
            {request.payloadPreview && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-[var(--text-faint)]">action</dt>
                <dd className="min-w-0 break-all">{request.payloadPreview}</dd>
              </div>
            )}
          </dl>

          <div className="flex flex-wrap gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => onDecide(true)}
              className="flex-1 rounded-full bg-[var(--color-spring)] px-5 py-3 font-display font-bold text-white transition hover:brightness-105"
            >
              Let Capy proceed
            </button>
            <button
              type="button"
              onClick={() => onDecide(false)}
              className="rounded-full border border-[var(--border)] px-5 py-3 font-display font-bold transition hover:bg-[var(--bg-sunken)]"
            >
              Deny
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ verdict ------------------------------ */

export function VerdictCard({ verdict, caveat }: { verdict: Verdict; caveat?: string }) {
  const style = RISK_STYLE[verdict.risk];

  return (
    <div className="panel panel-lift animate-rise overflow-hidden">
      <div
        className="flex items-center gap-4 px-6 py-5"
        style={{ background: `color-mix(in srgb, ${style.color} 18%, transparent)` }}
      >
        <Capybara size={72} mood={style.mood} bob />
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">
            Verdict
          </p>
          <h3 className="font-display text-2xl font-extrabold" style={{ color: style.color }}>
            {style.title}
          </h3>
        </div>
      </div>

      <div className="space-y-4 p-6">
        <p className="leading-relaxed">{verdict.summary}</p>

        {caveat && (
          <p className="sunken p-3 text-sm leading-relaxed text-[var(--text-muted)]">{caveat}</p>
        )}

        {verdict.unexplored.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Not checked
            </h4>
            <ul className="space-y-1.5">
              {verdict.unexplored.map((u) => (
                <li key={u} className="flex gap-2 text-sm leading-snug text-[var(--text-muted)]">
                  <span aria-hidden="true" className="text-[var(--text-faint)]">
                    ◌
                  </span>
                  <span className="min-w-0 break-words">{u}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--border-soft)] pt-4 text-xs text-[var(--text-muted)]">
          <span className="font-mono">
            pinned <span className="text-[var(--text-faint)]">{verdict.definitionHash.slice(0, 16)}…</span>
          </span>
          <span>
            {verdict.findings.length} finding{verdict.findings.length === 1 ? "" : "s"}
          </span>
          {verdict.cost && <CostReadout cost={verdict.cost} inline />}
        </div>

        <p className="text-xs italic leading-relaxed text-[var(--text-faint)]">
          Record this hash alongside your approval. Re-inspecting later and comparing against it is
          how a sleeper rug-pull gets caught — this build computes and compares pins, but does not
          yet store them for you or re-check on a schedule.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------ cost ------------------------------ */

export function CostReadout({ cost, inline = false }: { cost: CostSnapshot; inline?: boolean }) {
  const body = (
    <>
      <span className="font-mono">${cost.usd.toFixed(3)}</span>
      <span>{cost.tokens.toLocaleString()} tokens</span>
      <span>{cost.toolCalls} tool calls</span>
      <span>{(cost.elapsedMs / 1000).toFixed(1)}s</span>
    </>
  );

  if (inline) {
    return <span className="flex flex-wrap items-center gap-x-3 gap-y-1">{body}</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
      {body}
    </div>
  );
}
