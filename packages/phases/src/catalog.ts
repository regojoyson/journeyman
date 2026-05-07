// Frontend-agnostic catalog of phase metadata. Pure data — aggregates
// only from sibling .meta.ts files (never from .tsx). Backend (api-server)
// imports this via the "@journeyman/phases/catalog" subpath export to keep
// React out of the server bundle.
import type { OutputSchema, InputFields } from "@journeyman/core";

import {
  ANALYZE_REPO_PHASE_TYPE, ANALYZE_REPO_LABEL, ANALYZE_REPO_CATEGORY, ANALYZE_REPO_DESCRIPTION,
  analyzeRepoOutputSchema, analyzeRepoInputFields,
} from "./ai/analyze-repo.meta.ts";
import {
  PLAN_IMPLEMENTATION_PHASE_TYPE, PLAN_IMPLEMENTATION_LABEL, PLAN_IMPLEMENTATION_CATEGORY,
  PLAN_IMPLEMENTATION_DESCRIPTION,
  planImplementationOutputSchema, planImplementationInputFields,
} from "./ai/plan-implementation.meta.ts";
import {
  IMPLEMENT_CHANGES_PHASE_TYPE, IMPLEMENT_CHANGES_LABEL, IMPLEMENT_CHANGES_CATEGORY,
  IMPLEMENT_CHANGES_DESCRIPTION,
  implementChangesOutputSchema, implementChangesInputFields,
} from "./ai/implement-changes.meta.ts";

import {
  LIST_WORKSPACE_FILES_PHASE_TYPE, LIST_WORKSPACE_FILES_LABEL, LIST_WORKSPACE_FILES_CATEGORY,
  LIST_WORKSPACE_FILES_DESCRIPTION,
  listWorkspaceFilesOutputSchema, listWorkspaceFilesInputFields,
} from "./repos/list-workspace-files.meta.ts";
import {
  START_FEATURE_BRANCH_PHASE_TYPE, START_FEATURE_BRANCH_LABEL, START_FEATURE_BRANCH_CATEGORY,
  START_FEATURE_BRANCH_DESCRIPTION,
  startFeatureBranchOutputSchema, startFeatureBranchInputFields,
} from "./repos/start-feature-branch.meta.ts";
import {
  COMMIT_AND_PUSH_PHASE_TYPE, COMMIT_AND_PUSH_LABEL, COMMIT_AND_PUSH_CATEGORY,
  COMMIT_AND_PUSH_DESCRIPTION,
  commitAndPushOutputSchema, commitAndPushInputFields,
} from "./repos/commit-and-push.meta.ts";
import {
  CLEANUP_WORKSPACE_PHASE_TYPE, CLEANUP_WORKSPACE_LABEL, CLEANUP_WORKSPACE_CATEGORY,
  CLEANUP_WORKSPACE_DESCRIPTION,
  cleanupWorkspaceOutputSchema, cleanupWorkspaceInputFields,
} from "./repos/cleanup-workspace.meta.ts";
import {
  CREATE_WORKSPACE_PHASE_TYPE, CREATE_WORKSPACE_LABEL, CREATE_WORKSPACE_CATEGORY,
  CREATE_WORKSPACE_DESCRIPTION,
  createWorkspaceOutputSchema, createWorkspaceInputFields,
} from "./repos/create-workspace.meta.ts";

import {
  GET_REPOSITORY_PHASE_TYPE, GET_REPOSITORY_LABEL, GET_REPOSITORY_CATEGORY,
  GET_REPOSITORY_DESCRIPTION,
  getRepositoryInputFields, getRepositoryOutputSchema,
} from "./git/get-repository.meta.ts";
import {
  CLONE_REPOS_PHASE_TYPE, CLONE_REPOS_LABEL, CLONE_REPOS_CATEGORY, CLONE_REPOS_DESCRIPTION,
  cloneReposInputFields, cloneReposOutputSchema,
} from "./git/clone-repos.meta.ts";
import {
  OPEN_PULL_REQUEST_PHASE_TYPE, OPEN_PULL_REQUEST_LABEL, OPEN_PULL_REQUEST_CATEGORY,
  OPEN_PULL_REQUEST_DESCRIPTION,
  openPullRequestInputFields, openPullRequestOutputSchema,
} from "./git/open-pull-request.meta.ts";
import {
  LIST_PULL_REQUESTS_PHASE_TYPE, LIST_PULL_REQUESTS_LABEL, LIST_PULL_REQUESTS_CATEGORY,
  LIST_PULL_REQUESTS_DESCRIPTION,
  listPullRequestsInputFields, listPullRequestsOutputSchema,
} from "./git/list-pull-requests.meta.ts";
import {
  COMMENT_ON_PULL_REQUEST_PHASE_TYPE, COMMENT_ON_PULL_REQUEST_LABEL, COMMENT_ON_PULL_REQUEST_CATEGORY,
  COMMENT_ON_PULL_REQUEST_DESCRIPTION,
  commentOnPullRequestInputFields, commentOnPullRequestOutputSchema,
} from "./git/comment-on-pull-request.meta.ts";
import {
  LIST_PULL_REQUEST_COMMENTS_PHASE_TYPE, LIST_PULL_REQUEST_COMMENTS_LABEL, LIST_PULL_REQUEST_COMMENTS_CATEGORY,
  LIST_PULL_REQUEST_COMMENTS_DESCRIPTION,
  listPullRequestCommentsInputFields, listPullRequestCommentsOutputSchema,
} from "./git/list-pull-request-comments.meta.ts";

