// Frontend-agnostic catalog of step metadata. Pure data — aggregates
// only from sibling .meta.ts files (never from .tsx). Backend (api-server)
// imports this via the "@journeyman/steps/catalog" subpath export to keep
// React out of the server bundle.
import type { OutputSchema, InputFields } from "@journeyman/core";

import {
  LIST_WORKSPACE_FILES_STEP_TYPE, LIST_WORKSPACE_FILES_LABEL, LIST_WORKSPACE_FILES_CATEGORY,
  LIST_WORKSPACE_FILES_DESCRIPTION,
  listWorkspaceFilesOutputSchema, listWorkspaceFilesInputFields, listWorkspaceFilesConfigSchema,
} from "./repos/list-workspace-files.meta.ts";
import {
  START_FEATURE_BRANCH_STEP_TYPE, START_FEATURE_BRANCH_LABEL, START_FEATURE_BRANCH_CATEGORY,
  START_FEATURE_BRANCH_DESCRIPTION,
  startFeatureBranchOutputSchema, startFeatureBranchInputFields, startFeatureBranchConfigSchema,
} from "./repos/start-feature-branch.meta.ts";
import {
  GET_REPOSITORY_STEP_TYPE, GET_REPOSITORY_LABEL, GET_REPOSITORY_CATEGORY,
  GET_REPOSITORY_DESCRIPTION,
  getRepositoryInputFields, getRepositoryOutputSchema, getRepositoryConfigSchema,
} from "./git/get-repository.meta.ts";
import {
  CLONE_REPOS_STEP_TYPE, CLONE_REPOS_LABEL, CLONE_REPOS_CATEGORY, CLONE_REPOS_DESCRIPTION,
  cloneReposInputFields, cloneReposOutputSchema, cloneReposConfigSchema,
} from "./git/clone-repos.meta.ts";
import {
  OPEN_PULL_REQUEST_STEP_TYPE, OPEN_PULL_REQUEST_LABEL, OPEN_PULL_REQUEST_CATEGORY,
  OPEN_PULL_REQUEST_DESCRIPTION,
  openPullRequestInputFields, openPullRequestOutputSchema, openPullRequestConfigSchema,
} from "./git/open-pull-request.meta.ts";
import {
  LIST_PULL_REQUESTS_STEP_TYPE, LIST_PULL_REQUESTS_LABEL, LIST_PULL_REQUESTS_CATEGORY,
  LIST_PULL_REQUESTS_DESCRIPTION,
  listPullRequestsInputFields, listPullRequestsOutputSchema, listPullRequestsConfigSchema,
} from "./git/list-pull-requests.meta.ts";
import {
  COMMENT_ON_PULL_REQUEST_STEP_TYPE, COMMENT_ON_PULL_REQUEST_LABEL, COMMENT_ON_PULL_REQUEST_CATEGORY,
  COMMENT_ON_PULL_REQUEST_DESCRIPTION,
  commentOnPullRequestInputFields, commentOnPullRequestOutputSchema, commentOnPullRequestConfigSchema,
} from "./git/comment-on-pull-request.meta.ts";
import {
  LIST_PULL_REQUEST_COMMENTS_STEP_TYPE, LIST_PULL_REQUEST_COMMENTS_LABEL, LIST_PULL_REQUEST_COMMENTS_CATEGORY,
  LIST_PULL_REQUEST_COMMENTS_DESCRIPTION,
  listPullRequestCommentsInputFields, listPullRequestCommentsOutputSchema, listPullRequestCommentsConfigSchema,
} from "./git/list-pull-request-comments.meta.ts";

