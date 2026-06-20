import type { Agent, AgentUpdateInput } from "@journeyman/core";
import type { SectionId } from "./sections/SectionNav.tsx";

/** The editable subset of an Agent — exactly what the page can change & save. */
export function buildUpdateInput(a: Agent): AgentUpdateInput {
  return {
    instructions: a.instructions,
    inputs: a.inputs,
    provider: a.provider,
    model: a.model,
    sandboxId: a.sandboxId,
    repoSelections: a.repoSelections,
    triggers: a.triggers,
    behavior: a.behavior,
    outputMode: a.outputMode,
    limits: a.limits,
    permissions: a.permissions,
    tools: a.tools,
    notifications: a.notifications,
  };
}

/** True when the working copy differs from the original in any editable field. */
export function isAgentDirty(original: Agent, current: Agent): boolean {
  return JSON.stringify(buildUpdateInput(original)) !== JSON.stringify(buildUpdateInput(current));
}

/** One-line header summary, e.g. "claude · 2 repositories". */
export function agentSummary(a: Agent): string {
  const n = a.repoSelections.length;
  return `${a.provider} · ${n} ${n === 1 ? "repository" : "repositories"}`;
}

/** Badge text: ENABLED when locked, else the uppercased status. */
export function statusLabel(a: Agent): string {
  return a.enabled ? "ENABLED" : a.status.toUpperCase();
}

/** Which Agent fields each section owns. Keys are the saveable sections only. */
const SECTION_FIELDS: Partial<Record<SectionId, readonly (keyof Agent)[]>> = {
  instructions: ["instructions", "inputs"],
  workspace:    ["provider", "model", "sandboxId", "repoSelections"],
  triggers:     ["triggers"],
  behavior:     ["behavior", "limits", "outputMode"],
  permissions:  ["permissions", "tools"],
  notifications:["notifications"],
};

/** Section IDs that have a save action (Runs and Delete are excluded). */
export const SAVEABLE_SECTION_IDS: readonly SectionId[] = [
  "instructions", "workspace", "triggers", "behavior", "permissions", "notifications",
];

/** True when any of the section's owned fields differ between original and current. */
export function isSectionDirty(original: Agent, current: Agent, section: SectionId): boolean {
  const fields = SECTION_FIELDS[section] ?? [];
  return fields.some((f) => JSON.stringify(original[f]) !== JSON.stringify(current[f]));
}

/** Extract only a section's owned fields as an AgentUpdateInput for the PATCH body. */
export function buildSectionUpdateInput(a: Agent, section: SectionId): AgentUpdateInput {
  const fields = SECTION_FIELDS[section] ?? [];
  return Object.fromEntries(fields.map((f) => [f, a[f]])) as AgentUpdateInput;
}