import {
  GET_ISSUE_PHASE_TYPE, GET_ISSUE_LABEL, GET_ISSUE_CATEGORY, GET_ISSUE_DESCRIPTION,
  getIssueOutputSchema, getIssueInputFields,
} from "./issues/get-issue.meta.ts";
import {
  CREATE_ISSUE_PHASE_TYPE, CREATE_ISSUE_LABEL, CREATE_ISSUE_CATEGORY, CREATE_ISSUE_DESCRIPTION,
  createIssueOutputSchema, createIssueInputFields,
} from "./issues/create-issue.meta.ts";
import {
  UPDATE_ISSUE_FIELDS_PHASE_TYPE, UPDATE_ISSUE_FIELDS_LABEL, UPDATE_ISSUE_FIELDS_CATEGORY,
  UPDATE_ISSUE_FIELDS_DESCRIPTION,
  updateIssueFieldsOutputSchema, updateIssueFieldsInputFields,
} from "./issues/update-issue-fields.meta.ts";
import {
  TRANSITION_ISSUE_PHASE_TYPE, TRANSITION_ISSUE_LABEL, TRANSITION_ISSUE_CATEGORY,
  TRANSITION_ISSUE_DESCRIPTION,
  transitionIssueOutputSchema, transitionIssueInputFields,
} from "./issues/transition-issue.meta.ts";
import {
  COMMENT_ON_ISSUE_PHASE_TYPE, COMMENT_ON_ISSUE_LABEL, COMMENT_ON_ISSUE_CATEGORY,
  COMMENT_ON_ISSUE_DESCRIPTION,
  commentOnIssueOutputSchema, commentOnIssueInputFields,
} from "./issues/comment-on-issue.meta.ts";

import {
  SEND_MESSAGE_PHASE_TYPE, SEND_MESSAGE_LABEL, SEND_MESSAGE_CATEGORY, SEND_MESSAGE_DESCRIPTION,
  sendMessageOutputSchema, sendMessageInputFields,
} from "./notifications/send-message.meta.ts";

export interface PhaseCatalogEntry {
  phaseType: string;
  label: string;
  category: string;
  description: string;
  inputFields: InputFields;
  outputSchema: OutputSchema | null;
}

