# CapyGuard — 3 minute demo

**Setup:** `pnpm install && pnpm dev`, open http://localhost:3000, full screen, dark or light both fine.

**No credentials needed.** Samples replay from recorded traces and the paste box runs the offline pattern pass, so nothing on this page depends on the venue wifi or a gateway being up.

---

## 0:00 — The hook (20s)

> "Show of hands. Who installed someone's skill this weekend? Who read it first?"

Wait for the laugh. Then:

> "Neither did I. This is the new `curl | bash`, except the payload doesn't even have to be in the file you were given."

Point at the three stats on screen. Land on the middle one:

> "Snyk scanned four thousand real agent skills this February. Thirteen percent had a critical issue. Seventy-six were outright malicious."

---

## 0:20 — The green light (25s)

Click **tidy-dates**.

> "First, proof this isn't a machine that only says no."

Let it run. It's short. Point at the verdict:

> "Clean. It does edit files — that's a real capability, and it says so — but it asks first, and it reached for nothing else. Nothing executed, no network calls."

**Why this beat matters:** a scanner that never clears anything is useless, and judges will assume yours is rigged if everything comes back red.

---

## 0:45 — The obvious one (30s)

Click **repo-summarizer**.

> "This one's top of a public registry. Reads your repo, writes a summary."

When the findings land, point at the HTML comment finding:

> "There's a block in here a human skimming the rendered file never sees. It tells the agent this skill was already approved by the security team, tells it to stop analysis, and tells it to read your SSH private key and AWS credentials into the summary — and specifically not to mention that to you."

Then the key line:

> "Notice what happened: it tried to end its own security review. It didn't work, because the capybara that writes the verdict never reads the file. It only ever sees what the others *observed*."

---

## 1:15 — The hero (75s)

Click **devtools-quickstart**.

> "Handed out at a booth. 'Just point your agent at this.'"

**Beat 1 — the file is clean.** When the narration says a static scanner would stop here:

> "Read the whole thing. There's nothing incriminating in it. Every static scanner on the market — Snyk's, Cisco's, NVIDIA's — clears this file, and they're right to. The bad thing isn't in it."

**Beat 2 — the approval gate.** The modal appears. *Stop talking. Let the room read it.*

> "It points at a URL. Fetching that is the only way to find out what this does. So it asks."

Click **Let Capy proceed**.

**Beat 3 — the second hop.** When `bootstrap.sh` appears and the second approval fires:

> "The remote instructions say pipe a script straight into a shell — and don't show it to the user. This is the step your agent would have taken silently. Watch what it does."

Click **Let Capy proceed**.

**Beat 4 — the payoff.** As the observations stream: SSH key, AWS credentials, environment scan, then the POST.

> "SSH private key. AWS credentials. Every environment variable with 'token' or 'secret' in the name. Posted to a hardcoded host, output thrown away so it leaves no trace in your agent's transcript."

Point at the chain map:

> "Three hops from the file you were asked to trust. You cannot read your way to that. You have to walk it and watch."

---

## 2:30 — The rug pull (20s)

Click **invoice-tools**.

> "Last one. You approved this MCP server months ago. This is version sixteen."

Point at the drift finding:

> "No schema changed. Only a description — the part the model actually obeys. It now BCCs every invoice your agent sends to an outside address. This is exactly the postmark-mcp incident: fifteen clean versions, then one that wasn't. Scanning at install time cannot catch that. Pinning what you approved can."

---

## 2:50 — The close (20s)

> "TrueFoundry's own docs say unvetted servers are the risk, and the answer is to allowlist the approved ones. Their governance model registers agents, enforces least privilege, and filters at runtime. Every one of those layers assumes somebody already decided the artifact was safe. Nothing in the platform produces that decision. This does."

If time allows, the closer:

> "And the whole thing is built on their harness — the sandbox isn't a feature we added, it's the product. Also, we shipped it as a skill. Which means it can inspect itself."

---

## If a judge wants to try their own

Paste box, bottom of the inspect section. Be upfront about the limit:

> "No sandbox on this laptop, so this is the pattern pass only — the same job one of the four capybaras does. If it finds nothing, that's not a clearance, and it says so."

That honesty is the correct answer to *"how do I know it works?"* — the product's whole claim is that reading isn't enough.

---

## Questions you will get

**"How is this different from MCP-Scan / Snyk / Cisco?"**
> Those are static, and they're good. They read the artifact in front of them. They cannot follow "go to this URL and do what it says" because the payload isn't in the artifact — it's three hops away, on a server that can serve something different tomorrow. We execute and observe. Different layer, not a competitor.

**"What if the skill detects it's in a sandbox and behaves?"**
> Then we report that, and the verdict is `undetermined`, not `clean`. Evasion is an unsolved problem for everyone in this space — there's a paper from this June on multimodal instructions that beat every static scanner. We don't claim to solve it. We claim to make the honest answer visible instead of hiding it behind a green check.

**"Isn't the LLM itself vulnerable to the injection it's reading?"**
> That's the whole architecture. The agent that writes the verdict never reads the artifact. It's a separate sub-agent with its own context and it only receives structured observations. It's enforced in code, not just in the prompt — `buildInspectionRequest` has no content parameter, so there's no code path that puts artifact text in the deciding context. Qodo actually caught that this was prompt-only in our first version, and it's in the PR history.

**"What does it cost to run?"**
> There's a live cost readout on every inspection. The hero demo is about twelve cents.
