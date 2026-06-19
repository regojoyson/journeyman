import { describe, it, expect } from "vitest";
import { runBuilderTurn, planFromIntent, type BuilderModelCaller } from "./runner.ts";
import type { AssemblerIntent } from "../assembler/intent.ts";

const intent: AssemblerIntent = {
  summary: "Get a ticket",
  triggers: [{ kind: "manual" }],
  steps: [{ ref: "g", kind: "provider", label: "Get", stepType: "get-issue", provider: "jira" }],
  newCustomSteps: [{ id: "tmp", step: { name: "X" } }],
};

describe("runBuilderTurn", () => {
  it("returns just an assistant message when the model asks a question", async () => {
    const caller: BuilderModelCaller = { call: async () => ({ text: "Which repo?", proposedIntent: null }) };
    const res = await runBuilderTurn({ caller }, { system: "s", messages: [{ role: "user", content: "hi" }] });
    expect(res.assistantMessage).toBe("Which repo?");
    expect(res.plan).toBeNull();
  });

  it("assembles a plan when the model proposes an intent", async () => {
    const caller: BuilderModelCaller = { call: async () => ({ text: "Here's the plan.", proposedIntent: intent }) };
    const res = await runBuilderTurn({ caller }, { system: "s", messages: [{ role: "user", content: "go" }] });
    expect(res.plan).not.toBeNull();
    expect(res.plan!.summary).toBe("Get a ticket");
    expect(res.plan!.newCustomSteps).toHaveLength(1);
    expect(res.plan!.workflow.nodes.some((n) => n.stepType === "get-issue")).toBe(true);
  });
});

describe("planFromIntent", () => {
  it("carries newCustomSteps and summary through to the plan", () => {
    const plan = planFromIntent(intent);
    expect(plan.newCustomSteps[0].id).toBe("tmp");
    expect(plan.summary).toBe("Get a ticket");
    expect(Array.isArray(plan.gaps)).toBe(true);
  });
});
