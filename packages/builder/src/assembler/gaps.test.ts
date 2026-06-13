import { describe, it, expect } from "vitest";
import { detectGaps } from "./gaps.ts";
import type { AssemblerIntent } from "./intent.ts";

const base: AssemblerIntent = { summary: "", triggers: [{ kind: "manual" }], steps: [] };

describe("detectGaps", () => {
  it("flags an unimplemented provider step (Slack) as not-implemented", () => {
    const intent: AssemblerIntent = {
      ...base,
      steps: [{ ref: "notify", kind: "provider", label: "Notify", stepType: "send-message", provider: "slack" }],
    };
    const gaps = detectGaps(intent, { nodeIdByRef: { notify: "n_1" } });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].kind).toBe("not-implemented");
    expect(gaps[0].nodeIds).toEqual(["n_1"]);
  });

  it("flags a deny-listed operation (Jira transition) as not-implemented", () => {
    const intent: AssemblerIntent = {
      ...base,
      steps: [{ ref: "move", kind: "provider", label: "Move", stepType: "transition-issue", provider: "jira" }],
    };
    const gaps = detectGaps(intent, { nodeIdByRef: { move: "n_1" } });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].kind).toBe("not-implemented");
    expect(gaps[0].reason).toMatch(/updateStatus/);
  });

  it("does not flag an implemented provider operation (GitHub PR comment)", () => {
    const intent: AssemblerIntent = {
      ...base,
      steps: [{ ref: "c", kind: "provider", label: "Comment", stepType: "comment-on-pull-request", provider: "github" }],
    };
    expect(detectGaps(intent, { nodeIdByRef: { c: "n_1" } })).toHaveLength(0);
  });

  it("flags a webhook trigger with no webhook as a webhook gap", () => {
    const intent: AssemblerIntent = {
      summary: "", steps: [],
      triggers: [{ kind: "webhook", webhookId: null, listensFor: ["pull_request"] }],
    };
    const gaps = detectGaps(intent, { nodeIdByRef: {}, triggerNodeIds: ["t_1"] });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].kind).toBe("webhook");
    expect(gaps[0].required).toBe(true);
  });

  it("flags a webhook-wait with no webhook as a webhook gap", () => {
    const intent: AssemblerIntent = {
      ...base,
      steps: [{ ref: "w", kind: "webhook-wait", label: "Wait for CI", waitWebhookId: null }],
    };
    const gaps = detectGaps(intent, { nodeIdByRef: { w: "n_1" } });
    expect(gaps.some((g) => g.kind === "webhook" && g.nodeIds.includes("n_1"))).toBe(true);
  });
});
