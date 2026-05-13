import type { CanonicalTool } from "./coding-tools.types.ts";
import type { SecretSlotDef } from "./secret-slot.types.ts";

export type CustomPhaseScope = "user" | "org";
export type CustomPhaseOutputMode = "none" | "text" | "structured";

export type CustomPhaseInputType =
  | "string" | "number" | "boolean" | "string[]"
  | "object" | "array"
  | "workspaceDir" | "repoRef" | "issueRef"
  | "template";

export interface CustomPhaseInputField {
  name: string;
  type: CustomPhaseInputType;
  required: boolean;
  description?: string;
  default?: unknown;
}

// JSON Schema subset stored in output_schema (full JSON Schema is allowed;
// we only constrain what the editor produces).
export type CustomPhaseJsonSchema = Record<string, unknown>;

export interface CustomAiPhase {
  id: string;
  scope: CustomPhaseScope;
  userId?: string;
  orgId: string;
  name: string;
  description: string;
  inputFields: CustomPhaseInputField[];
  outputMode: CustomPhaseOutputMode;
  outputSchema?: CustomPhaseJsonSchema;
  promptTemplate: string;
  defaultTools: CanonicalTool[];
  defaultMcpIds: string[];
  defaultSkillIds: string[];
  /** Credential slots this phase needs at run time. Each slot becomes a $SLOT_NAME env var in the Bash tool when bound at the node level. */
  slots: SecretSlotDef[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomAiPhaseCreateInput {
  scope: CustomPhaseScope;
  name: string;
  description?: string;
  inputFields?: CustomPhaseInputField[];
  outputMode?: CustomPhaseOutputMode;
  outputSchema?: CustomPhaseJsonSchema;
  promptTemplate?: string;
  defaultTools?: CanonicalTool[];
  defaultMcpIds?: string[];
  defaultSkillIds?: string[];
  slots?: SecretSlotDef[];
}

export type CustomAiPhaseUpdateInput = Partial<Omit<CustomAiPhaseCreateInput, "scope">>;
