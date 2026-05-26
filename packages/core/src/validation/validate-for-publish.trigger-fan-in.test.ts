import { describe, it, expect } from "vitest";
import { validateForPublish, type PublishValidationContext } from "./validate-for-publish.ts";
import type { WorkflowGraph } from "../types/flow.types.ts";

const ctx: PublishValidationContext = {
  hasTrigger: true,
  visibleSecretNames: new Set(),
  visibleMcpInstanceIds: new Set(),
  visibleSkillIds: new Set(),
};

/** Helper: build a graph with the given nodes/edges and v2 schema. */
function graph(nodes: WorkflowGraph["nodes"], edges: WorkflowGraph["edges"]): WorkflowGraph {
  return {
    schemaVersion: 2,
    inputs: [],
    nodes,
    edges,
  } as unknown as WorkflowGraph;
}

/** Trigger node factory. */
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

/** Pick out the "has N incoming arrows" errors, which is what this rule emits. */
function fanInErrors(flow: WorkflowGraph) {
  const result = validateForPublish(flow, ctx);
  return result.errors.filter(e => e.message.includes("incoming arrows"));
}

describe("validateForPublish — trigger fan-in", () => {
  it("allows two triggers (manual + webhook) into one step", () => {
    const flow = graph(
      [
        trigger("t-manual", "trigger-manual"),
        trigger("t-webhook", "trigger-webhook"),
        step("get-ticket", "get-ticket"),
        endNode(),
      ],
      [
        edge("e1", "t-manual", "get-ticket"),
        edge("e2", "t-webhook", "get-ticket"),
        edge("e3", "get-ticket", "end"),
      ],
    );
    expect(fanInErrors(flow)).toEqual([]);
  });

  it("allows three triggers (manual + webhook + human) into one step", () => {
    const flow = graph(
      [
        trigger("t-manual", "trigger-manual"),
        trigger("t-webhook", "trigger-webhook"),
        trigger("t-human", "trigger-human"),
        step("get-ticket", "get-ticket"),
        endNode(),
      ],
      [
        edge("e1", "t-manual", "get-ticket"),
        edge("e2", "t-webhook", "get-ticket"),
        edge("e3", "t-human", "get-ticket"),
        edge("e4", "get-ticket", "end"),
      ],
    );
    expect(fanInErrors(flow)).toEqual([]);
  });

  it("rejects mixed fan-in (trigger + regular step into same target)", () => {
    const flow = graph(
      [
        trigger("t-manual", "trigger-manual"),
        step("first", "noop"),
        step("target", "get-ticket"),
        endNode(),
      ],
      [
        edge("e1", "t-manual", "first"),
        edge("e2", "first", "target"),
        edge("e3", "t-manual", "target"), // mixed: trigger + step both point at target
        edge("e4", "target", "end"),
      ],
    );
    const errs = fanInErrors(flow);
    expect(errs).toHaveLength(1);
    expect(errs[0].nodeId).toBe("target");
    expect(errs[0].message).toContain("Join");
  });

  it("still rejects two regular steps fanning into the same target (no regression)", () => {
    const flow = graph(
      [
        trigger("t-manual", "trigger-manual"),
        step("a", "noop"),
        step("b", "noop"),
        step("target", "get-ticket"),
        endNode(),
      ],
      [
        edge("e1", "t-manual", "a"),
        edge("e2", "t-manual", "b"),
        edge("e3", "a", "target"),
        edge("e4", "b", "target"),
        edge("e5", "target", "end"),
      ],
    );
    const errs = fanInErrors(flow);
    expect(errs).toHaveLength(1);
    expect(errs[0].nodeId).toBe("target");
  });

  it("allows a single trigger → single step (existing behavior unchanged)", () => {
    const flow = graph(
      [
        trigger("t-manual", "trigger-manual"),
        step("get-ticket", "get-ticket"),
        endNode(),
      ],
      [
        edge("e1", "t-manual", "get-ticket"),
        edge("e2", "get-ticket", "end"),
      ],
    );
    expect(fanInErrors(flow)).toEqual([]);
  });
});
