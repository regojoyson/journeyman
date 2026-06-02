// packages/steps/src/registry.ts
import type { StepDefinition } from "@journeyman/flow-editor";

import { listWorkspaceFilesStep } from "./repos/list-workspace-files.tsx";
import { startFeatureBranchStep } from "./repos/start-feature-branch.tsx";

import { getRepositoryStep } from "./git/get-repository.tsx";
import { cloneReposStep } from "./git/clone-repos.tsx";
import { openPullRequestStep } from "./git/open-pull-request.tsx";
import { listPullRequestsStep } from "./git/list-pull-requests.tsx";
import { commentOnPullRequestStep } from "./git/comment-on-pull-request.tsx";
import { listPullRequestCommentsStep } from "./git/list-pull-request-comments.tsx";

import { getIssueStep } from "./issues/get-issue.tsx";
import { createIssueStep } from "./issues/create-issue.tsx";
import { updateIssueFieldsStep } from "./issues/update-issue-fields.tsx";
import { transitionIssueStep } from "./issues/transition-issue.tsx";
import { commentOnIssueStep } from "./issues/comment-on-issue.tsx";

import { sendMessageStep } from "./notifications/send-message.tsx";

import { customAiStep } from "./custom/custom-ai.tsx";

// `StepDefinition<TConfig>` is invariant in TConfig (the `onChange` and
// `defaultConfig` positions are both contravariant), so a list of definitions
// with different config types cannot be typed as `StepDefinition<unknown>[]`.
// The registry stores them as `StepDefinition<any>[]` and consumers treat
// each entry's `TConfig` opaquely.
export const builtInSteps: StepDefinition<any>[] = [
  // Workspace
  listWorkspaceFilesStep, startFeatureBranchStep,
  // Code Host
  getRepositoryStep, cloneReposStep, openPullRequestStep, listPullRequestsStep, commentOnPullRequestStep, listPullRequestCommentsStep,
  // Issue Tracker
  getIssueStep, createIssueStep, updateIssueFieldsStep, transitionIssueStep, commentOnIssueStep,
  // Messaging
  sendMessageStep,
  // User-defined custom steps
  customAiStep,
];
