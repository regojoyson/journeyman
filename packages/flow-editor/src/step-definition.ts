// packages/flow-editor/src/step-definition.ts
import type { OutputSchema } from "@journeyman/core";
import type { ZodTypeAny } from "zod";
import type { ComponentType } from "react";
import type { McpCatalog } from "./types.ts";

export type TabVisibility = "shown" | "hidden" | "required";

export type ExecutorKind =
  | "coding-cli"
  | "git-provider"
  | "issue-provider"
  | "notification"
  | "control";

export interface FieldMeta {
  label: string;
  help?: string;
  widget?: "text" | "textarea" | "number" | "select" | "checkbox" | "secret" | "code" | "string-list";
  options?: { value: string; label: string }[];
}

import type { SecretSlotDef } from "@journeyman/core";
export type { SecretSlotDef };

export interface StepRunState {
  status: "idle" | "running" | "succeeded" | "failed";
  message?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface StepSummaryCtx {
  /** node.inputs map (ref bindings). */
  inputs?: Record<string, { kind: string; ref?: string; value?: unknown } | undefined>;
}

/**
 * Render a binding ref as a short, human-friendly token for canvas display.
 * `flow.input.issueUrl` → `${issueUrl}`
 * `node-abc.output.summary` → `${node-abc.summary}`
 */
export function formatRefShort(ref: string | undefined | null): string {
  if (!ref) return "";
  const parts = ref.split(".");
  if (parts.length >= 2 && parts[0] === "workflow" && parts[1] === "input") {
    return "${" + parts.slice(2).join(".") + "}";
  }
  if (parts.length >= 3 && (parts[1] === "input" || parts[1] === "output")) {
    return "${" + parts[0] + "." + parts.slice(2).join(".") + "}";
  }
  return "${" + ref + "}";
}

/**
 * Compact, human-friendly token for a ref in a node summary. Strips the
 * `workflow.input.` / `workflow.attribute.` / `<node>.output.` scope prefix and
 * prefixes with `@`, keeping any path tail intact.
 *   workflow.input.ticketOwner      → @ticketOwner
 *   list.output.pullRequests[0].title → @pullRequests[0].title
 */
export function friendlyRef(ref: string): string {
  if (!ref) return "";
  const parts = ref.split(".");
  if (parts[0] === "workflow" && (parts[1] === "input" || parts[1] === "attribute")) {
    return "@" + parts.slice(2).join(".");
  }
  if (parts.length >= 3 && (parts[1] === "input" || parts[1] === "output")) {
    return "@" + parts.slice(2).join(".");
  }
  return "@" + ref;
}

/** Rewrite every `${ref}` in a stored template into its friendly @token, for display. */
export function humanizeTemplate(text: string): string {
  return text.replace(/\$\{([^}]*)\}/g, (_m, ref) => friendlyRef(String(ref)));
}

/** Resolve a config field's display value, falling back to its `inputs` binding when bound. */
export function summaryValue(
  config: unknown,
  ctx: StepSummaryCtx | undefined,
  key: string,
): string {
  const cfg = config as Record<string, unknown> | undefined;
  const v = cfg?.[key];
  if (typeof v === "string" && v.length > 0) return humanizeTemplate(v);
  const binding = ctx?.inputs?.[key];
  if (binding && binding.kind === "ref" && binding.ref) return friendlyRef(binding.ref);
  return "";
}

export interface StepFormProps<TConfig> {
  config: TConfig;
  onChange: (next: TConfig) => void;
  readOnly?: boolean;
  catalogs: { mcp?: McpCatalog };
  /** Upstream sources reachable from this node — used by ConfigForms that
   *  render binding pickers. Optional because not every form needs it. */
  sources?: import("./properties-panel/use-upstream-sources.ts").UpstreamSource[];
  /** Top-level node.inputs — for ConfigForms (e.g. custom-ai) that own their
   *  input bindings rather than letting IoTab/SchemaForm render them. */
  inputs?: import("@journeyman/core").WorkflowNode["inputs"];
  onInputsChange?: (next: import("@journeyman/core").WorkflowNode["inputs"]) => void;
}

export interface StepDefinition<TConfig = unknown> {
  // identity & presentation
  stepType: string;
  label: string;
  category: string;
  description?: string;
  color: string;
  icon: string;

  // config
  defaultConfig: TConfig;
  configSchema?: ZodTypeAny;
  configFields?: Record<string, FieldMeta>;
  ConfigForm?: ComponentType<StepFormProps<TConfig>>;

  // common-tab visibility
  tabs: {
    io: TabVisibility;
    requiredSecrets?: TabVisibility;
    mcp: TabVisibility;
    skills?: TabVisibility;
    retry: TabVisibility;
  };

  /** Credential slots this step needs at run time. Each slot becomes a
   *  row in the editor's "Required secrets" tab and a key in ctx.env. */
  slots?: SecretSlotDef[];

  /** When set, the slot list for this step is resolved from
   *  PROVIDER_CATALOG keyed by the workflow's configured provider for the
   *  named ExecutorKind, rather than from `slots` or the step's executor
   *  provider. Used for steps that run on one executor but need credentials
   *  from a different kind (e.g. a coding-cli step that needs the
   *  workflow's git-provider credentials to push). */
  slotsFromKind?: ExecutorKind;

  // canvas display
  summary?: (config: TConfig, ctx?: StepSummaryCtx) => string;
  StatusBadge?: ComponentType<{ state: StepRunState }>;

  // executor binding (no runtime; intent only)
  executor: {
    kind: ExecutorKind;
    method: string;
  };

  /** Whether this step can consume skill packages. Drives the Skills tab in the editor. */
  supportsSkills?: boolean;

  /** Whether this step consumes a model selection (renders the Model dropdown in the step config panel). */
  supportsModelSelection?: boolean;

  /** Declared shape of this step's output — drives the editor picker. */
  outputSchema?: OutputSchema;

  /** When true, this step is shown in the palette's collapsible
   *  "Coming soon" panel and cannot be dragged onto the canvas.
   *  Default: false (available). Editorial flag — not derived from
   *  provider implementation status. */
  comingSoon?: boolean;

  /** When true, this step is excluded from the palette entirely but
   *  still registered for ConfigForm/IoTab lookups. Used by steps like
   *  `custom-ai` that ship a generic runtime + per-instance synthetic
   *  palette entries. */
  hiddenFromPalette?: boolean;
}
