import type {
  FlowGraph, FlowNode, IFlowJsonConverter,
} from "@journeyman/core";

export interface ConductorTaskDef {
  name: string;
  taskReferenceName: string;
  type: "SIMPLE";
  inputParameters: Record<string, unknown>;
}

export interface ConductorWorkflowDef {
  name: string;
  version: number;
  schemaVersion: 2;
  tasks: ConductorTaskDef[];
}

export class UnsupportedNodeTypeError extends Error {
  constructor(public readonly nodeType: string) {
    super(`Node type '${nodeType}' is not supported in Phase 1`);
    this.name = "UnsupportedNodeTypeError";
  }
}

export class ConductorJsonConverter implements IFlowJsonConverter<ConductorWorkflowDef> {
  toEngineJson(def: FlowGraph, opts: {
    workflowName: string;
    workflowVersion: number;
  }): ConductorWorkflowDef {
    // Phase 1 supports linear only: exactly one start, one end, each node has
    // at most one outgoing edge, and the path through `phase` nodes is unique.
    const nodesById = new Map(def.nodes.map(n => [n.id, n]));
    const outgoing = new Map<string, string[]>();
    for (const e of def.edges) {
      const arr = outgoing.get(e.source) ?? [];
      arr.push(e.target);
      outgoing.set(e.source, arr);
    }

    for (const n of def.nodes) {
      if (!["start", "end", "phase"].includes(n.type)) {
        throw new UnsupportedNodeTypeError(n.type);
      }
    }

    const starts = def.nodes.filter(n => n.type === "start");
    if (starts.length !== 1) throw new Error("Flow must have exactly one start node");
    const ends = def.nodes.filter(n => n.type === "end");
    if (ends.length !== 1) throw new Error("Phase 1 supports exactly one end node");

    const tasks: ConductorTaskDef[] = [];
    let current = starts[0].id;
    const visited = new Set<string>();
    while (true) {
      if (visited.has(current)) throw new Error("Cycles are not supported in Phase 1");
      visited.add(current);
      const next = outgoing.get(current) ?? [];
      if (next.length > 1) {
        throw new Error("Flow must be linear in Phase 1 (no branching)");
      }
      if (next.length === 0) break;
      const node = nodesById.get(next[0])!;
      if (node.type === "phase") {
        if (!node.phaseType) throw new Error(`Phase node '${node.id}' missing phaseType`);
        tasks.push(toSimpleTask(node));
      }
      current = node.id;
    }

    return {
      name: opts.workflowName,
      version: opts.workflowVersion,
      schemaVersion: 2,
      tasks,
    };
  }
}

function toSimpleTask(node: FlowNode): ConductorTaskDef {
  return {
    name: node.phaseType!,
    taskReferenceName: node.id,
    type: "SIMPLE",
    inputParameters: { ...(node.config ?? {}) },
  };
}
