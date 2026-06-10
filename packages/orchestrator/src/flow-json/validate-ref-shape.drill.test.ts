import { describe, it, expect } from "vitest";
import type { WorkflowGraph } from "@journeyman/core";
import { resolveRefShape, type CatalogShapeEntry } from "./validate-ref-shape.ts";

const flow: WorkflowGraph = {
  id: "f", name: "f", nodes: [
    { id: "trigger", type: "trigger-manual", config: {} } as any,
    { id: "list", type: "step", stepType: "listPRs", config: {} } as any,
  ],
  edges: [], inputDefs: [], attributeDefs: [],
} as any;

const catalog = new Map<string, CatalogShapeEntry>([
  ["listPRs", {
    stepType: "listPRs",
    inputFields: {},
    outputSchema: {
      pullRequests: { type: "array", items: { type: "object", fields: { title: { type: "string" } } } },
      blob: { type: "json", container: "object" },
    },
  }],
]);

describe("resolveRefShape — drilling", () => {
  it("indexes a typed array to its item field", () => {
    const r = resolveRefShape(flow, "list.output.pullRequests[0].title", catalog);
    expect(r.ok).toBe(true);
    expect(r.shape).toEqual({ type: "string" });
  });
  it("projects a typed array field with [*]", () => {
    const r = resolveRefShape(flow, "list.output.pullRequests[*].title", catalog);
    expect(r.ok).toBe(true);
    expect(r.shape).toEqual({ type: "array", items: { type: "string" } });
  });
  it("drills past opaque json and stays opaque", () => {
    const r = resolveRefShape(flow, "list.output.blob.a.b.c", catalog);
    expect(r.ok).toBe(true);
    expect(r.shape).toEqual({ type: "json", container: "object" });
  });
  it("rejects a malformed path", () => {
    const r = resolveRefShape(flow, "list.output.pullRequests[abc]", catalog);
    expect(r.ok).toBe(false);
  });
});
