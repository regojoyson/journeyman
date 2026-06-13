import type { CanonicalTool } from "@journeyman/core";
import type { WorkflowInputDef } from "@journeyman/core";
import type { ProposedCustomStep } from "@journeyman/core";

/** A value bound to a step input slot, expressed at intent level. */
export type InputIntent =
  | { from: "literal"; value: unknown }
  | { from: "workflow-input"; name: string }
  | { from: "workflow-attribute"; name: string }
  | { from: "step-output"; stepRef: string; field: string } // stepRef = a StepIntent.ref
  | { from: "template"; template: string };                  // raw text with {{ refs }} (intent refs)

export interface InputBindingIntent {
  slot: string;
  value: InputIntent;
}

/** One mapping from the webhook payload into a workflow input. */
export interface WebhookInputIntent {
  name: string;
  type: WorkflowInputDef["type"];
  fromPath: string; // JSONPath into the payload, e.g. "$.pull_request.number"
}

export type TriggerIntent =
  | { kind: "manual" }
  | {
      kind: "webhook";
      /** existing webhook record id, or null if it's a gap to resolve. */
      webhookId: string | null;
      listensFor?: string[];
      inputs?: WebhookInputIntent[];
    }
  | { kind: "form"; inputs?: WebhookInputIntent[] };

export type StepKindIntent = "provider" | "ai" | "human-task" | "webhook-wait";

export interface StepIntent {
  /** intent-local handle the LLM uses to wire other steps to this one's output. */
  ref: string;
  kind: StepKindIntent;
  label: string;
  /** built-in/provider/custom-ai step type (e.g. "get-issue", "custom-ai"); omitted for waits. */
  stepType?: string;
  /** for custom-ai: existing id OR a ProposedCustomStep placeholder id. */
  customStepId?: string;
  /** for provider steps: chosen provider value (e.g. "github", "jira"). */
  provider?: string;
  /** AI bindings. */
  model?: string;
  tools?: CanonicalTool[];
  mcpIds?: string[];
  skillIds?: string[];
  sandboxId?: string;
  /** provider connection/credential name (a secret). */
  connection?: string;
  /** secret slots tagged by name (convention) — values never carried. */
  secrets?: { slot: string; secretName: string | null }[];
  /** input wiring. */
  inputs?: InputBindingIntent[];
  /** webhook-wait config: which webhook it waits on (id or null=gap). */
  waitWebhookId?: string | null;
  /** human-task config. */
  assignee?: string;
  taskPrompt?: string;
}

/** A simple comparison the LLM expresses; compiled to a JSONLogic condition. */
export interface ConditionIntent {
  left:
    | { from: "step-output"; stepRef: string; field: string }
    | { from: "workflow-input"; name: string };
  op: "==" | "!=" | "<" | "<=" | ">" | ">=";
  right: string | number | boolean | null;
}

/** One conditional branch off a gateway. */
export interface BranchIntent {
  /** unique branchLabel among the gateway's conditional edges. */
  label: string;
  condition: ConditionIntent;
  /** the arm's steps (a sub-chain); empty ⇒ branch goes straight to end. */
  steps: StepIntent[];
}

/** A gateway placed after the main step chain. */
export interface GatewayIntent {
  ref: string;
  label: string;
  branches: BranchIntent[]; // >= 1
  elseBranch?: { steps: StepIntent[] };
}

export interface AssemblerIntent {
  summary: string;
  triggers: TriggerIntent[];
  /** ordered main chain; index order defines default edges and node layout. */
  steps: StepIntent[];
  /** optional branch point after the main chain. */
  gateway?: GatewayIntent;
  /** new custom-AI step definitions the plan will create; referenced by steps' customStepId. */
  newCustomSteps?: ProposedCustomStep[];
  defaults?: { sandboxId?: string | null; model?: string | null };
}
