/**
 * TrueForge preflight.
 *
 * Answers the questions that actually block a live inspection, in order:
 * is the harness running, is a model configured, is a sandbox provider
 * configured, and does the agent exist?
 *
 *   pnpm check-harness              # report
 *   pnpm check-harness --create     # also create the agent if missing
 *
 * Prints nothing that would leak a token or an API key.
 */

import { capyguardManifest, CAPYGUARD_AGENT_NAME, CAPYGUARD_MODEL } from "../agent/manifest.ts";
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

  // 1. Is it running?
  let models: Array<{ name?: string; id?: string }>;
  try {
    models = await client.listModels();
  } catch (error) {
    bad("the harness is not reachable");
    if (error instanceof HarnessError && error.status) {
      hint(`server responded ${error.status}`);
    } else {
      hint("Start it with: npx @truefoundry/trueforge@latest");
      hint("On Windows the server does not boot (ESM path bug in 0.1.4 and the rc),");
      hint("so run it inside WSL2 from your Linux home directory — not /mnt/c —");
      hint("and localhost forwarding will make it reachable from Windows.");
    }
    console.log("\n  Live inspection is unavailable. Replay and static modes still work,\n  which is what the demo runs on.\n");
    return 1;
  }
  ok("harness is running");

  // 2. Is a model configured, and is it the one we ask for?
  let modelReady = false;
  if (models.length === 0) {
    bad("no models configured");
    hint("Open the harness UI, then Settings → Models.");
    hint("For an OpenAI-compatible endpoint choose the 'custom' provider and give it");
    hint("a base URL, an API key, and the model ids it serves.");
  } else {
    const names = models.map(nameOf);
    ok(`${names.length} model(s) configured`);
    for (const name of names.slice(0, 12)) console.log(`      ${name}`);

    if (names.includes(CAPYGUARD_MODEL)) {
      ok(`configured model '${CAPYGUARD_MODEL}' is available`);
      modelReady = true;
    } else {
      bad(`CAPYGUARD_MODEL is '${CAPYGUARD_MODEL}', which is not in that list`);
      hint("Set CAPYGUARD_MODEL in .env.local to one of the names above.");
    }
  }

  // 3. Does the agent exist?
  let agentReady = false;
  try {
    const agents = await client.listAgents();
    const existing = agents.find((a) => nameOf(a) === CAPYGUARD_AGENT_NAME);

    if (existing) {
      ok(`agent '${CAPYGUARD_AGENT_NAME}' exists`);
      agentReady = true;
    } else if (process.argv.includes("--create")) {
      await client.createAgent(
        CAPYGUARD_AGENT_NAME,
        capyguardManifest as unknown as Record<string, unknown>,
      );
      ok(`created agent '${CAPYGUARD_AGENT_NAME}'`);
      agentReady = true;
    } else {
      bad(`no agent named '${CAPYGUARD_AGENT_NAME}'`);
      hint("Create it with: pnpm check-harness --create");
    }
  } catch (error) {
    bad(`could not read or create the agent: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 4. Sandbox — not fatal to report on, but the product does nothing without it.
  console.log("");
  console.log("  Sandbox: required for this agent (skills also need it).");
  hint("Settings → Sandbox providers. Daytona needs sandbox access plus");
  hint("snapshot-create permission, or the provider fails validation.");
  hint("The built-in local fallback is macOS/Linux only, so it is unavailable");
  hint("on Windows even when the harness itself is reachable.");

  const ready = modelReady && agentReady;
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
