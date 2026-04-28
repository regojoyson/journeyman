// packages/phases/src/git/add-pr-comment.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface AddPrCommentConfig {
  owner: string;
  repo: string;
  prNumber: number | "";
  template: string;
  body?: string;
}

export const addPrCommentPhase: PhaseDefinition<AddPrCommentConfig> = {
  phaseType: "add-pr-comment",
  label: "Add PR Comment",
  category: "Git",
  description: "Post a comment on a pull/merge request, optionally rendered from a template.",
  color: "#74b9ff",
  icon: "💬",
  defaultConfig: { owner: "", repo: "", prNumber: "", template: "", body: "" },
  configSchema: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    prNumber: z.union([z.number(), z.literal("")]),
    template: z.string(),
    body: z.string().optional(),
  }),
  configFields: {
    owner:    { label: "Owner / org", widget: "text" },
    repo:     { label: "Repository", widget: "text" },
    prNumber: { label: "PR number", widget: "number", help: "Leave blank to resolve from upstream step" },
    template: { label: "Template id", widget: "text", help: "e.g. plan-summary, pr-opened" },
    body:     { label: "Inline body (optional)", widget: "textarea" },
  },
  tabs: { io: "shown", credentials: "required", mcp: "hidden", retry: "shown" },
  summary: c => c.template || (c.prNumber !== "" ? `#${c.prNumber}` : "(no target)"),
  executor: { kind: "git-provider", method: "addComment" },
};
