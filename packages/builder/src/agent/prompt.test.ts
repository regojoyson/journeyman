import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildContextMessage } from "./prompt.ts";

describe("buildSystemPrompt", () => {
  it("states the intent contract, the proposePlan tool, and the no-invented-steps rule", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("proposePlan");
    expect(p.toLowerCase()).toContain("only");
    expect(p.toLowerCase()).toContain("clarify");
  });
  it("includes reference playbooks for the common scenarios", () => {
    const p = buildSystemPrompt().toLowerCase();
    expect(p).toContain("development");
    expect(p).toContain("qa");
    expect(p).toContain("sre");
    expect(p).toContain("review");
  });
  it("gives custom-step authoring guidance (prompt template + inputs/outputs)", () => {
    const p = buildSystemPrompt().toLowerCase();
    expect(p).toContain("prompttemplate");
    expect(p).toContain("outputmode");
  });
  it("embeds at least one worked example", () => {
    expect(buildSystemPrompt()).toContain("Goal:");
    expect(buildSystemPrompt()).toContain("proposePlan input:");
  });
});

describe("buildContextMessage", () => {
  it("includes catalog, providers, node types, and inventory sections", () => {
    const msg = buildContextMessage({
      catalog: "Available step types:\n- get-issue",
      providers: "Implemented providers:\n  git-provider: github",
      nodeTypes: "Supported node types: step, gateway-xor",
      inventory: "Your existing custom steps:\n  (none)",
    });
    expect(msg).toContain("get-issue");
    expect(msg).toContain("github");
    expect(msg).toContain("gateway-xor");
    expect(msg).toContain("custom steps");
  });
});
