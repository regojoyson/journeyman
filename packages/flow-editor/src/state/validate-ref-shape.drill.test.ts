import { describe, it, expect } from "vitest";
import type { WorkflowGraph } from "@journeyman/core";
import { validateRefShape } from "./validate-ref-shape.ts";
import type { StepCatalogEntry } from "../catalogs/use-step-catalog.ts";

const flow: WorkflowGraph = {
  id: "f", name: "f",
  nodes: [{ id: "list", type: "step", stepType: "listPRs", config: {} } as any],
  edges: [], inputDefs: [], attributeDefs: [],
} as any;

const catalog: Record<string, StepCatalogEntry> = {
  listPRs: {
    inputFields: {},
    outputSchema: { pullRequests: { type: "array", items: { type: "object", fields: { title: { type: "string" } } } } },
  } as any,
};

describe("validateRefShape — drilling", () => {
  it("accepts [0].title against a string target", () => {
    const r = validateRefShape(flow, "list.output.pullRequests[0].title", { type: "string" }, catalog);
    expect(r.ok).toBe(true);
  });
  it("accepts [*].title against a string[] target", () => {
    const r = validateRefShape(flow, "list.output.pullRequests[*].title", { type: "array", items: { type: "string" } }, catalog);
    expect(r.ok).toBe(true);
  });
});
