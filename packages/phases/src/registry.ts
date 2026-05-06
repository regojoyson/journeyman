// packages/phases/src/registry.ts
import type { PhaseDefinition } from "@journeyman/flow-editor";

import { analyzeRepoPhase } from "./ai/analyze-repo.tsx";
import { planImplementationPhase } from "./ai/plan-implementation.tsx";
import { implementChangesPhase } from "./ai/implement-changes.tsx";

import { listWorkspaceFilesPhase } from "./repos/list-workspace-files.tsx";
import { startFeatureBranchPhase } from "./repos/start-feature-branch.tsx";
import { commitAndPushPhase } from "./repos/commit-and-push.tsx";
import { cleanupWorkspacePhase } from "./repos/cleanup-workspace.tsx";
import { createWorkspacePhase } from "./repos/create-workspace.tsx";

import { getRepositoryPhase } from "./git/get-repository.tsx";
import { cloneReposPhase } from "./git/clone-repos.tsx";
import { openPullRequestPhase } from "./git/open-pull-request.tsx";
import { listPullRequestsPhase } from "./git/list-pull-requests.tsx";
import { commentOnPullRequestPhase } from "./git/comment-on-pull-request.tsx";
import { listPullRequestCommentsPhase } from "./git/list-pull-request-comments.tsx";

import { getIssuePhase } from "./issues/get-issue.tsx";
import { createIssuePhase } from "./issues/create-issue.tsx";
import { updateIssueFieldsPhase } from "./issues/update-issue-fields.tsx";
import { transitionIssuePhase } from "./issues/transition-issue.tsx";
import { commentOnIssuePhase } from "./issues/comment-on-issue.tsx";

import { sendMessagePhase } from "./notifications/send-message.tsx";

import { customAiPhase } from "./custom/custom-ai.tsx";

// `PhaseDefinition<TConfig>` is invariant in TConfig (the `onChange` and
// `defaultConfig` positions are both contravariant), so a list of definitions
// with different config types cannot be typed as `PhaseDefinition<unknown>[]`.
// The registry stores them as `PhaseDefinition<any>[]` and consumers treat
// each entry's `TConfig` opaquely.
export const builtInPhases: PhaseDefinition<any>[] = [
  // Coding Agent
  analyzeRepoPhase, planImplementationPhase, implementChangesPhase,
  // Workspace
  listWorkspaceFilesPhase, startFeatureBranchPhase, commitAndPushPhase, cleanupWorkspacePhase, createWorkspacePhase,
  // Code Host
  getRepositoryPhase, cloneReposPhase, openPullRequestPhase, listPullRequestsPhase, commentOnPullRequestPhase, listPullRequestCommentsPhase,
  // Issue Tracker
  getIssuePhase, createIssuePhase, updateIssueFieldsPhase, transitionIssuePhase, commentOnIssuePhase,
  // Messaging
  sendMessagePhase,
  // User-defined custom phases
  customAiPhase,
];
