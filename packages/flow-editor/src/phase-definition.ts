// packages/flow-editor/src/phase-definition.ts
import type { OutputSchema } from "@journeyman/core";
import type { ZodTypeAny } from "zod";
import type { ComponentType } from "react";
import type { McpCatalog } from "./types.ts";

export type TabVisibility = "shown" | "hidden" | "required";

export type ExecutorKind =
  | "coding-cli"
  | "git-provider"
  | "ticket-provider"
  | "notification"
  | "control";

export interface FieldMeta {
  label: string;
  help?: string;
  widget?: "text" | "textarea" | "number" | "select" | "checkbox" | "secret" | "code";
  options?: { value: string; label: string }[];
}

export interface PhaseRunState {
  status: "idle" | "running" | "succeeded" | "failed";
  message?: string;
  startedAt?: string;
  endedAt?: string;
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
    credentials: TabVisibility;
    mcp: TabVisibility;
    retry: TabVisibility;
  };

  // canvas display
  summary?: (config: TConfig) => string;
  StatusBadge?: ComponentType<{ state: PhaseRunState }>;

  // executor binding (no runtime; intent only)
  executor: {
    kind: ExecutorKind;
    method: string;
  };

  /** Declared shape of this phase's output — drives the editor picker. */
  outputSchema?: OutputSchema;
}
