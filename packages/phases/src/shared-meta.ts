// packages/phases/src/shared-meta.ts
export interface InputFieldMeta {
  type: "string" | "number" | "boolean" | "json";
  label?: string;
  /** Save-time: must have a typed value or a binding. */
  required?: boolean;
  /** True when the field has no typed UI (bindable-only — e.g. workspaceDir on phases that consume it from create-workspace upstream). */
  bindOnly?: boolean;
}

export type InputFields = Record<string, InputFieldMeta>;
