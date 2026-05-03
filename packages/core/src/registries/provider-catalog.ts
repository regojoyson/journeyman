// packages/core/src/registries/provider-catalog.ts
import type { SecretSlotDef } from "../types/secret-slot.types.ts";

export type ExecutorKind =
  | "coding-cli"
  | "git-provider"
  | "issue-provider"
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
  /** Credential slots required by this provider at runtime. */
  slots?: SecretSlotDef[];
}

export const PROVIDER_CATALOG: ReadonlyArray<ProviderEntry> = [
  // coding-cli
  { kind: "coding-cli", value: "claude", label: "Claude", implemented: true, isDefault: true },
  { kind: "coding-cli", value: "gemini", label: "Gemini", implemented: false },
  { kind: "coding-cli", value: "codex",  label: "Codex",  implemented: false },

  // git-provider
  { kind: "git-provider", value: "github", label: "GitHub", implemented: true, isDefault: true, slots: [
    { name: "GITHUB_ACCESS_TOKEN", description: "GitHub PAT with repo scope" },
  ]},
  { kind: "git-provider", value: "gitlab", label: "GitLab", implemented: false },

  // issue-provider
  { kind: "issue-provider", value: "jira", label: "Jira", implemented: true, isDefault: true, slots: [
    { name: "JIRA_API_TOKEN", description: "Atlassian API token (user or service account)" },
    { name: "JIRA_EMAIL",     description: "Atlassian account email associated with the token" },
    { name: "JIRA_HOST",      description: "Your Jira domain, e.g. acme.atlassian.net" },
  ]},
  { kind: "issue-provider", value: "github-issues", label: "GitHub Issues", implemented: true, slots: [
    { name: "GITHUB_ACCESS_TOKEN", description: "GitHub PAT with repo scope" },
  ]},
  { kind: "issue-provider", value: "github-projects", label: "GitHub Projects", implemented: true, slots: [
    { name: "GITHUB_ACCESS_TOKEN", description: "GitHub PAT with repo and project scopes" },
  ]},
  { kind: "issue-provider", value: "linear",  label: "Linear",  implemented: false },
  { kind: "issue-provider", value: "monday",  label: "Monday",  implemented: false },

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

/**
 * Static map from phaseType string to its ExecutorKind.
 * Used by the orchestrator to look up the correct per-kind default
 * from FlowDefaults.executorConfig without access to the editor's PhaseRegistry.
 * Must be updated when new phase types are added.
 */
export const PHASE_KIND_MAP: Record<string, ExecutorKind> = {
  // coding-cli
  "analyze-repo":         "coding-cli",
  "cleanup-workspace":    "coding-cli",
  "commit-and-push":      "coding-cli",
  "create-workspace":     "coding-cli",
  "implement-changes":    "coding-cli",
  "list-workspace-files": "coding-cli",
  "plan-implementation":  "coding-cli",
  "start-feature-branch": "coding-cli",
  // git-provider
  "clone-repos":                "git-provider",
  "get-repository":             "git-provider",
  "list-pull-request-comments": "git-provider",
  "list-pull-requests":         "git-provider",
  "open-pull-request":          "git-provider",
  // issue-provider
  "comment-on-issue":   "issue-provider",
  "create-issue":       "issue-provider",
  "get-issue":          "issue-provider",
  "transition-issue":   "issue-provider",
  "update-issue-fields":"issue-provider",
  // notification
  "send-message": "notification",
};

/** Returns the ExecutorKind for a given phaseType, or undefined if unknown. */
export function kindForPhaseType(phaseType: string): ExecutorKind | undefined {
  return PHASE_KIND_MAP[phaseType];
}
