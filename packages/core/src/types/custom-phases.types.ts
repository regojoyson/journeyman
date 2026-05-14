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
  /**
   * Icon shown in the palette and on the canvas. Scheme-prefixed string:
   *   "lucide:<Name>" — a name from CUSTOM_PHASE_ICON_NAMES (today).
   *   "data:image/..." — inline uploaded raster (future; rejected today).
   *   null/undefined — render DEFAULT_CUSTOM_PHASE_ICON_ID.
   */
  icon?: string | null;
  inputFields: CustomPhaseInputField[];
  outputMode: CustomPhaseOutputMode;
  outputSchema?: CustomPhaseJsonSchema;
  promptTemplate: string;
  defaultTools: CanonicalTool[];
  defaultMcpIds: string[];
  defaultSkillIds: string[];
  /** When true, a flow author must attach at least one skill to any node that uses this phase. */
  requiresSkills: boolean;
  /** When true, a flow author must attach at least one MCP to any node that uses this phase. */
  requiresMcp: boolean;
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
  icon?: string | null;
  inputFields?: CustomPhaseInputField[];
  outputMode?: CustomPhaseOutputMode;
  outputSchema?: CustomPhaseJsonSchema;
  promptTemplate?: string;
  defaultTools?: CanonicalTool[];
  defaultMcpIds?: string[];
  defaultSkillIds?: string[];
  requiresSkills?: boolean;
  requiresMcp?: boolean;
  slots?: SecretSlotDef[];
}

export type CustomAiPhaseUpdateInput = Partial<Omit<CustomAiPhaseCreateInput, "scope">>;
