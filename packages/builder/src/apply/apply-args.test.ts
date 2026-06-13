import { describe, it, expect } from "vitest";
import { buildApplyArgs, requiredGapsRemaining } from "./apply-args.ts";
import type { BuilderSessionRecord } from "../types.ts";
import type { BuildPlan } from "@journeyman/core";

const plan: BuildPlan = {
  newCustomSteps: [], workflow: { schemaVersion: 2, nodes: [], edges: [] },
  defaults: { sandboxId: null, model: null }, stepBindings: [],
  gaps: [], summary: "s",
};

function session(over: Partial<BuilderSessionRecord> = {}): BuilderSessionRecord {
  return {
    id: "s1", orgId: "o1", userId: "u1", name: "PR review", status: "active",
    messages: [], buildPlan: plan, appliedFlowId: null, createdBy: "u1",
    createdAt: "", updatedAt: "", ...over,
  };
}

describe("buildApplyArgs", () => {
  it("maps a user-scoped session to user-scope ApplyArgs", () => {
    const args = buildApplyArgs(session(), { orgId: "o1", userId: "u1" });
    expect(args).toMatchObject({ workflowName: "PR review", scope: "user", orgId: "o1", userId: "u1", createdBy: "u1" });
    expect(args.plan).toBe(plan);
  });
});

describe("requiredGapsRemaining", () => {
  it("is true when any gap is required", () => {
    expect(requiredGapsRemaining({ ...plan, gaps: [{ id: "g", kind: "webhook", nodeIds: [], reason: "", required: true, fixHint: null }] })).toBe(true);
  });
  it("is false when there are no required gaps", () => {
    expect(requiredGapsRemaining(plan)).toBe(false);
    expect(requiredGapsRemaining({ ...plan, gaps: [{ id: "g", kind: "capability", nodeIds: [], reason: "", required: false, fixHint: null }] })).toBe(false);
  });
});
