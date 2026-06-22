import { describe, it, expect } from "vitest";
import { assemble } from "./assemble.ts";
import type { AssemblerIntent } from "./intent.ts";

describe("assemble — structure", () => {
  it("builds trigger → step → end with default edges and unique, dot-free node ids", () => {
    const intent: AssemblerIntent = {
      summary: "Get a ticket and comment.",
      triggers: [{ kind: "manual" }],
      steps: [
        { ref: "get", kind: "provider", label: "Get issue", stepType: "get-issue", provider: "jira",
          inputs: [{ slot: "ref", value: { from: "workflow-input", name: "ticketKey" } }] },
      ],
    };
    const { workflow, stepBindings } = assemble(intent, {});
    const ids = workflow.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => !id.includes("."))).toBe(true);
    expect(workflow.nodes.some((n) => n.type === "trigger-manual")).toBe(true);
    expect(workflow.nodes.some((n) => n.type === "step" && n.stepType === "get-issue")).toBe(true);
    expect(workflow.nodes.some((n) => n.type === "end")).toBe(true);
    const step = workflow.nodes.find((n) => n.stepType === "get-issue")!;
    expect(step.inputs!.ref).toEqual({ kind: "ref", ref: "workflow.input.ticketKey" });
    for (const e of workflow.edges) {
      expect(ids).toContain(e.source);
      expect(ids).toContain(e.target);
    }
    expect(stepBindings.find((b) => b.stepKind === "provider")).toBeDefined();
  });

  it("wires step-output refs between steps using assigned node ids", () => {
    const intent: AssemblerIntent = {
      summary: "",
      triggers: [{ kind: "manual" }],
      steps: [
        { ref: "a", kind: "ai", label: "Analyze", stepType: "custom-ai", customStepId: "tmp-a",
          model: "claude-opus", tools: ["read-file"] },
        { ref: "b", kind: "provider", label: "Comment", stepType: "comment-on-pull-request", provider: "github",
          inputs: [{ slot: "body", value: { from: "step-output", stepRef: "a", field: "summary" } }] },
      ],
    };
    const { workflow } = assemble(intent, {});
    const a = workflow.nodes.find((n) => n.config?.customStepId === "tmp-a")!;
    const b = workflow.nodes.find((n) => n.stepType === "comment-on-pull-request")!;
    expect(b.inputs!.body).toEqual({ kind: "ref", ref: `${a.id}.output.summary` });
  });

  it("builds a webhook trigger with config + inputDefs, and includes a webhook gap when unconfigured", () => {
    const intent: AssemblerIntent = {
      summary: "",
      triggers: [{ kind: "webhook", webhookId: null, listensFor: ["pull_request.opened"],
        inputs: [{ name: "prNumber", type: "number", fromPath: "$.pull_request.number" }] }],
      steps: [{ ref: "x", kind: "provider", label: "Get repo", stepType: "get-repository", provider: "github" }],
    };
    const { workflow, gaps } = assemble(intent, {});
    const trig = workflow.nodes.find((n) => n.type === "trigger-webhook")!;
    expect(trig.config!.inputsMapping).toEqual({ prNumber: { fromPath: "$.pull_request.number", type: "number" } });
    expect(trig.config!.listensFor).toEqual(["pull_request.opened"]);
    expect(workflow.inputDefs).toEqual([{ name: "prNumber", type: "number" }]);
    expect(gaps.some((g) => g.kind === "webhook")).toBe(true);
  });

  it("emits human-task and webhook-wait pause nodes with the right node types", () => {
    const intent: AssemblerIntent = {
      summary: "",
      triggers: [{ kind: "manual" }],
      steps: [
        { ref: "rev", kind: "human-task", label: "Review", assignee: "oncall", taskPrompt: "Approve?" },
        { ref: "ci", kind: "webhook-wait", label: "Wait CI", waitWebhookId: "wh-ci" },
      ],
    };
    const { workflow, stepBindings } = assemble(intent, {});
    expect(workflow.nodes.some((n) => n.type === "human-task")).toBe(true);
    expect(workflow.nodes.some((n) => n.type === "webhook-wait")).toBe(true);
    expect(stepBindings.some((b) => b.stepKind === "human-task")).toBe(true);
    expect(stepBindings.some((b) => b.stepKind === "webhook-wait")).toBe(true);
  });
});

describe("assemble — branching", () => {
  it("emits a gateway after the main chain with conditional + else edges and arm nodes", () => {
    const intent: AssemblerIntent = {
      summary: "",
      triggers: [{ kind: "manual" }],
      steps: [{ ref: "test", kind: "ai", label: "Run tests", stepType: "custom-ai", customStepId: "tmp-t" }],
      gateway: {
        ref: "gate", label: "Pass?",
        branches: [{
          label: "pass",
          condition: { left: { from: "step-output", stepRef: "test", field: "passed" }, op: "==", right: true },
          steps: [{ ref: "ok", kind: "provider", label: "Comment pass", stepType: "comment-on-pull-request", provider: "github" }],
        }],
        elseBranch: { steps: [{ ref: "bad", kind: "provider", label: "Comment fail", stepType: "comment-on-pull-request", provider: "github" }] },
      },
    };
    const { workflow } = assemble(intent, {});
    const gw = workflow.nodes.find((n) => n.type === "gateway-xor")!;
    expect(gw).toBeDefined();
    const testNode = workflow.nodes.find((n) => n.config?.customStepId === "tmp-t")!;
    expect(workflow.edges.some((e) => e.source === testNode.id && e.target === gw.id)).toBe(true);
    const cond = workflow.edges.find((e) => e.type === "conditional")!;
    expect(cond.source).toBe(gw.id);
    expect(cond.branchLabel).toBe("pass");
    expect(cond.condition).toEqual({ "==": [{ var: `${testNode.id}.output.passed` }, true] });
    expect(workflow.edges.some((e) => e.type === "else" && e.source === gw.id)).toBe(true);
    expect(workflow.nodes.filter((n) => n.stepType === "comment-on-pull-request")).toHaveLength(2);
    const ids = new Set(workflow.nodes.map((n) => n.id));
    for (const e of workflow.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });

  it("detects gaps inside branch arms", () => {
    const intent: AssemblerIntent = {
      summary: "", triggers: [{ kind: "manual" }], steps: [],
      gateway: {
        ref: "g", label: "x",
        branches: [{
          label: "a",
          condition: { left: { from: "workflow-input", name: "sev" }, op: "==", right: "high" },
          steps: [{ ref: "n", kind: "provider", label: "Comment", stepType: "comment-on-issue", provider: "linear" }],
        }],
      },
    };
    const { gaps } = assemble(intent, {});
    expect(gaps.some((gp) => gp.kind === "not-implemented")).toBe(true);
  });
});
