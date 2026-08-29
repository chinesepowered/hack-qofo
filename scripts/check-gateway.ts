/**
 * Gateway preflight.
 *
 * Answers the four questions that actually block a live inspection, in order:
 * are the credentials present, do they authenticate, can the key reach a model,
 * and does the agent exist?
 *
 *   pnpm check-gateway
 *
 * Prints nothing that would leak the key.
 */

import { capyguardManifest, CAPYGUARD_AGENT_NAME, CAPYGUARD_MODEL } from "../agent/manifest.ts";
import { loadHarnessConfig } from "../lib/harness/client.ts";

const TENANT_MISMATCH = /tenant '([^']+)' does not match requested tenant/;

/** The OpenAI-compatible inference route sits outside the tenant-scoped path. */
const INFERENCE_BASE = "https://gateway.truefoundry.ai/api/llm/api/inference/openai/v1";

function ok(message: string) {
  console.log(`  ✓ ${message}`);
}
function bad(message: string) {
  console.log(`  ✗ ${message}`);
}
function hint(message: string) {
  console.log(`    → ${message}`);
}

async function checkModelAccess(apiKey: string): Promise<boolean> {
  let listed: string[] = [];
  try {
    const res = await fetch(`${INFERENCE_BASE}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      const body = (await res.json()) as { data?: Array<{ id?: string }> };
      listed = (body.data ?? []).map((m) => m.id ?? "").filter(Boolean);
    }
  } catch {
    /* fall through to the completion probe */
  }

  if (listed.length > 0) {
    ok(`${listed.length} model(s) available`);
    for (const id of listed.slice(0, 12)) console.log(`      ${id}`);
    if (!listed.includes(CAPYGUARD_MODEL)) {
      bad(`CAPYGUARD_MODEL is '${CAPYGUARD_MODEL}', which is not in that list`);
      hint("Set CAPYGUARD_MODEL in .env.local to one of the ids above.");
      return false;
    }
    ok(`configured model '${CAPYGUARD_MODEL}' is available`);
    return true;
  }

  // An empty list is not proof of nothing: try the configured model directly.
  const res = await fetch(`${INFERENCE_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CAPYGUARD_MODEL,
      max_tokens: 8,
      messages: [{ role: "user", content: "ping" }],
    }),
  });

  if (res.ok) {
    ok(`model '${CAPYGUARD_MODEL}' responds`);
    return true;
  }

  const body = await res.text();
  bad(`no model access (${res.status}) for '${CAPYGUARD_MODEL}'`);
  if (/not authorized to access model/.test(body)) {
    hint("The gateway reports this key is not authorised for any model, and the");
    hint("model list came back empty — so this is a provisioning issue on the");
    hint("account, not a wrong model name. Ask whoever issued the key to attach");
    hint("models to this virtual account.");
  } else {
    hint(body.slice(0, 200));
  }
  return false;
}

async function main(): Promise<number> {
  console.log("\nCapyGuard gateway preflight\n");

  let config;
  try {
    config = loadHarnessConfig();
  } catch (error) {
    bad(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (!config) {
    bad("TFY_GATEWAY_URL and TFY_API_KEY are not both set.");
    hint("The app still runs: samples replay and pasted artifacts get the static pass.");
    hint("To go live, copy .env.example to .env.local and fill it in.");
    return 1;
  }

  ok(`gateway ${config.baseUrl}`);
  ok(`api key present (${config.apiKey.length} chars, not shown)`);

  const agentName = process.env.CAPYGUARD_AGENT_NAME?.trim() || CAPYGUARD_AGENT_NAME;
  const url = `${config.baseUrl}/v1/agents/sessions?agent_name=${encodeURIComponent(agentName)}`;

  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${config.apiKey}` } });
  } catch (error) {
    bad(`could not reach the gateway: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const body = await response.text();

  if (response.status === 401) {
    const mismatch = TENANT_MISMATCH.exec(body);
    bad("authentication failed");
    if (mismatch) {
      hint(`Your key belongs to tenant '${mismatch[1]}'.`);
      hint(`Set TFY_GATEWAY_URL to https://gateway.truefoundry.ai/${mismatch[1]}`);
    } else {
      hint("Check that the key is current and has not been revoked.");
    }
    return 1;
  }

  ok("authenticated, and the agent API is reachable");

  const modelOk = await checkModelAccess(config.apiKey);

  const agentMissing = body.includes("not found") && body.includes(agentName);
  if (agentMissing) {
    bad(`no agent named '${agentName}' exists in this workspace`);
    hint("Create it in the TrueFoundry console under Agents > Playground,");
    hint("using the manifest below. Run with --print-manifest to see it.");
    if (process.argv.includes("--print-manifest")) {
      console.log(`\n${JSON.stringify(capyguardManifest, null, 2)}`);
    }
  } else if (response.ok) {
    ok(`agent '${agentName}' exists`);
  }

  const ready = modelOk && !agentMissing && response.ok;
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
