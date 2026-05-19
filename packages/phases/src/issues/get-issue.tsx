// packages/phases/src/issues/get-issue.tsx
import type { PhaseDefinition } from "@journeyman/flow-editor";
import { summaryValue } from "@journeyman/flow-editor";
import {
  GET_ISSUE_PHASE_TYPE,
  GET_ISSUE_LABEL,
  GET_ISSUE_CATEGORY,
  GET_ISSUE_DESCRIPTION,
  getIssueOutputSchema,
  getIssueConfigSchema,
} from "./get-issue.meta.ts";

interface GetIssueConfig {
  issueRef: string;
}

export const getIssuePhase: PhaseDefinition<GetIssueConfig> = {
  phaseType: GET_ISSUE_PHASE_TYPE,
  label: GET_ISSUE_LABEL,
  category: GET_ISSUE_CATEGORY,
  description: GET_ISSUE_DESCRIPTION,
  color: "#a29bfe",
  icon: "📥",
  defaultConfig: { issueRef: "" },
  configSchema: getIssueConfigSchema,
  configFields: {
    issueRef: { label: "Issue ref", widget: "text", help: "e.g. jira:PROJ-123 (supports #{issue} placeholder)" },
  },
  tabs: { io: "shown", mcp: "hidden", retry: "shown" },
  summary: (c, ctx) => summaryValue(c, ctx, "issueRef") || "(no issue)",
  executor: { kind: "issue-provider", method: "getIssue" },
  outputSchema: getIssueOutputSchema,
};
