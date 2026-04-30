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

import { getTicketPhase } from "./tickets/get-ticket.tsx";
import { createTicketPhase } from "./tickets/create-ticket.tsx";
import { updateTicketFieldsPhase } from "./tickets/update-ticket-fields.tsx";
import { transitionTicketPhase } from "./tickets/transition-ticket.tsx";
import { commentOnTicketPhase } from "./tickets/comment-on-ticket.tsx";

import { sendMessagePhase } from "./notifications/send-message.tsx";

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
  getTicketPhase, createTicketPhase, updateTicketFieldsPhase, transitionTicketPhase, commentOnTicketPhase,
  // Messaging
  sendMessagePhase,
];
