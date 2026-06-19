import type { Agent, AgentUpdateInput } from "@journeyman/core";

/** The editable subset of an Agent — exactly what the page can change & save. */
export function buildUpdateInput(a: Agent): AgentUpdateInput {
  return {
    instructions: a.instructions,
    inputs: a.inputs,
    provider: a.provider,
    model: a.model,
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
