// packages/phases/src/issues/create-issue.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  CREATE_ISSUE_PHASE_TYPE,
  CREATE_ISSUE_LABEL,
  CREATE_ISSUE_CATEGORY,
  CREATE_ISSUE_DESCRIPTION,
  createIssueOutputSchema,
} from "./create-issue.meta.ts";

interface CreateIssueConfig {
  project: string;
  title: string;
  description: string;
  labels: string[];
}

export const createIssuePhase: PhaseDefinition<CreateIssueConfig> = {
  phaseType: CREATE_ISSUE_PHASE_TYPE,
  label: CREATE_ISSUE_LABEL,
  category: CREATE_ISSUE_CATEGORY,
  description: CREATE_ISSUE_DESCRIPTION,
  color: "#a29bfe",
  icon: "🎫",
  defaultConfig: { project: "", title: "", description: "", labels: [] },
  configSchema: z.object({
    project: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    labels: z.array(z.string()),
  }),
  configFields: {
    project:     { label: "Project key", widget: "text" },
    title:       { label: "Title", widget: "text" },
    description: { label: "Description", widget: "textarea" },
    // labels rendered as comma-separated string for round 1; the schema enforces array shape via the form's array handling below.
  },
  tabs: { io: "shown", mcp: "hidden", retry: "shown" },
  slots: [
    {
      name: "GITHUB_ACCESS_TOKEN",
      description: "GitHub PAT with repo and project scopes — used to call the GitHub API.",
    },
  ],
  summary: c => c.title || c.project,
  executor: { kind: "issue-provider", method: "createIssue" },
  outputSchema: createIssueOutputSchema,
};
