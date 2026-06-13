import { describe, it, expect } from "vitest";
import type { BuildPlan } from "@journeyman/core";
import {
  setStepModel, toggleStepTool, setStepMcpIds, setStepSandbox,
  mapSecretSlot, setDefaultModel, setDefaultSandbox, resolveGap,
} from "./plan-edits.ts";

function planFixture(): BuildPlan {
  return {
    summary: "s",
    newCustomSteps: [],
    defaults: { sandboxId: null, model: null },
    gaps: [
      { id: "g1", kind: "connection", nodeIds: ["n_1"], reason: "needs GitHub", required: true, fixHint: null },
      { id: "g2", kind: "skill", nodeIds: ["n_1"], reason: "optional skill", required: false, fixHint: null },
    ],
    workflow: {
      schemaVersion: 2,
      nodes: [
        { id: "n_1", type: "step", stepType: "custom-ai", displayName: "AI",
          model: "old-model", sandboxId: undefined,
          config: { tools: ["bash"], mcpInstanceIds: [], customStepId: "cs_1" } },
        { id: "n_2", type: "step", stepType: "open-pr", displayName: "PR", config: {} },
      ],
      edges: [],
      inputDefs: [],
    },
    stepBindings: [
      { nodeId: "n_1", stepKind: "ai",
        uses: { tools: ["bash"], mcpIds: [], model: "old-model", secrets: [{ slot: "GITHUB_TOKEN", secretName: null }] },
        io: { inputs: [], outputs: [] } },
      { nodeId: "n_2", stepKind: "provider", uses: { connection: "github" }, io: { inputs: [], outputs: [] } },
    ],
  } as BuildPlan;
}

const node = (p: BuildPlan, id: string) => p.workflow.nodes.find((n) => n.id === id)!;
const binding = (p: BuildPlan, id: string) => p.stepBindings.find((b) => b.nodeId === id)!;

describe("setStepModel", () => {
  it("updates the node model and the binding mirror", () => {
    const next = setStepModel(planFixture(), "n_1", "claude-opus-4-8");
    expect(node(next, "n_1").model).toBe("claude-opus-4-8");
    expect(binding(next, "n_1").uses.model).toBe("claude-opus-4-8");
  });
  it("clears the model when given an empty string", () => {
    const next = setStepModel(planFixture(), "n_1", "");
    expect(node(next, "n_1").model ?? null).toBeNull();
    expect(binding(next, "n_1").uses.model).toBeUndefined();
  });
  it("does not mutate the input plan", () => {
    const p = planFixture();
    setStepModel(p, "n_1", "x");
    expect(node(p, "n_1").model).toBe("old-model");
  });
});

describe("toggleStepTool", () => {
  it("adds a tool when absent (node + binding)", () => {
    const next = toggleStepTool(planFixture(), "n_1", "read-file");
    expect(node(next, "n_1").config!.tools).toEqual(["bash", "read-file"]);
    expect(binding(next, "n_1").uses.tools).toEqual(["bash", "read-file"]);
  });
  it("removes a tool when present", () => {
    const next = toggleStepTool(planFixture(), "n_1", "bash");
    expect(node(next, "n_1").config!.tools).toEqual([]);
    expect(binding(next, "n_1").uses.tools).toEqual([]);
  });
});

describe("setStepMcpIds / setStepSandbox", () => {
  it("sets mcp ids on node config and binding", () => {
    const next = setStepMcpIds(planFixture(), "n_1", ["m1", "m2"]);
    expect(node(next, "n_1").config!.mcpInstanceIds).toEqual(["m1", "m2"]);
    expect(binding(next, "n_1").uses.mcpIds).toEqual(["m1", "m2"]);
  });
  it("sets the sandbox on node and binding", () => {
    const next = setStepSandbox(planFixture(), "n_2", "sb_1");
    expect(node(next, "n_2").sandboxId).toBe("sb_1");
    expect(binding(next, "n_2").uses.sandboxId).toBe("sb_1");
  });
});

describe("mapSecretSlot", () => {
  it("records the secret name in the binding slot", () => {
    const next = mapSecretSlot(planFixture(), "n_1", "GITHUB_TOKEN", "MY_GH_PAT");
    expect(binding(next, "n_1").uses.secrets).toEqual([{ slot: "GITHUB_TOKEN", secretName: "MY_GH_PAT" }]);
  });
  it("adds the slot if the binding had no secrets array", () => {
    const next = mapSecretSlot(planFixture(), "n_2", "NPM_TOKEN", "MY_NPM");
    expect(binding(next, "n_2").uses.secrets).toEqual([{ slot: "NPM_TOKEN", secretName: "MY_NPM" }]);
  });
});

describe("defaults", () => {
  it("sets default model and sandbox", () => {
    let p = setDefaultModel(planFixture(), "claude-opus-4-8");
    p = setDefaultSandbox(p, "sb_default");
    expect(p.defaults.model).toBe("claude-opus-4-8");
    expect(p.defaults.sandboxId).toBe("sb_default");
  });
});

describe("resolveGap", () => {
  it("removes the gap by id (unblocking Apply when it was required)", () => {
    const next = resolveGap(planFixture(), "g1");
    expect(next.gaps.map((g) => g.id)).toEqual(["g2"]);
  });
  it("is a no-op for an unknown id", () => {
    expect(resolveGap(planFixture(), "nope").gaps).toHaveLength(2);
  });
});
