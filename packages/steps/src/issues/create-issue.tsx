// packages/steps/src/issues/create-issue.tsx
import type { StepDefinition } from "@journeyman/flow-editor";
import {
  CREATE_ISSUE_STEP_TYPE,
  CREATE_ISSUE_LABEL,
  CREATE_ISSUE_CATEGORY,
  CREATE_ISSUE_DESCRIPTION,
  createIssueOutputSchema,
  createIssueConfigSchema,
} from "./create-issue.meta.ts";

interface CreateIssueConfig {
  project: string;
  title: string;
  description: string;
  labels: string[];
}

export const createIssueStep: StepDefinition<CreateIssueConfig> = {
  stepType: CREATE_ISSUE_STEP_TYPE,
  label: CREATE_ISSUE_LABEL,
  category: CREATE_ISSUE_CATEGORY,
  description: CREATE_ISSUE_DESCRIPTION,
  color: "#a29bfe",
  icon: "🎫",
  defaultConfig: { project: "", title: "", description: "", labels: [] },
  configSchema: createIssueConfigSchema,
  configFields: {
    project:     { label: "Project key", widget: "text" },
    title:       { label: "Title", widget: "text" },
    description: { label: "Description", widget: "textarea" },
    // labels rendered as comma-separated string for round 1; the schema enforces array shape via the form's array handling below.
  },
  tabs: { io: "shown", mcp: "hidden", retry: "shown", requiredSecrets: "hidden" },
  summary: c => c.title || c.project,
  executor: { kind: "issue-provider", method: "createIssue" },
  outputSchema: createIssueOutputSchema,
  comingSoon: true,
};
