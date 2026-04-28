// packages/phases/src/registry.ts
import type { PhaseDefinition } from "@journeyman/flow-editor";

import { analyzePhase } from "./ai/analyze.tsx";
import { planPhase } from "./ai/plan.tsx";
import { implementPhase } from "./ai/implement.tsx";

import { scanReposPhase } from "./repos/scan-repos.tsx";
import { checkoutRepoPhase } from "./repos/checkout-repo.tsx";
import { commitPushPhase } from "./repos/commit-push.tsx";
import { cleanupReposPhase } from "./repos/cleanup-repos.tsx";
import { createWorkspacePhase } from "./repos/create-workspace.tsx";

import { getRepoPhase } from "./git/get-repo.tsx";
import { cloneReposPhase } from "./git/clone-repos.tsx";
import { createPrPhase } from "./git/create-pr.tsx";
import { listPrsPhase } from "./git/list-prs.tsx";
import { addPrCommentPhase } from "./git/add-pr-comment.tsx";
import { fetchPrCommentsPhase } from "./git/fetch-pr-comments.tsx";

import { getTicketPhase } from "./tickets/get-ticket.tsx";
import { createTicketPhase } from "./tickets/create-ticket.tsx";
import { updateTicketPhase } from "./tickets/update-ticket.tsx";
import { updateStatusPhase } from "./tickets/update-status.tsx";
import { addTicketCommentPhase } from "./tickets/add-ticket-comment.tsx";

import { notifyPhase } from "./notifications/notify.tsx";

// `PhaseDefinition<TConfig>` is invariant in TConfig (the `onChange` and
// `defaultConfig` positions are both contravariant), so a list of definitions
// with different config types cannot be typed as `PhaseDefinition<unknown>[]`.
// The registry stores them as `PhaseDefinition<any>[]` and consumers treat
// each entry's `TConfig` opaquely.
export const builtInPhases: PhaseDefinition<any>[] = [
  // AI
  analyzePhase, planPhase, implementPhase,
  // Repos
  scanReposPhase, checkoutRepoPhase, commitPushPhase, cleanupReposPhase, createWorkspacePhase,
  // Git
  getRepoPhase, cloneReposPhase, createPrPhase, listPrsPhase, addPrCommentPhase, fetchPrCommentsPhase,
  // Tickets
  getTicketPhase, createTicketPhase, updateTicketPhase, updateStatusPhase, addTicketCommentPhase,
  // Notifications
  notifyPhase,
];
