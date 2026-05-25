import type { JsonLogicExpr } from "./flow-condition.types.ts";

export type TriggerInputMappingType = "string" | "number" | "boolean" | "json";

export interface TriggerInputMapping {
  /** JSONPath into the inbound payload. */
  fromPath: string;
  type: TriggerInputMappingType;
}

/** Config for a `trigger-manual` node. Manual triggers fire from the Run button; no per-node config today. */
export interface TriggerManualConfig {
  // Reserved for future use (e.g. confirm prompt, default-input overrides).
}

/** Config for a `trigger-webhook` node. Fires when its bound webhook receives a matching event AND no paused instance was resumed. */
export interface TriggerWebhookConfig {
  /** FK to jm_webhooks.id. Required at publish time. */
  webhookId: string;
  /** Event-type allowlist; empty/undefined means accept any event type. */
  listensFor?: string[];
  /** JSONLogic predicate evaluated against the raw payload; must be truthy to fire. */
  acceptIf?: JsonLogicExpr;
  /** Payload → workflow input mapping. Keys are names from WorkflowGraph.inputDefs. */
  inputsMapping: Record<string, TriggerInputMapping>;
  /** Optional path to extract a downstream-correlatable issueRef from the payload. */
  issueRefFromPath?: string;
}

export type TriggerHumanFieldWidget =
  | "text"
  | "textarea"
  | "number"
  | "checkbox"
  | "select";

export interface TriggerHumanFieldOverride {
  label?: string;
  description?: string;
  widget?: TriggerHumanFieldWidget;
  /** Only meaningful when widget === "select". */
  options?: string[];
}

/** Config for a `trigger-human` node. Fires when a user submits the in-app form. */
export interface TriggerHumanConfig {
  formTitle?: string;
  /** Per-input UI overrides keyed by input name from WorkflowGraph.inputDefs. */
  fieldOverrides?: Record<string, TriggerHumanFieldOverride>;
  /** Optional role gate; if absent, anyone with read on the workflow may submit. */
  authorizedRoles?: string[];
}
