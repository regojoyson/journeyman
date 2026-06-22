import { describe, it, expect } from "vitest";
import type { WorkflowGraph } from "@journeyman/core";
import type { ResolvedNodeStatus } from "../types.ts";
import { buildRfGraph, emptyGraphCache, type BuildRfGraphArgs } from "./build-rf-graph.ts";

const KNOWN = new Set(["step", "if"]);

function graph(): WorkflowGraph {
  return {
    nodes: [
      { id: "a", type: "step", stepType: "getIssue", displayName: "Get", position: { x: 0, y: 0 } },
      { id: "b", type: "step", stepType: "custom-ai", displayName: "AI", position: { x: 320, y: 0 } },
    ],
    edges: [{ id: "a-b", source: "a", target: "b" }],
  } as unknown as WorkflowGraph;
}

/** Fresh Map of fresh status objects — mirrors computeNodeStatuses() each tick. */
function statuses(map: Record<string, ResolvedNodeStatus["status"]>): Map<string, ResolvedNodeStatus> {
  const out = new Map<string, ResolvedNodeStatus>();
  for (const [id, status] of Object.entries(map)) {
    out.set(id, { status, attempt: 1, visitCount: 1 });
  }
  return out;
}

function args(
  workflow: WorkflowGraph,
  st: Map<string, ResolvedNodeStatus>,
  selectedNodeId: string | null = null,
): BuildRfGraphArgs {
  return {
    workflow,
    statuses: st,
    selectedNodeId,
    fallbackPos: null,
    knownNodeTypes: KNOWN,
    // running source ⇒ animated; mirrors the real isAnimatedEdge well enough for identity tests.
    isAnimatedEdge: (e, s) => s.get(e.source)?.status === "running",
  };
}

describe("buildRfGraph identity preservation", () => {
  it("reuses node + edge objects when nothing render-relevant changed (the step.log burst case)", () => {
    const wf = graph();
    const cache = emptyGraphCache();

    const first = buildRfGraph(args(wf, statuses({ a: "running", b: "pending" })), cache);
    // A step.log event arrives: brand-new statuses Map, brand-new status objects, identical values.
    const second = buildRfGraph(args(wf, statuses({ a: "running", b: "pending" })), cache);

    // Every node/edge object reference must survive — otherwise ReactFlow drops
    // measured dimensions and the canvas flickers blank under log bursts.
    expect(second.nodes[0]).toBe(first.nodes[0]);
    expect(second.nodes[1]).toBe(first.nodes[1]);
    expect(second.edges[0]).toBe(first.edges[0]);
  });

  it("rebuilds only the node whose status actually changed", () => {
    const wf = graph();
    const cache = emptyGraphCache();

    const first = buildRfGraph(args(wf, statuses({ a: "running", b: "pending" })), cache);
    // a completes, b starts running.
    const second = buildRfGraph(args(wf, statuses({ a: "completed", b: "running" })), cache);

    expect(second.nodes[0]).not.toBe(first.nodes[0]); // a changed running→completed
    expect(second.nodes[1]).not.toBe(first.nodes[1]); // b changed pending→running
    expect((second.nodes[0].data as { runStatus?: ResolvedNodeStatus }).runStatus?.status).toBe("completed");
  });

  it("keeps an unchanged node stable while a sibling changes", () => {
    const wf = graph();
    const cache = emptyGraphCache();

    const first = buildRfGraph(args(wf, statuses({ a: "completed", b: "running" })), cache);
    const second = buildRfGraph(args(wf, statuses({ a: "completed", b: "completed" })), cache);

    expect(second.nodes[0]).toBe(first.nodes[0]);     // a unchanged → identity kept
    expect(second.nodes[1]).not.toBe(first.nodes[1]); // b running→completed → rebuilt
    // edge animated flips (b no longer running, but source is a/completed) — recompute as needed.
    expect(second.edges[0].animated).toBe(false);
  });

  it("rebuilds a node when its selection changes", () => {
    const wf = graph();
    const cache = emptyGraphCache();

    const first = buildRfGraph(args(wf, statuses({ a: "running", b: "pending" }), null), cache);
    const second = buildRfGraph(args(wf, statuses({ a: "running", b: "pending" }), "a"), cache);

    expect(second.nodes[0]).not.toBe(first.nodes[0]); // a became selected
    expect(second.nodes[0].selected).toBe(true);
    expect(second.nodes[1]).toBe(first.nodes[1]);     // b untouched
  });
});
