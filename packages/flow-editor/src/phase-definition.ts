// packages/flow-editor/src/phase-definition.ts
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
  widget?: "text" | "textarea" | "number" | "select" | "checkbox" | "secret" | "code";
  options?: { value: string; label: string }[];
}

export interface SecretSlotDef {
  /** Slot identifier — what the phase reads at runtime as ctx.env[name].
   *  Convention: SCREAMING_SNAKE_CASE. Validated against ^[A-Z][A-Z0-9_]*$. */
  name: string;
  /** Short, human-friendly explanation. Shown next to the slot in the editor. */
  description: string;
  /** Optional slots: Auto-mode failing to resolve does NOT fail the run.
   *  Phase handler must tolerate ctx.env[name] being undefined. */
  optional?: boolean;
}

export interface PhaseRunState {
  status: "idle" | "running" | "succeeded" | "failed";
  message?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface PhaseSummaryCtx {
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

/** Resolve a config field's display value, falling back to its `inputs` binding when bound. */
export function summaryValue(
  config: unknown,
  ctx: PhaseSummaryCtx | undefined,
  key: string,
): string {
  const cfg = config as Record<string, unknown> | undefined;
  const v = cfg?.[key];
  if (typeof v === "string" && v.length > 0) return v;
  const binding = ctx?.inputs?.[key];
  if (binding && binding.kind === "ref" && binding.ref) return formatRefShort(binding.ref);
  return "";
}

export interface PhaseFormProps<TConfig> {
  config: TConfig;
  onChange: (next: TConfig) => void;
  readOnly?: boolean;
  catalogs: { mcp?: McpCatalog };
}

export interface PhaseDefinition<TConfig = unknown> {
  // identity & presentation
  phaseType: string;
  label: string;
  category: string;
  description?: string;
  color: string;
  icon: string;

  // config
  defaultConfig: TConfig;
  configSchema?: ZodTypeAny;
  configFields?: Record<string, FieldMeta>;
  ConfigForm?: ComponentType<PhaseFormProps<TConfig>>;

  // common-tab visibility
  tabs: {
    io: TabVisibility;
    requiredSecrets?: TabVisibility;
    mcp: TabVisibility;
    retry: TabVisibility;
  };

  /** Credential slots this phase needs at run time. Each slot becomes a
   *  row in the editor's "Required secrets" tab and a key in ctx.env. */
  slots?: SecretSlotDef[];

  // canvas display
  summary?: (config: TConfig, ctx?: PhaseSummaryCtx) => string;
  StatusBadge?: ComponentType<{ state: PhaseRunState }>;

  // executor binding (no runtime; intent only)
  executor: {
    kind: ExecutorKind;
    method: string;
  };

  /** Declared shape of this phase's output — drives the editor picker. */
  outputSchema?: OutputSchema;
}
