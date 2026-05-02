import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const COMMENT_ON_TICKET_PHASE_TYPE = "comment-on-ticket";
export const COMMENT_ON_TICKET_LABEL = "Comment on Ticket";
export const COMMENT_ON_TICKET_CATEGORY = "Issue Tracker";
export const COMMENT_ON_TICKET_DESCRIPTION =
  "Post a comment on a ticket, optionally rendered from a template.";

export const commentOnTicketOutputSchema: OutputSchema = {
  commentId: { type: "string" },
};

export const commentOnTicketInputFields: InputFields = {
  issueRef: { type: "string", label: "Issue ref", required: true },
  template:  { type: "string", label: "Template" },
  body:      { type: "string", label: "Body" },
};
