import { describe, it, expect } from "vitest";
import { validateWorkflowInputs, type ValidationCatalog } from "./validate-workflow.ts";
import type { WorkflowGraph } from "../types/flow.types.ts";

const EMPTY_CATALOG: ValidationCatalog = {};

function flow(
  inputDefs: WorkflowGraph["inputDefs"],
  inputsMapping: Record<string, { fromPath: string; type: string }>,
  includeTrigger = true,
): WorkflowGraph {
  const nodes: WorkflowGraph["nodes"] = [
    { id: "start", type: "start", displayName: "Start", config: {}, position: { x: 0, y: 0 } },
    { id: "end", type: "end", displayName: "End", config: {}, position: { x: 200, y: 0 } },
  ] as unknown as WorkflowGraph["nodes"];
  if (includeTrigger) {
    nodes.push({
      id: "wh",
      type: "trigger-webhook",
      displayName: "Webhook",
      config: { webhookId: "w1", inputsMapping },
      position: { x: 100, y: 0 },
    } as unknown as WorkflowGraph["nodes"][number]);
  }
  return { schemaVersion: "v1", nodes, edges: [], inputDefs } as unknown as WorkflowGraph;
}

describe("validateWorkflowInputs — trigger-webhook input mapping", () => {
  it("warns when a required input has no mapping", () => {
    const w = validateWorkflowInputs(
      flow([{ name: "ticketId", type: "string", required: true }], {}),
      EMPTY_CATALOG,
    );
    const hit = w.filter((x) => x.code === "missing-required" && "nodeId" in x && x.nodeId === "wh");
    expect(hit).toHaveLength(1);
    const first = hit[0];
    expect("inputKey" in first && first.inputKey).toBe("ticketId");
  });

  it("warns when fromPath is whitespace-only", () => {
    const w = validateWorkflowInputs(
      flow([{ name: "ticketId", type: "string", required: true }], {
        ticketId: { fromPath: "   ", type: "string" },
      }),
      EMPTY_CATALOG,
    );
    expect(
      w.filter((x) => "nodeId" in x && x.nodeId === "wh" && "inputKey" in x && x.inputKey === "ticketId"),
    ).toHaveLength(1);
  });

  it("does not warn when a required input has a valid fromPath", () => {
    const w = validateWorkflowInputs(
      flow([{ name: "ticketId", type: "string", required: true }], {
        ticketId: { fromPath: "$.issue.key", type: "string" },
      }),
      EMPTY_CATALOG,
    );
    expect(w.filter((x) => "nodeId" in x && x.nodeId === "wh")).toHaveLength(0);
  });

  it("does not warn for optional inputs with no mapping", () => {
    const w = validateWorkflowInputs(
      flow([{ name: "note", type: "string", required: false }], {}),
      EMPTY_CATALOG,
    );
    expect(w.filter((x) => "nodeId" in x && x.nodeId === "wh")).toHaveLength(0);
  });

  it("emits nothing from this loop when there is no trigger-webhook node", () => {
    const w = validateWorkflowInputs(
      flow([{ name: "ticketId", type: "string", required: true }], {}, false),
      EMPTY_CATALOG,
    );
    expect(w.filter((x) => "nodeId" in x && x.nodeId === "wh")).toHaveLength(0);
  });
});
