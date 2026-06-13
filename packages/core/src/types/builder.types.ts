import type { CustomAiStepCreateInput } from "./custom-steps.types.ts";
import type { CanonicalTool } from "./coding-tools.types.ts";
import type { WorkflowGraph } from "./flow.types.ts";

/** A custom step the Builder proposes to create. `id` is the placeholder the
 *  workflow's nodes reference (config.customStepId) until Apply assigns a real id. */
export interface ProposedCustomStep {
  id: string;
  step: CustomAiStepCreateInput;
}

export type StepKind = "trigger" | "ai" | "provider" | "human-task" | "webhook-wait";

/** Per-node "what this step uses", surfaced in the preview. */
export interface StepBinding {
  nodeId: string;
  stepKind: StepKind;
  uses: {
    tools?: CanonicalTool[];
    mcpIds?: string[];
    skillIds?: string[];
    model?: string;
    connection?: string;
    sandboxId?: string;
    /** Secret slots tagged by name (convention) — values never carried in the plan. */
    secrets?: { slot: string; secretName: string | null }[];
  };
  io: {
    inputs: { name: string; from: string }[];
    outputs: { name: string; type: string }[];
  };
}

export type GapKind =
  | "mcp" | "skill" | "sandbox" | "connection" | "webhook"
  | "capability"        // no catalog step covers the action
  | "not-implemented";  // a needed provider/operation/node exists in name but is a stub

export interface Gap {
  id: string;
  kind: GapKind;
  /** The step(s) this blocks — a gap can span steps. */
  nodeIds: string[];
  reason: string;
  required: boolean;
  /** Pointer to the existing config UI; null for capability gaps. */
  fixHint: string | null;
}

export interface BuildPlan {
  newCustomSteps: ProposedCustomStep[];
  workflow: WorkflowGraph;
  defaults: { sandboxId: string | null; model: string | null };
  stepBindings: StepBinding[];
  gaps: Gap[];
  summary: string;
}
