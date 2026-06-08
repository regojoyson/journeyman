import { describe, it, expect } from "vitest";
import { computeValidationReport } from "./flows.ts";
import type { WorkflowGraph } from "@journeyman/core";

function flow(
  inputsMapping: Record<string, { fromPath: string; type: string }>,
  required = true,
): WorkflowGraph {
  return {
    schemaVersion: "v1",
    nodes: [
      {
        id: "wh",
        type: "trigger-webhook",
        displayName: "Webhook",
        config: { webhookId: "w1", inputsMapping },
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
    inputDefs: [{ name: "ticketId", type: "string", required }],
  } as unknown as WorkflowGraph;
}

describe("computeValidationReport — webhook required input mapping", () => {
  it("pushes to missing[] and sets ok=false when a required input is unmapped", () => {
    const r = computeValidationReport(flow({}));
    expect(r.missing.some((m) => m.includes("ticketId"))).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("ignores whitespace-only fromPath (still missing)", () => {
    const r = computeValidationReport(flow({ ticketId: { fromPath: "  ", type: "string" } }));
    expect(r.missing.some((m) => m.includes("ticketId"))).toBe(true);
  });

  it("does not flag a fully mapped required input", () => {
    const r = computeValidationReport(flow({ ticketId: { fromPath: "$.issue.key", type: "string" } }));
    expect(r.missing.some((m) => m.includes("ticketId"))).toBe(false);
  });

  it("does not flag optional inputs", () => {
    const r = computeValidationReport(flow({}, false));
    expect(r.missing.some((m) => m.includes("ticketId"))).toBe(false);
  });
});
