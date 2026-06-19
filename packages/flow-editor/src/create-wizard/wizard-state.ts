import type {
  WorkflowGraph,
  WorkflowDefaults,
} from "@journeyman/core";
import { createBlankFlow } from "../state/flow-graph.ts";

export type WizardMode = "create" | "edit";
export type WizardStepId = "basics" | "config" | "inputs" | "review";

export interface WizardMeta {
  name: string;
  description: string;
}

export interface WizardDraft {
  meta: WizardMeta;
  graph: WorkflowGraph;
}

export interface CreateFlowArgs {
  name: string;
  description?: string;
  definition: WorkflowGraph;
}

/** Sensible defaults pre-filled on a fresh create draft, so the config step is a quick confirm. */
export function seedDefaults(): WorkflowDefaults {
  return {
    executorConfig: { "coding-cli": { provider: "claude" } },
    retry: { enabled: true, maxAttempts: 2, backoff: "exponential", backoffSeconds: 5 },
  };
}

/** A fresh create-mode draft: blank graph + seeded defaults + default meta. */
export function createDraft(): WizardDraft {
  const graph = createBlankFlow();
  return {
    meta: { name: "New flow", description: "" },
    graph: { ...graph, defaults: { ...seedDefaults(), ...(graph.defaults ?? {}) } },
  };
}

/** An edit-mode draft seeded from a live graph. Deep-copied so Cancel discards cleanly. */
export function draftFromGraph(graph: WorkflowGraph, meta: WizardMeta): WizardDraft {
  return { meta: { ...meta }, graph: structuredClone(graph) };
}

const CREATE_STEPS: WizardStepId[] = ["basics", "config", "inputs", "review"];
const EDIT_STEPS: WizardStepId[] = ["config", "inputs", "review"];

export function stepsForMode(mode: WizardMode): WizardStepId[] {
  return mode === "create" ? CREATE_STEPS : EDIT_STEPS;
}

/** Whether the user may advance past `step`. Only basics gates (on a non-empty name). */
export function canAdvance(step: WizardStepId, draft: WizardDraft): boolean {
  if (step === "basics") return draft.meta.name.trim().length > 0;
  return true;
}

/** Non-blocking warnings for the inputs step: empty or duplicate input names. */
export function inputNameWarnings(graph: WorkflowGraph): string[] {
  const defs = graph.inputDefs ?? [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  defs.forEach((d, i) => {
    const name = d.name.trim();
    if (!name) {
      warnings.push(`Input ${i + 1} has no name.`);
    } else if (seen.has(name)) {
      warnings.push(`Duplicate input name "${name}".`);
    } else {
      seen.add(name);
    }
  });
  return warnings;
}

/** Build the argument object for the web `createFlow` API from a finished draft. */
export function buildCreateArgs(draft: WizardDraft): CreateFlowArgs {
  return {
    name: draft.meta.name.trim(),
    description: draft.meta.description.trim() || undefined,
    definition: draft.graph,
  };
}
