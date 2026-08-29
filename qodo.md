# 🔍 Working with Qodo

Notes from running every change in this repo through Qodo Review before merge.

**Totals:** 6 PRs · 23 findings · 0 findings we judged to be false positives · all fixed before merge.

---

## Setup

Installed on the repo, with `.pr_agent.toml` configured to auto-run describe + review on PR open, post both a summary and inline comments at threshold 2, and — the part that mattered — carry review guidelines saying **this codebase executes untrusted input in a sandbox**, so sandbox escapes, untrusted content influencing verdicts, secret exposure, and unbounded instruction-chain recursion are the findings that count.

That context visibly changed the output. Findings were framed in terms of *our* threat model ("a hostile artifact could…", "an artifact must never be able to abort its own inspection"), not generic lint. If you only do one configuration step, do that one.

---

## The four findings that earned it

| PR | Finding | Why it mattered |
|---|---|---|
| **#2** | Pinned Next.js 15.5.4 / React 19.1.1 carry an **unauthenticated RSC RCE** (CVE-2025-66478) | A live, exploitable vulnerability in an App Router app, on day one. We'd pinned versions from memory. It cited the advisory and the patched release. |
| **#3** | The prompt-injection boundary the product is built around was **enforced by prompt only** — the root agent both received artifact text and emitted the verdict | Our headline security claim was aspirational. Instructing an agent to "delegate reads" cannot un-read what it was already handed. Now structural: the request builder has no content parameter. |
| **#4** | **Denying an approval still reported the credential theft it had prevented** | It pulled the precomputed verdict out of the unplayed queue. Fabricated behavioural evidence, in a tool whose entire claim is "verdicts come from what was observed." Worst possible bug for this product. |
| **#6** | The README and pitch deck **claimed live sandboxed inspection and four parallel sub-agents** — the route ships replay + static, and the spec spawns two | We built a product that refuses to state conclusions it hasn't observed, then wrote docs that did exactly that. |

Two of those (#3 and #6) broke a promise we make in our own README. That is the strongest thing we can say about the tool: **it caught us being the thing we built the product to catch.**

Finding #6 also surprised us — we assumed a docs-only PR would get a rubber stamp. Instead it cross-referenced the prose against `app/api/inspect/route.ts` and `agent/manifest.ts` and found the gap. Reviewing *claims against implementation* turned out to be its highest-value behaviour.

---

## Where we disagreed

Being honest, since a review tool you never push back on isn't being read properly.

### 1. The CVE remedy — we took a different fix

Qodo's agent prompt said: *"As of the review date, Next.js recommends 15.5.24 for the maintained 15.5 release line."* Correct advice for a production app on a maintenance line. We went to **Next 16.3.3** instead: the project was two days old with nothing holding it to 15.x, and 15.5.4 was already flagged deprecated at install time. Agreed completely on the finding; chose a different remedy.

### 2. It advised *against* self-hosting fonts — we did it anyway

The PR #2 high-level assessment weighed "bundle or self-host fonts" and concluded: *"Provides limited value while system fallbacks already work."* We self-hosted via `next/font` regardless, because the fallback reasoning didn't account for our actual constraint — a demo on venue wifi, where a Google Fonts round-trip is a live dependency we can remove for free. It also cleared a `no-page-custom-font` lint warning.

Worth noting this appeared in the *advisory* section, not as a finding. The advisory suggestions were consistently the weakest part of the output — reasonable in general, but without enough context about what we were optimising for.

### 3. One severity we'd argue down

PR #4's "Trace fan-out is unbounded" was filed as a Performance bug. It's technically right, but the input was already capped at 256 KB, which bounds the fan-out in practice. We implemented the caps anyway — they were cheap, and surfacing truncation to the reader fit our honesty rules — but we'd have called it low rather than a bug worth the same weight as the denial defect.

**Everything else we agreed with on first read**, including several we'd have argued with before checking: the `inputSchema` vs `parameters` finding (MCP spec calls it `inputSchema`; we'd read only `parameters`, so every real MCP schema was hashing as `null`) came with a spec link that settled it immediately.

---

## What it missed

Not criticism so much as scope calibration — it's a diff reviewer, and these were outside a diff's reach:

- A `TypeScript` variance bug (`Omit` over a union collapsing to common keys) — caught by `tsc`, twice, in the same shape.
- Two of our own **test expectations** being wrong rather than the code (`http://also` is a valid URL; identical matches dedupe before hitting a cap). Tests caught those.
- It never had visibility into `.env.local`, which is correct — that file is gitignored and never reached a diff.

---

## Workflow friction

Two practical notes for anyone doing this on Windows:

- **Git Bash mangles slash commands.** `gh pr comment --body "/agentic_review"` gets path-converted into `C:/Program Files/Git/agentic_review`. Prefix with `MSYS_NO_PATHCONV=1`, or type the command in the GitHub UI.
- **Review latency was ~2–4 minutes** per PR, consistently. Fine for a hackathon cadence; we opened the next branch while waiting rather than blocking on it.

The `Relevance` block that cites *"similar findings in past PRs"* was a nice touch by PR #6 — it connected the docs overclaim to the earlier corrections in #3 and #5, which is exactly the connection a human reviewer with memory would have made.

---

## Would we use it again

Yes, and specifically for this kind of project. The value wasn't catching typos — it was **twice finding that our security architecture didn't do what we said it did**, in a codebase where that gap is the entire risk. Configuring the review guidelines with the threat model is what made that possible.
