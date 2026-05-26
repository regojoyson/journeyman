// packages/steps/src/issues/get-issue.tsx
import type { StepDefinition } from "@journeyman/flow-editor";
import { summaryValue } from "@journeyman/flow-editor";
import {
  GET_ISSUE_STEP_TYPE,
  GET_ISSUE_LABEL,
  GET_ISSUE_CATEGORY,
  GET_ISSUE_DESCRIPTION,
  getIssueOutputSchema,
  getIssueConfigSchema,
} from "./get-issue.meta.ts";

interface GetIssueConfig {
  ref: string;
}

export const getIssueStep: StepDefinition<GetIssueConfig> = {
  stepType: GET_ISSUE_STEP_TYPE,
  label: GET_ISSUE_LABEL,
  category: GET_ISSUE_CATEGORY,
  description: GET_ISSUE_DESCRIPTION,
  color: "#a29bfe",
  icon: "📥",
  defaultConfig: { ref: "" },
  configSchema: getIssueConfigSchema,
  configFields: {
    ref: { label: "Ref", widget: "text", help: "Supports #{issue} placeholder" },
  },
  tabs: { io: "shown", mcp: "hidden", retry: "shown" },
  summary: (c, ctx) => summaryValue(c, ctx, "ref") || "(no issue)",
  executor: { kind: "issue-provider", method: "getIssue" },
  outputSchema: getIssueOutputSchema,
};
