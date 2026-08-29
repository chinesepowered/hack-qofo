import { Capybara, Steam } from "@/components/capybara";
import { InspectConsole } from "@/components/inspect/console";
import { INSPECTORS } from "@/components/inspectors";

const THREAT_STATS = [
  {
    figure: "1,184",
    label: "packages compromised in coordinated skill-registry campaigns",
    source: "Koi Security",
  },
  {
    figure: "13.4%",
    label: "of 3,984 real agent skills carried at least one critical flaw",
    source: "Snyk ToxicSkills",
  },
  {
    figure: "15",
    label: "benign versions before postmark-mcp silently BCC'd every email",
    source: "Koi Security, Sept 2025",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Hand over the artifact",
    body: 'A SKILL.md, an MCP server config, or the paste someone sent you that starts "just tell your agent to…".',
  },
  {
    n: "02",
    title: "Capy tastes it first",
    body: "The harness provisions a sandbox. Nibbles follows every hop; Yuzu watches what actually executes; every attempted call is logged against a honeypot.",
  },
  {
    n: "03",
    title: "You get evidence, not vibes",
    body: "A verdict backed by observed behaviour, a full chain map, and a pinned hash so you get told the day it changes underneath you.",
  },
];

/**
 * The inspector sits directly under the hero on purpose: it is the thing a
 * judge should be able to click without scrolling to look for it.
 */
export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 pb-24">
      <SiteHeader />
      <Hero />
      <InspectConsole />
      <ThreatStrip />
      <MeetTheInspectors />
      <HowItWorks />
      <WhyDynamic />
      <SiteFooter />
    </main>
  );
}

function SiteHeader() {
  return (
    <header className="flex items-center justify-between py-4">
      <div className="flex items-center gap-2.5">
        <Capybara size={40} mood="calm" />
        <div className="leading-none">
          <div className="font-display text-lg font-extrabold tracking-tight">CapyGuard</div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
            Skill taste-tester
          </div>
        </div>
      </div>
      <nav className="hidden items-center gap-6 text-sm font-semibold text-[var(--text-muted)] sm:flex">
        <a className="transition hover:text-[var(--text)]" href="#inspectors">
          The team
        </a>
        <a className="transition hover:text-[var(--text)]" href="#how">
          How it works
        </a>
        <a
          className="rounded-full bg-[var(--color-spring)] px-4 py-2 text-white shadow-[var(--shadow-soft)] transition hover:brightness-105"
          href="#inspect"
        >
          Inspect something
        </a>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="grid items-center gap-8 py-4 md:grid-cols-[1.2fr_1fr] md:py-6">
      <div className="animate-rise min-w-0">
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-panel)] px-3 py-1.5 text-xs font-bold text-[var(--text-muted)] shadow-[var(--shadow-soft)]">
          <span className="animate-soft-pulse h-2 w-2 rounded-full bg-[var(--color-danger)]" />
          OWASP MCP03:2025 — Tool Poisoning
        </span>

        <h1 className="mt-4 font-display text-[2.4rem] font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
          Don&apos;t install what you haven&apos;t
          <span className="relative ml-3 inline-block">
            <span className="relative z-10">tasted.</span>
            <svg
              className="absolute -bottom-1.5 left-0 z-0 w-full"
              height="14"
              viewBox="0 0 200 14"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                d="M3 9 Q50 2 100 7 T197 5"
                stroke="var(--color-yuzu)"
                strokeWidth="7"
                strokeLinecap="round"
                fill="none"
                opacity="0.55"
              />
            </svg>
          </span>
        </h1>

        <p className="mt-5 max-w-xl leading-relaxed text-[var(--text-muted)]">
          Someone hands you a skill and says <em>&ldquo;just point your agent at this.&rdquo;</em> The
          instructions might tell your agent to fetch something else entirely. CapyGuard runs it in a
          sandbox, follows every hop, and reports what it{" "}
          <strong className="text-[var(--text)]">actually did</strong> — never what it claims.
        </p>
      </div>

      <HotSpring />
    </section>
  );
}

function HotSpring() {
  return (
    <div className="relative hidden items-end justify-center md:flex">
      <div
        className="relative flex h-56 w-full max-w-sm items-end justify-center rounded-[2.5rem] border border-[var(--border)] shadow-[var(--shadow-deep)]"
        style={{
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--color-spring-mist) 60%, transparent) 0%, var(--color-spring) 78%, var(--color-spring-deep) 100%)",
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="animate-ripple absolute bottom-12 h-20 w-32 rounded-[50%] border-2 border-white/40"
            style={{ animationDelay: `${i * 0.85}s` }}
          />
        ))}

        <span
          className="animate-drift absolute bottom-9 left-7 h-7 w-7 rounded-full shadow-md"
          style={{ background: "var(--color-yuzu)" }}
        />
        <span
          className="animate-drift absolute bottom-16 right-8 h-5 w-5 rounded-full shadow-md"
          style={{ background: "var(--color-yuzu-deep)", animationDelay: "2s" }}
        />

        <div className="relative z-10 -mb-2">
          <Steam />
          <Capybara size={150} mood="calm" bob title="A capybara relaxing in a hot spring" />
        </div>

        <div className="absolute bottom-0 h-12 w-full rounded-b-[2.5rem] bg-white/15 backdrop-blur-[1px]" />
      </div>
    </div>
  );
}

