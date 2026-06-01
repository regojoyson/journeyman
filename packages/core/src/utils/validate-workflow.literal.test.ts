import { describe, it, expect } from "vitest";
import { literalMatchesShape, validateWorkflowInputs, type ValidationCatalog } from "./validate-workflow.ts";
import type { WorkflowGraph, WorkflowInputValue } from "../types/flow.types.ts";

describe("literalMatchesShape", () => {
  it("matches primitives", () => {
    expect(literalMatchesShape("x", { type: "string" })).toBe(true);
    expect(literalMatchesShape(1, { type: "string" })).toBe(false);
    expect(literalMatchesShape(1, { type: "number" })).toBe(true);
    expect(literalMatchesShape("1", { type: "number" })).toBe(false);
    expect(literalMatchesShape(true, { type: "boolean" })).toBe(true);
    expect(literalMatchesShape("true", { type: "boolean" })).toBe(false);
  });
  it("matches json containers", () => {
    expect(literalMatchesShape({ a: 1 }, { type: "json", container: "object" })).toBe(true);
    expect(literalMatchesShape([1], { type: "json", container: "object" })).toBe(false);
    expect(literalMatchesShape([1], { type: "json", container: "array" })).toBe(true);
    expect(literalMatchesShape({ a: 1 }, { type: "json", container: "array" })).toBe(false);
    expect(literalMatchesShape(null, { type: "json", container: "object" })).toBe(false);
  });
  it("is permissive for unresolved ref shapes", () => {
    expect(literalMatchesShape(123, { type: "ref", name: "Whatever" })).toBe(true);
  });
});

function flowWithLiteral(value: WorkflowInputValue): WorkflowGraph {
  return {
    schemaVersion: "v1",
    nodes: [
      { id: "start", type: "start", displayName: "Start", config: {}, position: { x: 0, y: 0 } },
      {
        id: "n1", type: "step", stepType: "demo", displayName: "Demo",
        config: {}, inputs: { count: value }, position: { x: 100, y: 0 },
      },
      { id: "end", type: "end", displayName: "End", config: {}, position: { x: 200, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "n1", type: "default" },
      { id: "e2", source: "n1", target: "end", type: "default" },
    ],
  } as unknown as WorkflowGraph;
}

const catalog: ValidationCatalog = {
  demo: { inputFields: { count: { shape: { type: "number" }, required: true } }, outputSchema: null },
};

describe("validateWorkflowInputs literal type-checking", () => {
  it("accepts a literal of the right type", () => {
    const w = validateWorkflowInputs(flowWithLiteral({ kind: "literal", value: 5 }), catalog);
    expect(w.filter(x => x.code === "shape-mismatch")).toHaveLength(0);
  });
  it("flags a literal of the wrong type", () => {
    const w = validateWorkflowInputs(flowWithLiteral({ kind: "literal", value: "five" }), catalog);
    const mismatch = w.find(x => x.code === "shape-mismatch" && x.inputKey === "count");
    expect(mismatch).toBeTruthy();
  });
});
