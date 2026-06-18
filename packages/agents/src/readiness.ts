import type { Agent } from "@journeyman/core";
import { toolsRequireWorkspace } from "@journeyman/core";

export interface ReadinessError {
  field: string;
  message: string;
}

const IMPLEMENTED_PROVIDERS = new Set(["claude", "opencode", "aisdk"]);

/** Returns [] when the agent may be enabled; otherwise a list of blocking errors. */
export function checkReadiness(agent: Agent): ReadinessError[] {
  const errs: ReadinessError[] = [];

  if (!agent.name.trim()) errs.push({ field: "name", message: "Name is required" });
  if (!agent.instructions.trim()) errs.push({ field: "instructions", message: "Instructions are required" });
  if (!IMPLEMENTED_PROVIDERS.has(agent.provider)) errs.push({ field: "provider", message: "Choose an implemented provider" });
  if (!agent.model) errs.push({ field: "model", message: "Choose a model" });

  const usesWorkspace = toolsRequireWorkspace(
    agent.permissions.allowedTools.length ? agent.permissions.allowedTools : agent.tools,
  );
  if (usesWorkspace && !agent.sandboxId) errs.push({ field: "sandbox", message: "Workspace tools require a sandbox" });

  // Trigger config completeness (Phase 3).
  for (const t of agent.triggers) {
    if (t.type === "schedule" && (!t.cron?.trim() || !t.timezone?.trim())) {
      errs.push({ field: "triggers", message: "Schedule trigger needs a cron expression and timezone" });
    }
    if (t.type === "webhook" && !t.webhookId) {
      errs.push({ field: "triggers", message: "Webhook trigger is not fully provisioned" });
    }
  }

  // Required-input satisfiability (validates schedule, since it has no payload).
  const schedule = agent.triggers.find((t) => t.type === "schedule") as
    | Extract<Agent["triggers"][number], { type: "schedule" }>
    | undefined;
  if (schedule) {
    for (const f of agent.inputs) {
      const fixed = schedule.fixedInputs?.[f.name];
      const hasDefault = f.default !== undefined;
      if (f.required && fixed === undefined && !hasDefault) {
        errs.push({
          field: "inputs",
          message: `Required input "${f.name}" has no value the schedule can supply (add a default or fixed value)`,
        });
      }
    }
  }

  return errs;
}