import {
  GET_ISSUE_STEP_TYPE, GET_ISSUE_LABEL, GET_ISSUE_CATEGORY, GET_ISSUE_DESCRIPTION,
  getIssueOutputSchema, getIssueInputFields, getIssueConfigSchema,
} from "./issues/get-issue.meta.ts";
import {
  CREATE_ISSUE_STEP_TYPE, CREATE_ISSUE_LABEL, CREATE_ISSUE_CATEGORY, CREATE_ISSUE_DESCRIPTION,
  createIssueOutputSchema, createIssueInputFields, createIssueConfigSchema,
} from "./issues/create-issue.meta.ts";
import {
  UPDATE_ISSUE_FIELDS_STEP_TYPE, UPDATE_ISSUE_FIELDS_LABEL, UPDATE_ISSUE_FIELDS_CATEGORY,
  UPDATE_ISSUE_FIELDS_DESCRIPTION,
  updateIssueFieldsOutputSchema, updateIssueFieldsInputFields, updateIssueFieldsConfigSchema,
} from "./issues/update-issue-fields.meta.ts";
import {
  TRANSITION_ISSUE_STEP_TYPE, TRANSITION_ISSUE_LABEL, TRANSITION_ISSUE_CATEGORY,
  TRANSITION_ISSUE_DESCRIPTION,
  transitionIssueOutputSchema, transitionIssueInputFields, transitionIssueConfigSchema,
} from "./issues/transition-issue.meta.ts";
import {
  COMMENT_ON_ISSUE_STEP_TYPE, COMMENT_ON_ISSUE_LABEL, COMMENT_ON_ISSUE_CATEGORY,
  COMMENT_ON_ISSUE_DESCRIPTION,
  commentOnIssueOutputSchema, commentOnIssueInputFields, commentOnIssueConfigSchema,
} from "./issues/comment-on-issue.meta.ts";

import {
  SEND_MESSAGE_STEP_TYPE, SEND_MESSAGE_LABEL, SEND_MESSAGE_CATEGORY, SEND_MESSAGE_DESCRIPTION,
  sendMessageOutputSchema, sendMessageInputFields, sendMessageConfigSchema,
} from "./notifications/send-message.meta.ts";

import {
  CUSTOM_AI_STEP_TYPE, customAiConfigSchema,
} from "./custom/custom-ai.meta.ts";

export { buildStepConfigValidators } from "./catalog-validators.ts";

export interface StepCatalogEntry {
  stepType: string;
  label: string;
  category: string;
  description: string;
  inputFields: InputFields;
  outputSchema: OutputSchema | null;
  configSchema?: { safeParse: (v: unknown) => { success: boolean; error?: { issues?: Array<{ path?: PropertyKey[]; message?: string }> } } };
  /** Declares which connection category this step requires. UI-only: drives the connection picker in the properties panel. */
  connectionCategory?: import("@journeyman/core").ConnectionCategory;
}

