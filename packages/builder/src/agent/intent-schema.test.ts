import { describe, it, expect } from "vitest";
import { assemblerIntentSchema } from "./intent-schema.ts";

describe("assemblerIntentSchema", () => {
  it("accepts a full intent with a webhook trigger, steps, a gateway, and new custom steps", () => {
    const intent = {
      summary: "Review PRs",
      triggers: [{ kind: "webhook", webhookId: null, listensFor: ["pull_request.opened"],
        inputs: [{ name: "pr", type: "number", fromPath: "$.pull_request.number" }] }],
      steps: [{ ref: "rev", kind: "ai", label: "Review", stepType: "custom-ai", customStepId: "tmp-r",
        tools: ["read-file"], inputs: [{ slot: "diff", value: { from: "workflow-input", name: "pr" } }] }],
      gateway: { ref: "g", label: "ok?", branches: [
        { label: "pass", condition: { left: { from: "step-output", stepRef: "rev", field: "ok" }, op: "==", right: true }, steps: [] },
      ] },
      newCustomSteps: [{ id: "tmp-r", step: { scope: "user", name: "Review", promptTemplate: "Review {{input.diff}}" } }],
    };
    const parsed = assemblerIntentSchema.parse(intent);
    expect(parsed.summary).toBe("Review PRs");
    expect(parsed.steps[0].ref).toBe("rev");
  });

  it("accepts the minimal manual-trigger intent", () => {
    expect(assemblerIntentSchema.parse({ summary: "x", triggers: [{ kind: "manual" }], steps: [] }).triggers[0].kind).toBe("manual");
  });

  it("rejects an intent missing triggers", () => {
    expect(() => assemblerIntentSchema.parse({ summary: "x", steps: [] })).toThrow();
  });
});
