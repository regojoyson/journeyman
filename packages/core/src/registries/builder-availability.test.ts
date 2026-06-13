import { describe, it, expect } from "vitest";
import {
  isNodeTypeSupported,
  listSupportedNodeTypes,
  unsupportedOperationForStep,
  UNSUPPORTED_OPERATIONS,
} from "./builder-availability.ts";

describe("builder-availability — node types", () => {
  it("loops, branching, timers and waits ARE supported", () => {
    for (const t of ["loop", "if", "gateway-xor", "timer", "human-task", "webhook-wait"] as const) {
      expect(isNodeTypeSupported(t)).toBe(true);
    }
  });
  it("retry-block and try-catch are NOT supported", () => {
    expect(isNodeTypeSupported("retry-block")).toBe(false);
    expect(isNodeTypeSupported("try-catch")).toBe(false);
  });
  it("listSupportedNodeTypes excludes the two unsupported types", () => {
    const list = listSupportedNodeTypes();
    expect(list).not.toContain("retry-block");
    expect(list).not.toContain("try-catch");
    expect(list).toContain("loop");
  });
});

describe("builder-availability — unsupported operations", () => {
  it("flags Jira transition and comment as unsupported by their step types", () => {
    expect(unsupportedOperationForStep("jira", "transition-issue")).toBeDefined();
    expect(unsupportedOperationForStep("jira", "comment-on-issue")).toBeDefined();
  });
  it("returns undefined for a supported operation", () => {
    expect(unsupportedOperationForStep("github", "open-pull-request")).toBeUndefined();
  });
  it("every entry names the provider, method and at least one step type", () => {
    for (const op of UNSUPPORTED_OPERATIONS) {
      expect(op.provider).toBeTruthy();
      expect(op.method).toBeTruthy();
      expect(op.stepTypes.length).toBeGreaterThan(0);
    }
  });
});
