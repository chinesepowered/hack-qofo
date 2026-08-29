# ⚙️ Working with TrueForge

Notes from building CapyGuard on the TrueForge agent harness, including a pivot from the managed TrueFoundry Agent Harness to open-source TrueForge partway through.

---

## Why the harness was the right substrate

CapyGuard inspects untrusted agent skills by executing them and watching what they do. That makes the harness load-bearing rather than incidental:

- **Sandbox** — executing untrusted instructions *is* the product.
- **Sub-agents** — context isolation is our injection defence. The agent that writes the verdict must never share a context with attacker-controlled text. This is a harness primitive we could not have rebuilt credibly in a wrapper.
- **Approval gates** — `require_approval_for_tools` turns "this wants network egress" into a human decision, which is also the best moment in our demo.
- **Skills** — detection playbooks versioned separately from the agent.
- **Generative UI** — the verdict card and chain map as agent output.

The design that made the whole thing work is **sandbox-as-tool**: provisioning a sandbox only when execution is needed, rather than pinning one per session. For a product that inspects many artifacts, that's the right shape.

---

## What went well

**`npx @truefoundry/trueforge@latest` is a genuinely good front door.** One command, SQLite, no account, no gateway, no API key. Compared with the managed path (tenant discovery, virtual accounts, model provisioning) this was dramatically less friction.

**The docs are unusually machine-readable.** `llms.txt` plus a published `openapi.json` meant we could get exact endpoint paths, the full `AgentSpec` schema, and the complete event-type list without guessing. The OpenAPI spec settled several questions the prose didn't.

**The agent spec is well-designed.** JSON, `snake_case`, only `model` required, everything else defaulted. Being able to reference an agent by saved name *or* inline a spec at session creation is the right pair of options.

**The event stream is clean.** Twelve event types, deltas merged by shared `id`, `thread_id` distinguishing sub-agent threads from run-level events, and `subscribe` with an exclusive `after_sequence_number` cursor for reconnects. We modelled our UI directly on it.

---

## What cost us time

### 🪟 It does not run on Windows

The biggest one. Verified on both `0.1.4` and `@rc`:

```
warn  Local sandbox fallback is unavailable
      {"reason":"LocalSandboxProvider supports macOS and Linux only (got win32)"}
Failed to start server: Only URLs with a scheme in: file, data, and node are
supported by the default ESM loader. On Windows, absolute paths must be valid
file:// URLs. Received protocol 'c:'
```

Two separate problems stacked:

1. **The server won't boot at all** — an ESM loader path bug, where an absolute Windows path is passed somewhere expecting a `file://` URL. This looks like a small fix and it's the difference between "works" and "doesn't exist" for Windows users.
2. **The local sandbox provider is macOS/Linux only**, which is documented behaviour but compounds the first problem.

Worth flagging that a third-party sandbox provider like Daytona does **not** work around problem 1 — you can't configure a provider inside a server that won't start. Our resolution was to run the harness under WSL2 while keeping the app on Windows; localhost forwarding makes that transparent. A line in the quickstart saying "Windows users: run under WSL2" would have saved us an hour.

### 🧭 Managed vs open-source is easy to conflate

We started against the managed Agent Harness because that's what the sponsor docs describe, and only later learned TrueForge is the open-source harness underneath. The two have **different agent manifest shapes**, which is a real trap:

| | Managed | TrueForge |
|---|---|---|
| `type: "truefoundry-agent"` | required | absent |
| `collaborators` | required | absent |
| `name` | in the manifest | sibling of `manifest` in the create request |
| `skills` | `{type, fqn}` registry refs | `{name}` only |
| `mcp_servers[].type` | required | absent |
| compaction threshold | `compaction_threshold_tokens` | `trigger: {type, value}` |
| SDK | Python | TypeScript |

Both are called "the agent manifest" in their respective docs. A short "if you're coming from the managed product, here's what differs" page would help — the schemas are close enough that a partial port compiles and then fails at runtime.

### 🔑 Tenant discovery on the managed side

Before pivoting, the hardest single thing to find was the gateway URL. The tenant is the **first path segment** (`https://gateway.truefoundry.ai/<tenant>`), which isn't stated plainly, and agent sessions live under `/v1` while the OpenAI-compatible inference route lives elsewhere at `/api/llm/api/inference/openai/v1` and is *not* tenant-scoped.

We eventually found the tenant by requesting a path with a deliberately wrong first segment, because the error names it:

```
Tenant mismatch: tenant 'ourtenant' does not match requested tenant 'api'
```

That's a good error message doing accidental documentation work. Putting the full base URL in the UI next to the API key would remove the need for it.

### 🧪 Two sandbox gotchas worth documenting louder

- **The sandbox is off by default** (`config.sandbox.enabled`). Reasonable default, but for us it's mandatory.
- **Name-only skills require the sandbox**, because TrueForge materialises skill packs into it. We hit this as a surprise: skills silently do nothing without a sandbox provider configured. This is documented, but it deserves to be adjacent to the skills quickstart rather than on the sandbox page.
- **Daytona needs both sandbox access and snapshot-create permission**, or provider validation fails. The docs do say this, and it's the kind of thing that's easy to miss when generating a key quickly.

### 📄 Docs gaps we worked around

- **No curl examples anywhere.** Everything is the TypeScript SDK. We were talking to the HTTP API directly (we re-broadcast the stream to a browser as SSE anyway), so we worked from `openapi.json`. A couple of raw HTTP examples would help anyone not using the TS SDK.
- **Sandbox network behaviour is unspecified.** We couldn't determine from the docs whether outbound egress from a sandbox can be monitored or restricted. That matters a lot for our use case — observing attempted network calls is our primary evidence. We designed around it by pointing demo payloads at a honeypot we control, but native egress logging would be a genuinely valuable feature for any security-flavoured agent.
- **No Python SDK** on the OSS side (there is one for managed). Not a problem for us — TypeScript matched our Next.js stack perfectly — but worth knowing before you pick.

---

## What we shipped against it

- A full `AgentSpec` (`agent/manifest.ts`) with sandbox, dynamic sub-agents, generative UI, approval-gated MCP writes, capped large tool responses, and a structured JSON-schema verdict.
- An SSE client for the `/api/v1` session and turn API, with reconnect via `subscribe`, bounded frame buffering, abort handling that survives an idle upstream, and token redaction in error paths.
- A preflight (`pnpm check-harness`) that verifies reachability, configured models, sandbox provider, and — importantly — that a *stored* agent still carries the required security controls, since a matching name proves nothing about its manifest.

Not yet wired: driving a live session from the web route. The client and spec are in place and tested; the route currently serves recorded and static inspections. We'd rather say that than imply otherwise.

---

## Suggestions, in priority order

1. **Fix the Windows boot bug**, or say "use WSL2" in the quickstart. It's currently a hard wall with a confusing error.
2. **Add a managed-vs-OSS manifest differences page.** The two shapes are similar enough to be dangerous.
3. **Document sandbox network behaviour** — egress visibility and controls, if any.
4. **Put skills' sandbox dependency next to the skills docs**, not only on the sandbox page.
5. **A few raw HTTP examples** alongside the TypeScript SDK.

None of these changed our decision. The harness gave us a security property — sub-agent context isolation — that is genuinely hard to build yourself and is the single thing that makes our verdicts defensible.
