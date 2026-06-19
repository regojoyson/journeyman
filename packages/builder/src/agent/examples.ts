import type { AssemblerIntent } from "../assembler/intent.ts";

export interface FewShotExample {
  goal: string;
  intent: AssemblerIntent;
}

/** Development: ticket → clone → implement(+commit/push) → PR → wait for approval. */
const dev: FewShotExample = {
  goal: "When a ticket moves to Ready for Development, implement it and open a PR, then wait for approval.",
  intent: {
    summary: "Implement a Jira ticket and open a PR, then pause for review approval.",
    triggers: [{
      kind: "webhook", webhookId: null, listensFor: ["jira:issue_updated"],
      inputs: [{ name: "issueKey", type: "string", fromPath: "$.issue.key" }],
    }],
    steps: [
      { ref: "ticket", kind: "provider", label: "Get ticket", stepType: "get-issue", provider: "jira",
        inputs: [{ slot: "ref", value: { from: "workflow-input", name: "issueKey" } }] },
      { ref: "clone", kind: "provider", label: "Clone repos", stepType: "clone-repos", provider: "github" },
      { ref: "impl", kind: "ai", label: "Implement the change", stepType: "custom-ai", customStepId: "tmp-impl",
        tools: ["read-file", "edit-file", "bash"],
        inputs: [{ slot: "issue", value: { from: "step-output", stepRef: "ticket", field: "issue" } }] },
      { ref: "pr", kind: "provider", label: "Open pull request", stepType: "open-pull-request", provider: "github" },
      { ref: "review", kind: "human-task", label: "Wait for review approval", assignee: "team", taskPrompt: "Approve this PR?" },
    ],
    newCustomSteps: [{
      id: "tmp-impl",
      step: {
        name: "Implement ticket",
        promptTemplate: "Implement the change described in {{input.issue}}. When done, run git add/commit and push the branch.",
        inputFields: [{ name: "issue", type: "json-object", required: true }],
        outputMode: "text",
        defaultTools: ["read-file", "edit-file", "bash"],
      },
    }],
  },
};

/** QA: run tests, branch on pass/fail, comment the result. */
const qa: FewShotExample = {
  goal: "Run the test suite for a PR and comment pass or fail on the PR.",
  intent: {
    summary: "Run tests for a PR and report the result on the PR.",
    triggers: [{ kind: "manual" }],
    steps: [
      { ref: "test", kind: "ai", label: "Run tests", stepType: "custom-ai", customStepId: "tmp-test",
        tools: ["bash"] },
    ],
    gateway: {
      ref: "gate", label: "Tests passed?",
      branches: [{
        label: "passed",
        condition: { left: { from: "step-output", stepRef: "test", field: "passed" }, op: "==", right: true },
        steps: [{ ref: "ok", kind: "provider", label: "Comment success", stepType: "comment-on-pull-request", provider: "github" }],
      }],
      elseBranch: { steps: [{ ref: "fail", kind: "provider", label: "Comment failure", stepType: "comment-on-pull-request", provider: "github" }] },
    },
    newCustomSteps: [{
      id: "tmp-test",
      step: {
        name: "Run tests",
        promptTemplate: "Run the project's test suite with bash and report whether it passed.",
        outputMode: "structured",
        outputFields: [{ name: "passed", type: "boolean", required: true }],
        defaultTools: ["bash"],
      },
    }],
  },
};

/** SRE: alert → investigate → human approval → remediate → confirm. */
const sre: FewShotExample = {
  goal: "When an alert fires, investigate, wait for an engineer to approve, then apply the fix.",
  intent: {
    summary: "Investigate an incident alert, get human approval, then remediate.",
    triggers: [{
      kind: "webhook", webhookId: null, listensFor: [],
      inputs: [{ name: "service", type: "string", fromPath: "$.service" }],
    }],
    steps: [
      { ref: "investigate", kind: "ai", label: "Investigate", stepType: "custom-ai", customStepId: "tmp-inv",
        tools: ["bash"],
        inputs: [{ slot: "service", value: { from: "workflow-input", name: "service" } }] },
      { ref: "approve", kind: "human-task", label: "Approve remediation", assignee: "oncall", taskPrompt: "Approve the proposed fix?" },
      { ref: "remediate", kind: "ai", label: "Apply the fix (production)", stepType: "custom-ai", customStepId: "tmp-fix",
        tools: ["bash"] },
    ],
    newCustomSteps: [
      { id: "tmp-inv", step: { name: "Investigate incident",
        promptTemplate: "Investigate the alert for {{input.service}} and propose a fix.",
        inputFields: [{ name: "service", type: "string", required: true }],
        outputMode: "text", defaultTools: ["bash"] } },
      { id: "tmp-fix", step: { name: "Apply remediation",
        promptTemplate: "Apply the approved fix in production, carefully.",
        outputMode: "text", defaultTools: ["bash"] } },
    ],
  },
};

export const FEW_SHOT_EXAMPLES: FewShotExample[] = [dev, qa, sre];

/** Render the examples as prompt text (goal + the intent the model should produce). */
export function serializeFewShotExamples(examples: FewShotExample[] = FEW_SHOT_EXAMPLES): string {
  return examples
    .map((e) => `Goal: ${e.goal}\nproposePlan input:\n${JSON.stringify(e.intent, null, 2)}`)
    .join("\n\n");
}
