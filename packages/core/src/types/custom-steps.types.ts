import type { CanonicalTool } from "./coding-tools.types.ts";
import type { SecretSlotDef } from "./secret-slot.types.ts";

export type CustomStepScope = "user" | "org";
export type CustomStepOutputMode = "none" | "text" | "structured";

export type CustomStepInputType =
  | "string" | "number" | "boolean" | "string[]"
  | "json-object" | "json-array"
  | "workspaceDir" | "repoRef"
  | "template";

export interface CustomStepInputField {
  name: string;
  type: CustomStepInputType;
  required: boolean;
  description?: string;
  default?: unknown;
}

// JSON Schema subset stored in output_schema (full JSON Schema is allowed;
// we only constrain what the editor produces).
export type CustomStepJsonSchema = Record<string, unknown>;

export interface CustomAiStep {
  id: string;
  scope: CustomStepScope;
  userId?: string;
  orgId: string;
  name: string;
  description: string;
  /**
   * Icon shown in the palette and on the canvas. Scheme-prefixed string:
   *   "lucide:<Name>" — a name from CUSTOM_STEP_ICON_NAMES (today).
   *   "data:image/..." — inline uploaded raster (future; rejected today).
   *   null/undefined — render DEFAULT_CUSTOM_STEP_ICON_ID.
   */
  icon?: string | null;
  inputFields: CustomStepInputField[];
  outputMode: CustomStepOutputMode;
  outputSchema?: CustomStepJsonSchema;
  promptTemplate: string;
  defaultTools: CanonicalTool[];
  defaultMcpIds: string[];
  defaultSkillIds: string[];
  /** When true, a flow author must attach at least one skill to any node that uses this step. */
  requiresSkills: boolean;
  /** When true, a flow author must attach at least one MCP to any node that uses this step. */
  requiresMcp: boolean;
  /** Credential slots this step needs at run time. Each slot becomes a $SLOT_NAME env var in the Bash tool when bound at the node level. */
  slots: SecretSlotDef[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomAiStepCreateInput {
  scope: CustomStepScope;
  name: string;
  description?: string;
  icon?: string | null;
  inputFields?: CustomStepInputField[];
  outputMode?: CustomStepOutputMode;
  outputSchema?: CustomStepJsonSchema;
  promptTemplate?: string;
  defaultTools?: CanonicalTool[];
  defaultMcpIds?: string[];
  defaultSkillIds?: string[];
  requiresSkills?: boolean;
  requiresMcp?: boolean;
  slots?: SecretSlotDef[];
}

export type CustomAiStepUpdateInput = Partial<Omit<CustomAiStepCreateInput, "scope">>;

export const CUSTOM_STEP_EXPORT_KIND = "journeyman.customStep" as const;
export const CUSTOM_STEP_EXPORT_VERSION = 1 as const;

/** Portable subset of CustomAiStep used for cross-deployment export/import. */
export interface CustomStepExportPayloadV1 {
  name: string;
  description: string;
  icon: string | null;
  inputFields: CustomStepInputField[];
  outputMode: CustomStepOutputMode;
  outputSchema?: CustomStepJsonSchema;
  promptTemplate: string;
  defaultTools: CanonicalTool[];
  /** Always [] in exports — cross-system IDs do not resolve. */
  defaultMcpIds: string[];
  /** Always [] in exports — cross-system IDs do not resolve. */
  defaultSkillIds: string[];
  requiresSkills: boolean;
  requiresMcp: boolean;
  slots: SecretSlotDef[];
}

export interface CustomStepExportV1 {
  schemaVersion: typeof CUSTOM_STEP_EXPORT_VERSION;
  kind: typeof CUSTOM_STEP_EXPORT_KIND;
  exportedAt: string;
  exportedFrom: string;
  step: CustomStepExportPayloadV1;
}
