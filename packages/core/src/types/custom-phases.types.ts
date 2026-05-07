import type { CanonicalTool } from "./coding-tools.types.ts";

export type CustomPhaseScope = "user" | "org";
export type CustomPhaseOutputMode = "none" | "text" | "structured";

export type CustomPhaseInputType =
  | "string" | "number" | "boolean" | "string[]"
  | "object" | "array"
  | "workspaceId" | "repoRef" | "issueRef";

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
}

export type CustomAiPhaseUpdateInput = Partial<Omit<CustomAiPhaseCreateInput, "scope">>;
