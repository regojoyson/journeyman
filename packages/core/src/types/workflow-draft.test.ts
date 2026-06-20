import { describe, it, expect } from "vitest";
import { graphsEqual, hasUnpublishedChanges } from "./workflow-draft.ts";
import type { WorkflowGraph } from "./flow.types.ts";

const base: WorkflowGraph = {
  schemaVersion: 2,
  nodes: [{ id: "a", type: "step", stepType: "clone-repos" }],
  edges: [],
};

describe("graphsEqual", () => {
  it("treats identical graphs as equal regardless of key order", () => {
    const reordered: WorkflowGraph = {
      nodes: [{ stepType: "clone-repos", type: "step", id: "a" }],
      edges: [],
      schemaVersion: 2,
    };
    expect(graphsEqual(base, reordered)).toBe(true);
  });

  it("detects a changed node", () => {
    const changed: WorkflowGraph = { ...base, nodes: [{ id: "a", type: "step", stepType: "send-message" }] };
    expect(graphsEqual(base, changed)).toBe(false);
  });
});

describe("hasUnpublishedChanges", () => {
  it("is true when there is no published version", () => {
    expect(hasUnpublishedChanges(base, null)).toBe(true);
  });

  it("is false when draft equals published", () => {
    expect(hasUnpublishedChanges(base, { ...base })).toBe(false);
  });

  it("is true when draft differs from published", () => {
    const published: WorkflowGraph = { ...base, edges: [{ id: "e1", source: "a", target: "a" }] };
    expect(hasUnpublishedChanges(base, published)).toBe(true);
  });
});
