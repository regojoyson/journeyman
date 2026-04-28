// Frontend-agnostic catalog of phase metadata. Pure data — aggregates
// only from sibling .meta.ts files (never from .tsx). Backend (api-server)
// imports this via the "@journeyman/phases/catalog" subpath export to keep
// React out of the server bundle.
import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "./shared-meta.ts";

import {
  ANALYZE_PHASE_TYPE, ANALYZE_LABEL, ANALYZE_CATEGORY, analyzeOutputSchema, analyzeInputFields,
} from "./ai/analyze.meta.ts";
import {
  PLAN_PHASE_TYPE, PLAN_LABEL, PLAN_CATEGORY, planOutputSchema, planInputFields,
} from "./ai/plan.meta.ts";
import {
  IMPLEMENT_PHASE_TYPE, IMPLEMENT_LABEL, IMPLEMENT_CATEGORY, implementOutputSchema, implementInputFields,
} from "./ai/implement.meta.ts";

import {
  SCAN_REPOS_PHASE_TYPE, SCAN_REPOS_LABEL, SCAN_REPOS_CATEGORY, scanReposOutputSchema, scanReposInputFields,
} from "./repos/scan-repos.meta.ts";
import {
  CHECKOUT_REPO_PHASE_TYPE, CHECKOUT_REPO_LABEL, CHECKOUT_REPO_CATEGORY, checkoutRepoOutputSchema, checkoutRepoInputFields,
} from "./repos/checkout-repo.meta.ts";
import {
  COMMIT_PUSH_PHASE_TYPE, COMMIT_PUSH_LABEL, COMMIT_PUSH_CATEGORY, commitPushOutputSchema, commitPushInputFields,
} from "./repos/commit-push.meta.ts";
import {
  CLEANUP_REPOS_PHASE_TYPE, CLEANUP_REPOS_LABEL, CLEANUP_REPOS_CATEGORY, cleanupReposOutputSchema, cleanupReposInputFields,
} from "./repos/cleanup-repos.meta.ts";
import {
  CREATE_WORKSPACE_PHASE_TYPE, CREATE_WORKSPACE_LABEL, CREATE_WORKSPACE_CATEGORY, createWorkspaceOutputSchema, createWorkspaceInputFields,
} from "./repos/create-workspace.meta.ts";

import {
  GET_REPO_PHASE_TYPE, GET_REPO_LABEL, GET_REPO_CATEGORY, getRepoInputFields,
} from "./git/get-repo.meta.ts";
import {
  CLONE_REPOS_PHASE_TYPE, CLONE_REPOS_LABEL, CLONE_REPOS_CATEGORY, cloneReposInputFields,
} from "./git/clone-repos.meta.ts";
import {
  CREATE_PR_PHASE_TYPE, CREATE_PR_LABEL, CREATE_PR_CATEGORY, createPrInputFields,
} from "./git/create-pr.meta.ts";
import {
  LIST_PRS_PHASE_TYPE, LIST_PRS_LABEL, LIST_PRS_CATEGORY, listPrsInputFields,
} from "./git/list-prs.meta.ts";
import {
  ADD_PR_COMMENT_PHASE_TYPE, ADD_PR_COMMENT_LABEL, ADD_PR_COMMENT_CATEGORY, addPrCommentInputFields,
} from "./git/add-pr-comment.meta.ts";
import {
  FETCH_PR_COMMENTS_PHASE_TYPE, FETCH_PR_COMMENTS_LABEL, FETCH_PR_COMMENTS_CATEGORY, fetchPrCommentsInputFields,
} from "./git/fetch-pr-comments.meta.ts";

import {
  GET_TICKET_PHASE_TYPE, GET_TICKET_LABEL, GET_TICKET_CATEGORY, getTicketOutputSchema, getTicketInputFields,
} from "./tickets/get-ticket.meta.ts";
import {
  CREATE_TICKET_PHASE_TYPE, CREATE_TICKET_LABEL, CREATE_TICKET_CATEGORY, createTicketOutputSchema, createTicketInputFields,
} from "./tickets/create-ticket.meta.ts";
import {
  UPDATE_TICKET_PHASE_TYPE, UPDATE_TICKET_LABEL, UPDATE_TICKET_CATEGORY, updateTicketOutputSchema, updateTicketInputFields,
} from "./tickets/update-ticket.meta.ts";
import {
  UPDATE_STATUS_PHASE_TYPE, UPDATE_STATUS_LABEL, UPDATE_STATUS_CATEGORY, updateStatusOutputSchema, updateStatusInputFields,
} from "./tickets/update-status.meta.ts";
import {
  ADD_TICKET_COMMENT_PHASE_TYPE, ADD_TICKET_COMMENT_LABEL, ADD_TICKET_COMMENT_CATEGORY, addTicketCommentOutputSchema, addTicketCommentInputFields,
} from "./tickets/add-ticket-comment.meta.ts";

import {
  NOTIFY_PHASE_TYPE, NOTIFY_LABEL, NOTIFY_CATEGORY, notifyOutputSchema, notifyInputFields,
} from "./notifications/notify.meta.ts";