export const phaseCatalog: PhaseCatalogEntry[] = [
  // Coding Agent
  { phaseType: ANALYZE_REPO_PHASE_TYPE,        label: ANALYZE_REPO_LABEL,        category: ANALYZE_REPO_CATEGORY,        description: ANALYZE_REPO_DESCRIPTION,        inputFields: analyzeRepoInputFields,        outputSchema: analyzeRepoOutputSchema },
  { phaseType: PLAN_IMPLEMENTATION_PHASE_TYPE, label: PLAN_IMPLEMENTATION_LABEL, category: PLAN_IMPLEMENTATION_CATEGORY, description: PLAN_IMPLEMENTATION_DESCRIPTION, inputFields: planImplementationInputFields, outputSchema: planImplementationOutputSchema },
  { phaseType: IMPLEMENT_CHANGES_PHASE_TYPE,   label: IMPLEMENT_CHANGES_LABEL,   category: IMPLEMENT_CHANGES_CATEGORY,   description: IMPLEMENT_CHANGES_DESCRIPTION,   inputFields: implementChangesInputFields,   outputSchema: implementChangesOutputSchema },

  // Workspace
  { phaseType: LIST_WORKSPACE_FILES_PHASE_TYPE, label: LIST_WORKSPACE_FILES_LABEL, category: LIST_WORKSPACE_FILES_CATEGORY, description: LIST_WORKSPACE_FILES_DESCRIPTION, inputFields: listWorkspaceFilesInputFields, outputSchema: listWorkspaceFilesOutputSchema },
  { phaseType: START_FEATURE_BRANCH_PHASE_TYPE, label: START_FEATURE_BRANCH_LABEL, category: START_FEATURE_BRANCH_CATEGORY, description: START_FEATURE_BRANCH_DESCRIPTION, inputFields: startFeatureBranchInputFields, outputSchema: startFeatureBranchOutputSchema },
  { phaseType: COMMIT_AND_PUSH_PHASE_TYPE,      label: COMMIT_AND_PUSH_LABEL,      category: COMMIT_AND_PUSH_CATEGORY,      description: COMMIT_AND_PUSH_DESCRIPTION,      inputFields: commitAndPushInputFields,      outputSchema: commitAndPushOutputSchema },
  { phaseType: CLEANUP_WORKSPACE_PHASE_TYPE,    label: CLEANUP_WORKSPACE_LABEL,    category: CLEANUP_WORKSPACE_CATEGORY,    description: CLEANUP_WORKSPACE_DESCRIPTION,    inputFields: cleanupWorkspaceInputFields,    outputSchema: cleanupWorkspaceOutputSchema },
  { phaseType: CREATE_WORKSPACE_PHASE_TYPE,     label: CREATE_WORKSPACE_LABEL,     category: CREATE_WORKSPACE_CATEGORY,     description: CREATE_WORKSPACE_DESCRIPTION,     inputFields: createWorkspaceInputFields,     outputSchema: createWorkspaceOutputSchema },

  // Code Host
  { phaseType: GET_REPOSITORY_PHASE_TYPE,             label: GET_REPOSITORY_LABEL,             category: GET_REPOSITORY_CATEGORY,             description: GET_REPOSITORY_DESCRIPTION,             inputFields: getRepositoryInputFields,             outputSchema: getRepositoryOutputSchema },
  { phaseType: CLONE_REPOS_PHASE_TYPE,                label: CLONE_REPOS_LABEL,                category: CLONE_REPOS_CATEGORY,                description: CLONE_REPOS_DESCRIPTION,                inputFields: cloneReposInputFields,                outputSchema: cloneReposOutputSchema },
  { phaseType: OPEN_PULL_REQUEST_PHASE_TYPE,          label: OPEN_PULL_REQUEST_LABEL,          category: OPEN_PULL_REQUEST_CATEGORY,          description: OPEN_PULL_REQUEST_DESCRIPTION,          inputFields: openPullRequestInputFields,          outputSchema: openPullRequestOutputSchema },
  { phaseType: LIST_PULL_REQUESTS_PHASE_TYPE,         label: LIST_PULL_REQUESTS_LABEL,         category: LIST_PULL_REQUESTS_CATEGORY,         description: LIST_PULL_REQUESTS_DESCRIPTION,         inputFields: listPullRequestsInputFields,         outputSchema: listPullRequestsOutputSchema },
  { phaseType: COMMENT_ON_PULL_REQUEST_PHASE_TYPE,    label: COMMENT_ON_PULL_REQUEST_LABEL,    category: COMMENT_ON_PULL_REQUEST_CATEGORY,    description: COMMENT_ON_PULL_REQUEST_DESCRIPTION,    inputFields: commentOnPullRequestInputFields,    outputSchema: commentOnPullRequestOutputSchema },
  { phaseType: LIST_PULL_REQUEST_COMMENTS_PHASE_TYPE, label: LIST_PULL_REQUEST_COMMENTS_LABEL, category: LIST_PULL_REQUEST_COMMENTS_CATEGORY, description: LIST_PULL_REQUEST_COMMENTS_DESCRIPTION, inputFields: listPullRequestCommentsInputFields, outputSchema: listPullRequestCommentsOutputSchema },

  // Issue Tracker
  { phaseType: GET_ISSUE_PHASE_TYPE,           label: GET_ISSUE_LABEL,           category: GET_ISSUE_CATEGORY,           description: GET_ISSUE_DESCRIPTION,           inputFields: getIssueInputFields,           outputSchema: getIssueOutputSchema },
  { phaseType: CREATE_ISSUE_PHASE_TYPE,        label: CREATE_ISSUE_LABEL,        category: CREATE_ISSUE_CATEGORY,        description: CREATE_ISSUE_DESCRIPTION,        inputFields: createIssueInputFields,        outputSchema: createIssueOutputSchema },
  { phaseType: UPDATE_ISSUE_FIELDS_PHASE_TYPE, label: UPDATE_ISSUE_FIELDS_LABEL, category: UPDATE_ISSUE_FIELDS_CATEGORY, description: UPDATE_ISSUE_FIELDS_DESCRIPTION, inputFields: updateIssueFieldsInputFields, outputSchema: updateIssueFieldsOutputSchema },
  { phaseType: TRANSITION_ISSUE_PHASE_TYPE,    label: TRANSITION_ISSUE_LABEL,    category: TRANSITION_ISSUE_CATEGORY,    description: TRANSITION_ISSUE_DESCRIPTION,    inputFields: transitionIssueInputFields,    outputSchema: transitionIssueOutputSchema },
  { phaseType: COMMENT_ON_ISSUE_PHASE_TYPE,    label: COMMENT_ON_ISSUE_LABEL,    category: COMMENT_ON_ISSUE_CATEGORY,    description: COMMENT_ON_ISSUE_DESCRIPTION,    inputFields: commentOnIssueInputFields,    outputSchema: commentOnIssueOutputSchema },

  // Messaging
  { phaseType: SEND_MESSAGE_PHASE_TYPE, label: SEND_MESSAGE_LABEL, category: SEND_MESSAGE_CATEGORY, description: SEND_MESSAGE_DESCRIPTION, inputFields: sendMessageInputFields, outputSchema: sendMessageOutputSchema },

  // Custom AI Phase — runtime task type. Declared input/output shapes are
  // dynamic per saved definition; the bare entry exists so the server-side
  // catalog and validators recognize the phase type.
  { phaseType: "custom-ai", label: "Custom AI Phase", category: "Custom",
    description: "User-defined AI phase. Inputs and output schema come from the saved definition.",
    inputFields: {}, outputSchema: {} },
];
