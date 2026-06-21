// packages/core/src/registries/provider-catalog.ts
import type { SecretSlotDef } from "../types/secret-slot.types.ts";

export type ExecutorKind =
  | "coding-cli"
  | "git-provider"
  | "issue-provider"
  | "notification";

export interface ProviderEntry {
  kind: ExecutorKind;
  /** Stable id used in flow JSON (`StepInput.provider`). */
  value: string;
  /** Human-readable label for the editor dropdown. */
  label: string;
  /** False = known but not yet runnable; hidden from dropdown, throws if invoked. */
  implemented: boolean;
  /** Marks the resolver default for its kind. Exactly one per kind should set this. */
  isDefault?: boolean;
  /** Credential slots required by this provider at runtime. */
  slots?: SecretSlotDef[];
}

export const PROVIDER_CATALOG: ReadonlyArray<ProviderEntry> = [
  // coding-cli
  // Claude's API key is model-owned (each coding model binds an org secret directly),
  // so there is no framework-level key slot.
  { kind: "coding-cli", value: "claude", label: "Claude", implemented: true, isDefault: true },
  // OpenCode has no framework-level key slot — each coding model declares whether
  // it needs a key (config.requiresApiKey), surfaced via openCodeModelSlots().
  { kind: "coding-cli", value: "opencode", label: "OpenCode", implemented: true, slots: [] },
  // AI SDK: model + per-vendor key live on the coding-model config (like OpenCode);
  // no framework-level slot. Required slot surfaced via codingModelSlots().
  { kind: "coding-cli", value: "aisdk", label: "AI SDK (multi-model)", implemented: true, slots: [] },
  { kind: "coding-cli", value: "gemini", label: "Gemini", implemented: false },
  { kind: "coding-cli", value: "codex",  label: "Codex",  implemented: false },

  // git-provider — credentials come from connections, not secret slots
  { kind: "git-provider", value: "github", label: "GitHub", implemented: true, isDefault: true },
  { kind: "git-provider", value: "gitlab", label: "GitLab", implemented: false },

  // issue-provider — credentials come from connections, not secret slots
  { kind: "issue-provider", value: "jira",            label: "Jira",            implemented: true, isDefault: true },
  { kind: "issue-provider", value: "github-issues",   label: "GitHub Issues",   implemented: true },
  { kind: "issue-provider", value: "github-projects", label: "GitHub Projects", implemented: true },
  { kind: "issue-provider", value: "linear",          label: "Linear",          implemented: false },
  { kind: "issue-provider", value: "monday",          label: "Monday",          implemented: false },

  // notification — credentials come from connections, not secret slots
  { kind: "notification", value: "slack",   label: "Slack",   implemented: true, isDefault: true },
  { kind: "notification", value: "email",   label: "Email",   implemented: true },
];

export function providersForKind(kind: ExecutorKind): ProviderEntry[] {
  return PROVIDER_CATALOG.filter(p => p.kind === kind);
}

export function implementedProvidersForKind(kind: ExecutorKind): ProviderEntry[] {
  return providersForKind(kind).filter(p => p.implemented);
}

export function defaultProviderForKind(kind: ExecutorKind): ProviderEntry | undefined {
  return providersForKind(kind).find(p => p.isDefault);
}

/**
 * Static map from stepType string to its ExecutorKind.
 * Used by the orchestrator to look up the correct per-kind default
 * from FlowDefaults.executorConfig without access to the editor's StepRegistry.
 * Must be updated when new step types are added.
 */
export const PHASE_KIND_MAP: Record<string, ExecutorKind> = {
  // coding-cli — only kind that still resolves provider defaults via executor config
  "custom-ai":            "coding-cli",
  "list-workspace-files": "coding-cli",
  "start-feature-branch": "coding-cli",
  // git, issue, and notification steps now use connectionId — removed from PHASE_KIND_MAP
};

/** Returns the ExecutorKind for a given stepType, or undefined if unknown. */
export function kindForStepType(stepType: string): ExecutorKind | undefined {
  return PHASE_KIND_MAP[stepType];
}