export interface PhaseCatalogEntry {
  phaseType: string;
  label: string;
  category: string;
  inputFields: InputFields;
  outputSchema: OutputSchema | null;
}

export const phaseCatalog: PhaseCatalogEntry[] = [
  // AI
  { phaseType: ANALYZE_PHASE_TYPE,   label: ANALYZE_LABEL,   category: ANALYZE_CATEGORY,   inputFields: analyzeInputFields,   outputSchema: analyzeOutputSchema },
  { phaseType: PLAN_PHASE_TYPE,      label: PLAN_LABEL,      category: PLAN_CATEGORY,      inputFields: planInputFields,      outputSchema: planOutputSchema },
  { phaseType: IMPLEMENT_PHASE_TYPE, label: IMPLEMENT_LABEL, category: IMPLEMENT_CATEGORY, inputFields: implementInputFields, outputSchema: implementOutputSchema },

  // Repos
  { phaseType: SCAN_REPOS_PHASE_TYPE,       label: SCAN_REPOS_LABEL,       category: SCAN_REPOS_CATEGORY,       inputFields: scanReposInputFields,       outputSchema: scanReposOutputSchema },
  { phaseType: CHECKOUT_REPO_PHASE_TYPE,    label: CHECKOUT_REPO_LABEL,    category: CHECKOUT_REPO_CATEGORY,    inputFields: checkoutRepoInputFields,    outputSchema: checkoutRepoOutputSchema },
  { phaseType: COMMIT_PUSH_PHASE_TYPE,      label: COMMIT_PUSH_LABEL,      category: COMMIT_PUSH_CATEGORY,      inputFields: commitPushInputFields,      outputSchema: commitPushOutputSchema },
  { phaseType: CLEANUP_REPOS_PHASE_TYPE,    label: CLEANUP_REPOS_LABEL,    category: CLEANUP_REPOS_CATEGORY,    inputFields: cleanupReposInputFields,    outputSchema: cleanupReposOutputSchema },
  { phaseType: CREATE_WORKSPACE_PHASE_TYPE, label: CREATE_WORKSPACE_LABEL, category: CREATE_WORKSPACE_CATEGORY, inputFields: createWorkspaceInputFields, outputSchema: createWorkspaceOutputSchema },

  // Git (no outputSchema yet)
  { phaseType: GET_REPO_PHASE_TYPE,          label: GET_REPO_LABEL,          category: GET_REPO_CATEGORY,          inputFields: getRepoInputFields,          outputSchema: null },
  { phaseType: CLONE_REPOS_PHASE_TYPE,       label: CLONE_REPOS_LABEL,       category: CLONE_REPOS_CATEGORY,       inputFields: cloneReposInputFields,       outputSchema: null },
  { phaseType: CREATE_PR_PHASE_TYPE,         label: CREATE_PR_LABEL,         category: CREATE_PR_CATEGORY,         inputFields: createPrInputFields,         outputSchema: null },
  { phaseType: LIST_PRS_PHASE_TYPE,          label: LIST_PRS_LABEL,          category: LIST_PRS_CATEGORY,          inputFields: listPrsInputFields,          outputSchema: null },
  { phaseType: ADD_PR_COMMENT_PHASE_TYPE,    label: ADD_PR_COMMENT_LABEL,    category: ADD_PR_COMMENT_CATEGORY,    inputFields: addPrCommentInputFields,    outputSchema: null },
  { phaseType: FETCH_PR_COMMENTS_PHASE_TYPE, label: FETCH_PR_COMMENTS_LABEL, category: FETCH_PR_COMMENTS_CATEGORY, inputFields: fetchPrCommentsInputFields, outputSchema: null },

  // Tickets
  { phaseType: GET_TICKET_PHASE_TYPE,         label: GET_TICKET_LABEL,         category: GET_TICKET_CATEGORY,         inputFields: getTicketInputFields,         outputSchema: getTicketOutputSchema },
  { phaseType: CREATE_TICKET_PHASE_TYPE,      label: CREATE_TICKET_LABEL,      category: CREATE_TICKET_CATEGORY,      inputFields: createTicketInputFields,      outputSchema: createTicketOutputSchema },
  { phaseType: UPDATE_TICKET_PHASE_TYPE,      label: UPDATE_TICKET_LABEL,      category: UPDATE_TICKET_CATEGORY,      inputFields: updateTicketInputFields,      outputSchema: updateTicketOutputSchema },
  { phaseType: UPDATE_STATUS_PHASE_TYPE,      label: UPDATE_STATUS_LABEL,      category: UPDATE_STATUS_CATEGORY,      inputFields: updateStatusInputFields,      outputSchema: updateStatusOutputSchema },
  { phaseType: ADD_TICKET_COMMENT_PHASE_TYPE, label: ADD_TICKET_COMMENT_LABEL, category: ADD_TICKET_COMMENT_CATEGORY, inputFields: addTicketCommentInputFields, outputSchema: addTicketCommentOutputSchema },

  // Notifications
  { phaseType: NOTIFY_PHASE_TYPE, label: NOTIFY_LABEL, category: NOTIFY_CATEGORY, inputFields: notifyInputFields, outputSchema: notifyOutputSchema },
];
