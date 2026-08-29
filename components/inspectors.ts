import type { CapyAccessory } from "./capybara";

/**
 * The four inspector capybaras.
 *
 * These map 1:1 onto sub-agents in the harness manifest. The split is not
 * cosmetic: Pip (the verdict scribe) is deliberately kept away from raw
 * untrusted text so that a hostile artifact cannot argue its own way to a
 * clean verdict. Pip only ever sees structured observations from the others.
 */
export type InspectorRole = "nibbles" | "momo" | "yuzu" | "pip";

export interface Inspector {
  id: InspectorRole;
  name: string;
  title: string;
  accessory: CapyAccessory;
  blurb: string;
  /** Why this needs its own isolated context, in reviewer-facing terms. */
  isolationReason: string;
  accent: string;
}

export const INSPECTORS: Inspector[] = [
  {
    id: "nibbles",
    name: "Nibbles",
    title: "Chain Follower",
    accessory: "headlamp",
    blurb:
      "Walks every hop the instructions ask for — fetch this URL, run that script, read those notes — one layer at a time.",
    isolationReason:
      "Runs in a throwaway context. Anything it reads is attacker-controlled, so it must never share a context with the verdict.",
    accent: "var(--color-yuzu)",
  },
  {
    id: "momo",
    name: "Momo",
    title: "Pattern Reader",
    accessory: "glasses",
    blurb:
      "Reads the artifact for known poison patterns: hidden instructions, tool shadowing, dynamic-context commands that fire before the model ever sees the skill.",
    isolationReason:
      "Reports pattern hits as structured findings, never as prose the next agent could be steered by.",
    accent: "var(--color-spring)",
  },
  {
    id: "yuzu",
    name: "Yuzu",
    title: "Behaviour Watcher",
    accessory: "yuzu",
    blurb:
      "Watches what the artifact actually does once it runs — files touched, processes spawned, and every network call it attempts.",
    isolationReason:
      "Observes the sandbox from outside it. Its evidence is events that happened, not claims that were made.",
    accent: "var(--color-safe)",
  },
  {
    id: "pip",
    name: "Pip",
    title: "Verdict Scribe",
    accessory: "pencil",
    blurb:
      "Weighs the observed evidence and writes the report. Pip is the only one who decides — and the only one who never reads the hostile text.",
    isolationReason:
      "Sees structured observations only. This is what makes the verdict injection-resistant by construction.",
    accent: "var(--color-danger)",
  },
];

export const INSPECTOR_BY_ID = Object.fromEntries(
  INSPECTORS.map((i) => [i.id, i]),
) as Record<InspectorRole, Inspector>;
