// packages/core/src/registries/provider-catalog.ts

export type ExecutorKind =
  | "coding-cli"
  | "git-provider"
  | "ticket-provider"
  | "notification";

export interface ProviderEntry {
  kind: ExecutorKind;
  /** Stable id used in flow JSON (`PhaseInput.provider`). */
  value: string;
  /** Human-readable label for the editor dropdown. */
  label: string;
  /** False = known but not yet runnable; hidden from dropdown, throws if invoked. */
  implemented: boolean;
  /** Marks the resolver default for its kind. Exactly one per kind should set this. */
  isDefault?: boolean;
}

export const PROVIDER_CATALOG: ReadonlyArray<ProviderEntry> = [
  // coding-cli
  { kind: "coding-cli", value: "claude", label: "Claude", implemented: true, isDefault: true },
  { kind: "coding-cli", value: "gemini", label: "Gemini", implemented: false },
  { kind: "coding-cli", value: "codex",  label: "Codex",  implemented: false },

  // git-provider
  { kind: "git-provider", value: "github", label: "GitHub", implemented: true, isDefault: true },
  { kind: "git-provider", value: "gitlab", label: "GitLab", implemented: false },

  // ticket-provider
  { kind: "ticket-provider", value: "jira",            label: "Jira",            implemented: true, isDefault: true },
  { kind: "ticket-provider", value: "github-issues",   label: "GitHub Issues",   implemented: true },
  { kind: "ticket-provider", value: "github-projects", label: "GitHub Projects", implemented: true },
  { kind: "ticket-provider", value: "linear",          label: "Linear",          implemented: false },
  { kind: "ticket-provider", value: "monday",          label: "Monday",          implemented: false },

  // notification
  { kind: "notification", value: "console", label: "Console", implemented: true, isDefault: true },
  { kind: "notification", value: "slack",   label: "Slack",   implemented: false },
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
