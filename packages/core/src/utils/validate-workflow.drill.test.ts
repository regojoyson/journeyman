import { describe, it, expect } from "vitest";
import { validateWorkflowInputs, type ValidationCatalog } from "./validate-workflow.ts";
import type { WorkflowGraph, WorkflowInputValue } from "../types/flow.types.ts";

function flowWithConsumerRef(ref: string): WorkflowGraph {
  const value: WorkflowInputValue = { kind: "ref", ref };
  return {
    schemaVersion: "v1",
    nodes: [
      { id: "start", type: "start", displayName: "Start", config: {}, position: { x: 0, y: 0 } },
      { id: "prod", type: "step", stepType: "lister", displayName: "Lister", config: {}, position: { x: 100, y: 0 } },
      {
        id: "cons", type: "step", stepType: "consumer", displayName: "Consumer",
        config: {}, inputs: { titles: value }, position: { x: 200, y: 0 },
      },
      { id: "end", type: "end", displayName: "End", config: {}, position: { x: 300, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "prod", type: "default" },
      { id: "e2", source: "prod", target: "cons", type: "default" },
      { id: "e3", source: "cons", target: "end", type: "default" },
    ],
  } as unknown as WorkflowGraph;
}

const catalog: ValidationCatalog = {
  lister: {
    inputFields: {},
    outputSchema: { pullRequests: { type: "array", items: { type: "object", fields: { title: { type: "string" } } } } },
  },
  consumer: {
    inputFields: { titles: { shape: { type: "array", items: { type: "string" } } } },
    outputSchema: null,
  },
};

describe("validate-workflow — drilled array ref", () => {
  it("does not warn for items[*].title bound to a string[] input", () => {
    const w = validateWorkflowInputs(flowWithConsumerRef("prod.output.pullRequests[*].title"), catalog);
    expect(w.find(x => x.code === "dangling-ref-path" && x.inputKey === "titles")).toBeUndefined();
    expect(w.find(x => x.code === "shape-mismatch" && x.inputKey === "titles")).toBeUndefined();
  });
  it("warns dangling-ref-path for a malformed drilled path", () => {
    const w = validateWorkflowInputs(flowWithConsumerRef("prod.output.pullRequests[abc].title"), catalog);
    expect(w.find(x => x.code === "dangling-ref-path" && x.inputKey === "titles")).toBeTruthy();
  });
});
