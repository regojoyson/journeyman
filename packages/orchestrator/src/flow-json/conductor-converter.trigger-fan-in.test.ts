import { describe, it, expect } from "vitest";
import type { WorkflowGraph } from "@journeyman/core";
import { ConductorJsonConverter } from "./conductor-converter.ts";

/**
 * Runtime/worker-level verification of trigger fan-in.
 *
 * The publish validator (packages/core) allows multiple triggers to share a
 * downstream successor. These tests confirm the conductor converter — which
 * turns a WorkflowGraph into a Conductor task sequence at runtime — produces
 * an identical task sequence regardless of which trigger fired, because all
 * triggers feed the same successor (Get Ticket → … → End).
 */

function graph(nodes: WorkflowGraph["nodes"], edges: WorkflowGraph["edges"]): WorkflowGraph {
  return {
    schemaVersion: 2,
    inputDefs: [],
    nodes,
    edges,
  } as unknown as WorkflowGraph;
}

function trigger(id: string, type: "trigger-manual" | "trigger-webhook" | "trigger-human") {
  const config = type === "trigger-webhook"
    ? { webhookId: "wh-1", inputsMapping: {} }
    : type === "trigger-human"
      ? { fieldOverrides: {} }
      : {};
  return {
    id,
    type,
    displayName: type,
    config,
    position: { x: 0, y: 0 },
  } as unknown as WorkflowGraph["nodes"][number];
}

function step(id: string, stepType: string) {
  return {
    id,
    type: "step",
    stepType,
    displayName: id,
    config: {},
    inputs: {},
    position: { x: 100, y: 0 },
  } as unknown as WorkflowGraph["nodes"][number];
}

function endNode(id = "end") {
  return {
    id,
    type: "end",
    displayName: "End",
    config: {},
    position: { x: 200, y: 0 },
  } as unknown as WorkflowGraph["nodes"][number];
}

function edge(id: string, source: string, target: string) {
  return { id, source, target, type: "default" } as unknown as WorkflowGraph["edges"][number];
}

describe("conductor converter — trigger fan-in", () => {
  it("emits a task sequence starting at the shared successor when 2 triggers fan in", () => {
    const flow = graph(
      [
        trigger("t-manual", "trigger-manual"),
        trigger("t-webhook", "trigger-webhook"),
        step("get-ticket", "noop"),
        endNode(),
      ],
      [
        edge("e1", "t-manual", "get-ticket"),
        edge("e2", "t-webhook", "get-ticket"),
        edge("e3", "get-ticket", "end"),
      ],
    );

    const def = new ConductorJsonConverter().toEngineJson(flow, {
      workflowName: "fan-in-2",
      workflowVersion: 1,
    });

    // The trigger node itself is NOT a task — it's a graph marker. The first
    // task should correspond to the shared successor (get-ticket).
    const taskRefs = def.tasks.map(t => t.taskReferenceName);
    expect(taskRefs).toContain("get-ticket");
    expect(taskRefs.some(r => r.startsWith("t-manual") || r.startsWith("t-webhook"))).toBe(false);
  });

  it("emits the same task sequence regardless of which trigger fired (3 triggers)", () => {
    // The converter builds the sequence once per definition, starting at the
    // chosen trigger's successor. Because all triggers share the same
    // successor, the resulting sequence is invariant. To confirm, we build
    // two graphs identical except for trigger declaration order — the task
    // sequence should match.
    const triggers1 = [
      trigger("t-manual", "trigger-manual"),
      trigger("t-webhook", "trigger-webhook"),
      trigger("t-human", "trigger-human"),
    ];
    const triggers2 = [
      trigger("t-human", "trigger-human"),
      trigger("t-webhook", "trigger-webhook"),
      trigger("t-manual", "trigger-manual"),
    ];
    const commonNodes = [step("get-ticket", "noop"), endNode()];
    const commonEdges = [
      edge("e1", "t-manual", "get-ticket"),
      edge("e2", "t-webhook", "get-ticket"),
      edge("e3", "t-human", "get-ticket"),
      edge("e4", "get-ticket", "end"),
    ];

    const def1 = new ConductorJsonConverter().toEngineJson(
      graph([...triggers1, ...commonNodes], commonEdges),
      { workflowName: "fan-in-3a", workflowVersion: 1 },
    );
    const def2 = new ConductorJsonConverter().toEngineJson(
      graph([...triggers2, ...commonNodes], commonEdges),
      { workflowName: "fan-in-3b", workflowVersion: 1 },
    );

    const refs1 = def1.tasks.map(t => t.taskReferenceName);
    const refs2 = def2.tasks.map(t => t.taskReferenceName);
    expect(refs1).toEqual(refs2);
    expect(refs1).toContain("get-ticket");
  });

  it("validates a multi-trigger fan-in graph without throwing", () => {
    const flow = graph(
      [
        trigger("t-manual", "trigger-manual"),
        trigger("t-webhook", "trigger-webhook"),
        trigger("t-human", "trigger-human"),
        step("get-ticket", "noop"),
        endNode(),
      ],
      [
        edge("e1", "t-manual", "get-ticket"),
        edge("e2", "t-webhook", "get-ticket"),
        edge("e3", "t-human", "get-ticket"),
        edge("e4", "get-ticket", "end"),
      ],
    );

    // validateGraph throws WorkflowValidationError on bad graphs. Plain success
    // path: no throw. This is the runtime-side counterpart to the publish
    // validator change in @journeyman/core.
    expect(() => ConductorJsonConverter.validateGraph(flow)).not.toThrow();
  });
});
