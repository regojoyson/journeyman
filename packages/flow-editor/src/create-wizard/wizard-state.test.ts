import { describe, it, expect } from "vitest";
import {
  seedDefaults,
  createDraft,
  draftFromGraph,
  stepsForMode,
  canAdvance,
  inputNameWarnings,
  buildCreateArgs,
} from "./wizard-state.ts";
import type { WorkflowGraph } from "@journeyman/core";

describe("seedDefaults", () => {
  it("seeds a coding-cli claude provider and an enabled retry policy", () => {
    const d = seedDefaults();
    expect(d.executorConfig?.["coding-cli"]?.provider).toBe("claude");
    expect(d.retry?.enabled).toBe(true);
    expect(d.retry?.maxAttempts).toBe(2);
  });
});

describe("createDraft", () => {
  it("starts from a blank graph (start + end) with seeded defaults and default meta", () => {
    const draft = createDraft();
    expect(draft.meta).toEqual({ name: "New flow", description: "" });
    expect(draft.graph.nodes.map(n => n.type).sort()).toEqual(["end", "trigger-manual"]);
    expect(draft.graph.defaults?.executorConfig?.["coding-cli"]?.provider).toBe("claude");
  });
});

describe("draftFromGraph", () => {
  it("deep-copies the graph so edits to the draft do not mutate the source", () => {
    const source: WorkflowGraph = {
      schemaVersion: 2,
      nodes: [{ id: "start", type: "trigger-manual" }, { id: "end", type: "end" }],
      edges: [],
      inputDefs: [{ name: "a", type: "string", required: true }],
    } as unknown as WorkflowGraph;
    const draft = draftFromGraph(source, { name: "Existing", description: "" });
    draft.graph.inputDefs!.push({ name: "b", type: "string" });
    expect(source.inputDefs).toHaveLength(1);
    expect(draft.meta.name).toBe("Existing");
  });
});

describe("stepsForMode", () => {
  it("includes basics first in create mode and omits it in edit mode", () => {
    expect(stepsForMode("create")).toEqual(["basics", "config", "inputs", "review"]);
    expect(stepsForMode("edit")).toEqual(["config", "inputs", "review"]);
  });
});

describe("canAdvance", () => {
  it("blocks the basics step until a non-empty name is present", () => {
    const draft = createDraft();
    draft.meta.name = "   ";
    expect(canAdvance("basics", draft)).toBe(false);
    draft.meta.name = "My flow";
    expect(canAdvance("basics", draft)).toBe(true);
  });
  it("never blocks config, inputs, or review", () => {
    const draft = createDraft();
    expect(canAdvance("config", draft)).toBe(true);
    expect(canAdvance("inputs", draft)).toBe(true);
    expect(canAdvance("review", draft)).toBe(true);
  });
});

describe("inputNameWarnings", () => {
  it("warns on empty and duplicate input names", () => {
    const graph = {
      schemaVersion: 2, nodes: [], edges: [],
      inputDefs: [
        { name: "ok", type: "string" },
        { name: "", type: "string" },
        { name: "ok", type: "string" },
      ],
    } as unknown as WorkflowGraph;
    const w = inputNameWarnings(graph);
    expect(w.some(m => m.includes("no name"))).toBe(true);
    expect(w.some(m => m.includes('Duplicate input name "ok"'))).toBe(true);
  });
  it("returns no warnings for a clean or empty input list", () => {
    expect(inputNameWarnings({ schemaVersion: 2, nodes: [], edges: [] } as unknown as WorkflowGraph)).toEqual([]);
  });
});

describe("buildCreateArgs", () => {
  it("trims the name and omits an empty description", () => {
    const draft = createDraft();
    draft.meta.name = "  Ship it  ";
    draft.meta.description = "   ";
    const args = buildCreateArgs(draft);
    expect(args.name).toBe("Ship it");
    expect(args.description).toBeUndefined();
    expect(args.definition).toBe(draft.graph);
  });
});
