import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  COMMENT_ON_TICKET_PHASE_TYPE,
  COMMENT_ON_TICKET_LABEL,
  COMMENT_ON_TICKET_CATEGORY,
  COMMENT_ON_TICKET_DESCRIPTION,
  commentOnTicketOutputSchema,
} from "./comment-on-ticket.meta.ts";

interface CommentOnTicketConfig {
  issueRef: string;
  template: string;
  body?: string;
}

export const commentOnTicketPhase: PhaseDefinition<CommentOnTicketConfig> = {
  phaseType: COMMENT_ON_TICKET_PHASE_TYPE,
  label: COMMENT_ON_TICKET_LABEL,
  category: COMMENT_ON_TICKET_CATEGORY,
  description: COMMENT_ON_TICKET_DESCRIPTION,
  color: "#a29bfe",
  icon: "💭",
  defaultConfig: { issueRef: "", template: "", body: "" },
  configSchema: z.object({
    issueRef: z.string().min(1),
    template: z.string(),
    body: z.string().optional(),
  }),
  configFields: {
    issueRef: { label: "Issue ref", widget: "text", help: "Supports #{ticket} placeholder" },
    template:  { label: "Template id", widget: "text", help: "e.g. analysis-summary, completion-summary" },
    body:      { label: "Inline body (optional)", widget: "textarea", help: "Used when no template is set" },
  },
  tabs: { io: "shown", mcp: "hidden", retry: "shown" },
  slots: [
    {
      name: "GITHUB_ACCESS_TOKEN",
      description: "GitHub PAT with repo and project scopes — used to call the GitHub API.",
    },
  ],
  summary: c => c.template || c.issueRef || "(no target)",
  executor: { kind: "ticket-provider", method: "addComment" },
  outputSchema: commentOnTicketOutputSchema,
};
