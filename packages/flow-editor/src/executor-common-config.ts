// packages/flow-editor/src/executor-common-config.ts
import type { ExecutorKind } from "./phase-definition.ts";

export interface ProviderOption { value: string; label: string }

export interface ExecutorKindCommonConfig {
  provider?: ProviderOption[];
}

export const executorCommonConfig: Record<ExecutorKind, ExecutorKindCommonConfig> = {
  "coding-cli": {
    provider: [
      { value: "claude", label: "Claude" },
      { value: "gemini", label: "Gemini" },
      { value: "codex",  label: "Codex"  },
    ],
  },
  "git-provider": {
    provider: [
      { value: "github", label: "GitHub" },
      { value: "gitlab", label: "GitLab" },
    ],
  },
  "ticket-provider": {
    provider: [
      { value: "jira",   label: "Jira"   },
      { value: "linear", label: "Linear" },
      { value: "monday", label: "Monday" },
    ],
  },
  "notification": {
    provider: [
      { value: "slack", label: "Slack" },
    ],
  },
  "control": {},
};

export function defaultProviderFor(kind: ExecutorKind): string | undefined {
  return executorCommonConfig[kind].provider?.[0]?.value;
}