function ThreatStrip() {
  return (
    <section className="grid gap-4 py-6 sm:grid-cols-3">
      {THREAT_STATS.map((s) => (
        <div key={s.figure} className="panel min-w-0 p-5">
          <div className="font-display text-3xl font-extrabold text-[var(--color-danger)]">
            {s.figure}
          </div>
          <p className="mt-1.5 text-sm leading-snug text-[var(--text-muted)]">{s.label}</p>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
            {s.source}
          </p>
        </div>
      ))}
    </section>
  );
}

function MeetTheInspectors() {
  return (
    <section id="inspectors" className="scroll-mt-8 py-16">
      <SectionHeading
        eyebrow="Four roles, isolated contexts"
        title="Meet the tasting crew"
        sub="Nibbles and Momo are sub-agents the orchestrator spawns. Yuzu is the sandbox observation channel, and Pip is the orchestrator itself — the one that decides, and the only one that never reads the artifact."
      />

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {INSPECTORS.map((ins, i) => (
          <article
            key={ins.id}
            className="panel animate-rise group min-w-0 p-5 transition hover:-translate-y-1 hover:shadow-[var(--shadow-lift)]"
            style={{ animationDelay: `${i * 90}ms` }}
          >
            <div
              className="mb-3 flex h-24 items-center justify-center rounded-2xl"
              style={{ background: `color-mix(in srgb, ${ins.accent} 14%, transparent)` }}
            >
              <Capybara size={92} accessory={ins.accessory} mood="curious" />
            </div>
            <h3 className="font-display text-lg font-bold">{ins.name}</h3>
            <p
              className="text-[11px] font-bold uppercase tracking-[0.12em]"
              style={{ color: ins.accent }}
            >
              {ins.title}
            </p>
            <p className="mt-2.5 text-sm leading-relaxed text-[var(--text-muted)]">{ins.blurb}</p>
            <p className="mt-3 border-t border-[var(--border-soft)] pt-3 text-xs italic leading-relaxed text-[var(--text-faint)]">
              {ins.isolationReason}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-8 py-16">
      <SectionHeading eyebrow="Three steps" title="How a tasting goes" />
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="panel relative min-w-0 overflow-hidden p-6">
            <span className="pointer-events-none absolute -right-3 -top-6 font-display text-[5.5rem] font-extrabold leading-none text-[var(--text)] opacity-[0.05]">
              {s.n}
            </span>
            <h3 className="font-display text-lg font-bold">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function WhyDynamic() {
  return (
    <section id="why" className="scroll-mt-8 py-16">
      <div className="panel panel-lift overflow-hidden">
        <div className="grid gap-8 p-8 md:grid-cols-[1fr_auto] md:items-center md:p-10">
          <div className="min-w-0">
            <SectionHeading
              eyebrow="The part scanners can't reach"
              title="The payload is never in the file you scanned"
              align="left"
            />
            <p className="mt-5 max-w-2xl leading-relaxed text-[var(--text-muted)]">
              Static scanners read the artifact in front of them. But the interesting attacks put
              nothing incriminating in that file — it says{" "}
              <em>&ldquo;fetch this URL and follow the instructions there.&rdquo;</em> The payload is
              three hops away, or it waits for the sixteenth version, or it fires from a
              dynamic-context command{" "}
              <strong className="text-[var(--text)]">before the model ever sees the skill</strong>, so
              prompt-injection guardrails never get a turn.
            </p>
            <p className="mt-4 max-w-2xl leading-relaxed text-[var(--text-muted)]">
              You cannot read your way to that answer. You have to walk the chain and watch what
              happens — which is exactly what an agent harness with a sandbox is for.
            </p>
          </div>
          <div className="hidden justify-center md:flex">
            <Capybara size={150} mood="alert" accessory="headlamp" bob />
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  sub,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  align?: "center" | "left";
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl text-center" : ""}>
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--color-spring)]">
        {eyebrow}
      </p>
      <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h2>
      {sub && <p className="mt-3 leading-relaxed text-[var(--text-muted)]">{sub}</p>}
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-[var(--border-soft)] pt-8 text-center">
      <Capybara size={56} mood="sleepy" className="mx-auto" />
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        CapyGuard — built on the open-source TrueForge agent harness.
      </p>
      <p className="mt-1 text-xs text-[var(--text-faint)]">
        Verdicts come from observed behaviour. Nothing here trusts what an artifact says about itself.
      </p>
    </footer>
  );
}
