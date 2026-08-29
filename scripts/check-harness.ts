/**
 * TrueForge preflight.
 *
 * Answers the questions that actually block a live inspection, in order:
 * is the harness running, is a model configured, is a sandbox provider
 * configured, does the agent exist, and does the stored agent still carry the
 * controls this product depends on?
 *
 *   pnpm check-harness              # report
 *   pnpm check-harness --create     # create the agent if missing
 *   pnpm check-harness --update     # also repair a stored agent that has drifted
 *
 * Prints nothing that would leak a token or an API key.
 */

import {
  auditStoredManifest,
  capyguardManifest,
  CAPYGUARD_AGENT_NAME,
  CAPYGUARD_MODEL,
} from "../agent/manifest.ts";
import {
  DEFAULT_TRUEFORGE_BASE_URL,
  HarnessClient,
  HarnessError,
  loadHarnessConfig,
  type HarnessConfig,
} from "../lib/harness/client.ts";

function ok(message: string) {
  console.log(`  ✓ ${message}`);
}
function bad(message: string) {
  console.log(`  ✗ ${message}`);
}
function hint(message: string) {
  console.log(`    → ${message}`);
}

/** Standalone TrueForge on loopback is the documented default, so assume it. */
function resolveConfig(): HarnessConfig {
  const configured = loadHarnessConfig();
  if (configured) return configured;

  console.log(`  · TRUEFORGE_BASE_URL is unset, assuming ${DEFAULT_TRUEFORGE_BASE_URL}`);
  return { baseUrl: DEFAULT_TRUEFORGE_BASE_URL };
}

function nameOf(entry: { name?: string; id?: string }): string {
  return entry.name ?? entry.id ?? "(unnamed)";
}

const CREATE = process.argv.includes("--create");
const UPDATE = process.argv.includes("--update");

/** The env override is advertised in .env.example, so it has to be honoured here. */
const AGENT_NAME = process.env.CAPYGUARD_AGENT_NAME?.trim() || CAPYGUARD_AGENT_NAME;

const SPEC = capyguardManifest as unknown as Record<string, unknown>;

async function checkModels(client: HarnessClient): Promise<boolean> {
  const models = await client.listModels();

  if (models.length === 0) {
    bad("no models configured");
    hint("In the harness UI: Settings → Models.");
    hint("For an OpenAI-compatible endpoint choose the 'custom' provider and give it");
    hint("a base URL, an API key, and the model ids it serves.");
    return false;
  }

  const names = models.map(nameOf);
  ok(`${names.length} model(s) configured`);
  for (const name of names.slice(0, 12)) console.log(`      ${name}`);

  if (!names.includes(CAPYGUARD_MODEL)) {
    bad(`CAPYGUARD_MODEL is '${CAPYGUARD_MODEL}', which is not in that list`);
    hint("Set CAPYGUARD_MODEL in .env.local to one of the names above.");
    return false;
  }

  ok(`configured model '${CAPYGUARD_MODEL}' is available`);
  return true;
}

/**
 * The sandbox is not optional here.
 *
 * Executing the artifact is the product, and TrueForge resolves name-only
 * skills by materialising them into a sandbox, so without a provider this
 * agent cannot do either. Reporting "live inspection is available" in that
 * state would be exactly the kind of overclaim the verdicts refuse to make.
 */
async function checkSandbox(client: HarnessClient): Promise<boolean> {
  let providers: Array<{ name?: string; type?: string }>;
  try {
    providers = await client.listSandboxProviders();
  } catch (error) {
    bad(`could not read sandbox providers: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }

  if (providers.length === 0) {
    bad("no sandbox provider configured");
    hint("Settings → Sandbox providers. A Daytona key needs sandbox access plus");
    hint("snapshot-create permission, or the provider fails validation.");
    hint("The built-in local fallback is macOS/Linux only, so it is unavailable on Windows.");
    return false;
  }

  ok(`sandbox provider configured (${providers.map((p) => p.type ?? nameOf(p)).join(", ")})`);
  return true;
}

async function checkAgent(client: HarnessClient): Promise<boolean> {
  const agents = await client.listAgents();
  const existing = agents.find((a) => nameOf(a) === AGENT_NAME);

  if (!existing) {
    bad(`no agent named '${AGENT_NAME}'`);
    if (!CREATE) {
      hint("Create it with: pnpm check-harness --create");
      return false;
    }
    await client.createAgent(AGENT_NAME, SPEC);
    ok(`created agent '${AGENT_NAME}'`);
    return true;
  }

  ok(`agent '${AGENT_NAME}' exists`);

  // A matching name proves nothing about what the stored spec contains.
  if (!existing.id) {
    bad("the harness did not return an id for it, so its manifest cannot be verified");
    return false;
  }

  const stored = await client.getAgent(existing.id);
  const audit = auditStoredManifest(stored.manifest);

  if (audit.ok) {
    ok("its stored manifest still carries the required controls");
    return true;
  }

  bad("its stored manifest has drifted from this repo:");
  for (const problem of audit.problems) console.log(`      · ${problem}`);

  if (!UPDATE) {
    hint("Repair it with: pnpm check-harness --update");
    return false;
  }

  await client.updateAgent(existing.id, AGENT_NAME, SPEC);
  ok("updated the stored manifest to match this repo");
  return true;
}

async function main(): Promise<number> {
  console.log("\nCapyGuard — TrueForge preflight\n");

  let config: HarnessConfig;
  try {
    config = resolveConfig();
  } catch (error) {
    bad(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const client = new HarnessClient(config);
  ok(`harness ${config.baseUrl}${config.token ? " (token set)" : " (standalone, no token)"}`);

  let modelReady = false;
  try {
    modelReady = await checkModels(client);
  } catch (error) {
    bad("the harness is not reachable");
    if (error instanceof HarnessError && error.status) {
      hint(`server responded ${error.status}`);
    } else {
      hint("Start it with: npx @truefoundry/trueforge@latest");
      hint("On Windows the server does not boot (an ESM path bug in 0.1.4 and the rc),");
      hint("so run it inside WSL2 from your Linux home directory — not /mnt/c —");
      hint("and localhost forwarding will make it reachable from Windows.");
    }
    console.log(
      "\n  Live inspection is unavailable. Replay and static modes still work,\n  which is what the demo runs on.\n",
    );
    return 1;
  }

  const sandboxReady = await checkSandbox(client);

  let agentReady = false;
  try {
    agentReady = await checkAgent(client);
  } catch (error) {
    bad(`could not read or write the agent: ${error instanceof Error ? error.message : String(error)}`);
  }

  const ready = modelReady && sandboxReady && agentReady;
  console.log(
    ready
      ? "\n  Live inspection is available."
      : "\n  Live inspection is not available yet. Replay and static modes still work,\n  which is what the demo runs on.",
  );
  return ready ? 0 : 1;
}

main()
  .then((code) => {
    console.log("");
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
