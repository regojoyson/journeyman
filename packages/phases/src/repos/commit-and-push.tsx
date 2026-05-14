import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  COMMIT_AND_PUSH_PHASE_TYPE,
  COMMIT_AND_PUSH_LABEL,
  COMMIT_AND_PUSH_CATEGORY,
  COMMIT_AND_PUSH_DESCRIPTION,
  commitAndPushOutputSchema,
  commitAndPushConfigSchema,
} from "./commit-and-push.meta.ts";

interface CommitAndPushConfig {
  repos?: string;
  message?: string;
}

export const commitAndPushPhase: PhaseDefinition<CommitAndPushConfig> = {
  phaseType: COMMIT_AND_PUSH_PHASE_TYPE,
  label: COMMIT_AND_PUSH_LABEL,
  category: COMMIT_AND_PUSH_CATEGORY,
  description: COMMIT_AND_PUSH_DESCRIPTION,
  color: "#fdcb6e",
  icon: "⬆",
  defaultConfig: { repos: "", message: "" },
  configSchema: commitAndPushConfigSchema,
  configFields: {
    repos:   { label: "Repos", widget: "text", help: "Repo path. Leave blank to wire from IO (Repo[] from start-feature-branch)." },
    message: { label: "Commit message", widget: "textarea", help: "Optional. If set, used as the literal commit message (skips AI generation). Otherwise the agent writes a message from the issue + diff." },
  },
  // Slot list comes from the workflow's git-provider entry in PROVIDER_CATALOG
  // (e.g. GITHUB_ACCESS_TOKEN for github). The resolved token is injected as
  // env to the Claude bash tool and consumed by `git push` via an inline
  // credential.helper.
  tabs: { io: "shown", requiredSecrets: "shown", mcp: "hidden", retry: "shown" },
  slots: [],
  slotsFromKind: "git-provider",
  summary: (c) => (c.message ? `"${c.message.slice(0, 40)}"` : c.repos) || "(unwired)",
  executor: { kind: "coding-cli", method: "commitPushRepos" },
  outputSchema: commitAndPushOutputSchema,
};