export const stepCatalog: StepCatalogEntry[] = [
  // Workspace
  { stepType: LIST_WORKSPACE_FILES_STEP_TYPE, label: LIST_WORKSPACE_FILES_LABEL, category: LIST_WORKSPACE_FILES_CATEGORY, description: LIST_WORKSPACE_FILES_DESCRIPTION, inputFields: listWorkspaceFilesInputFields, outputSchema: listWorkspaceFilesOutputSchema, configSchema: listWorkspaceFilesConfigSchema },
  { stepType: START_FEATURE_BRANCH_STEP_TYPE, label: START_FEATURE_BRANCH_LABEL, category: START_FEATURE_BRANCH_CATEGORY, description: START_FEATURE_BRANCH_DESCRIPTION, inputFields: startFeatureBranchInputFields, outputSchema: startFeatureBranchOutputSchema, configSchema: startFeatureBranchConfigSchema },

  // Code Host
  { stepType: GET_REPOSITORY_STEP_TYPE,             label: GET_REPOSITORY_LABEL,             category: GET_REPOSITORY_CATEGORY,             description: GET_REPOSITORY_DESCRIPTION,             inputFields: getRepositoryInputFields,             outputSchema: getRepositoryOutputSchema,             configSchema: getRepositoryConfigSchema,             connectionCategory: "git" },
  { stepType: CLONE_REPOS_STEP_TYPE,                label: CLONE_REPOS_LABEL,                category: CLONE_REPOS_CATEGORY,                description: CLONE_REPOS_DESCRIPTION,                inputFields: cloneReposInputFields,                outputSchema: cloneReposOutputSchema,                configSchema: cloneReposConfigSchema,                connectionCategory: "git" },
  { stepType: OPEN_PULL_REQUEST_STEP_TYPE,          label: OPEN_PULL_REQUEST_LABEL,          category: OPEN_PULL_REQUEST_CATEGORY,          description: OPEN_PULL_REQUEST_DESCRIPTION,          inputFields: openPullRequestInputFields,          outputSchema: openPullRequestOutputSchema,          configSchema: openPullRequestConfigSchema,          connectionCategory: "git" },
  { stepType: LIST_PULL_REQUESTS_STEP_TYPE,         label: LIST_PULL_REQUESTS_LABEL,         category: LIST_PULL_REQUESTS_CATEGORY,         description: LIST_PULL_REQUESTS_DESCRIPTION,         inputFields: listPullRequestsInputFields,         outputSchema: listPullRequestsOutputSchema,         configSchema: listPullRequestsConfigSchema,         connectionCategory: "git" },
  { stepType: COMMENT_ON_PULL_REQUEST_STEP_TYPE,    label: COMMENT_ON_PULL_REQUEST_LABEL,    category: COMMENT_ON_PULL_REQUEST_CATEGORY,    description: COMMENT_ON_PULL_REQUEST_DESCRIPTION,    inputFields: commentOnPullRequestInputFields,    outputSchema: commentOnPullRequestOutputSchema,    configSchema: commentOnPullRequestConfigSchema,    connectionCategory: "git" },
  { stepType: LIST_PULL_REQUEST_COMMENTS_STEP_TYPE, label: LIST_PULL_REQUEST_COMMENTS_LABEL, category: LIST_PULL_REQUEST_COMMENTS_CATEGORY, description: LIST_PULL_REQUEST_COMMENTS_DESCRIPTION, inputFields: listPullRequestCommentsInputFields, outputSchema: listPullRequestCommentsOutputSchema, configSchema: listPullRequestCommentsConfigSchema, connectionCategory: "git" },

  // Issue Tracker
  { stepType: GET_ISSUE_STEP_TYPE,           label: GET_ISSUE_LABEL,           category: GET_ISSUE_CATEGORY,           description: GET_ISSUE_DESCRIPTION,           inputFields: getIssueInputFields,           outputSchema: getIssueOutputSchema,           configSchema: getIssueConfigSchema,           connectionCategory: "ticket" },
  { stepType: CREATE_ISSUE_STEP_TYPE,        label: CREATE_ISSUE_LABEL,        category: CREATE_ISSUE_CATEGORY,        description: CREATE_ISSUE_DESCRIPTION,        inputFields: createIssueInputFields,        outputSchema: createIssueOutputSchema,        configSchema: createIssueConfigSchema,        connectionCategory: "ticket" },
  { stepType: UPDATE_ISSUE_FIELDS_STEP_TYPE, label: UPDATE_ISSUE_FIELDS_LABEL, category: UPDATE_ISSUE_FIELDS_CATEGORY, description: UPDATE_ISSUE_FIELDS_DESCRIPTION, inputFields: updateIssueFieldsInputFields, outputSchema: updateIssueFieldsOutputSchema, configSchema: updateIssueFieldsConfigSchema, connectionCategory: "ticket" },
  { stepType: TRANSITION_ISSUE_STEP_TYPE,    label: TRANSITION_ISSUE_LABEL,    category: TRANSITION_ISSUE_CATEGORY,    description: TRANSITION_ISSUE_DESCRIPTION,    inputFields: transitionIssueInputFields,    outputSchema: transitionIssueOutputSchema,    configSchema: transitionIssueConfigSchema,    connectionCategory: "ticket" },
  { stepType: COMMENT_ON_ISSUE_STEP_TYPE,    label: COMMENT_ON_ISSUE_LABEL,    category: COMMENT_ON_ISSUE_CATEGORY,    description: COMMENT_ON_ISSUE_DESCRIPTION,    inputFields: commentOnIssueInputFields,    outputSchema: commentOnIssueOutputSchema,    configSchema: commentOnIssueConfigSchema,    connectionCategory: "ticket" },

  // Messaging
  { stepType: SEND_MESSAGE_STEP_TYPE, label: SEND_MESSAGE_LABEL, category: SEND_MESSAGE_CATEGORY, description: SEND_MESSAGE_DESCRIPTION, inputFields: sendMessageInputFields, outputSchema: sendMessageOutputSchema, configSchema: sendMessageConfigSchema, connectionCategory: "notification" },

  // Custom AI Step — runtime task type. Declared input/output shapes are
  // dynamic per saved definition; the bare entry exists so the server-side
  // catalog and validators recognize the step type.
  { stepType: CUSTOM_AI_STEP_TYPE, label: "Custom AI Step", category: "Custom",
    description: "User-defined AI step. Inputs and output schema come from the saved definition.",
    inputFields: {}, outputSchema: {}, configSchema: customAiConfigSchema },
];
