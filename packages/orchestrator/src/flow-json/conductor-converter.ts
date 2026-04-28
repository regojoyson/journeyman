import type { FlowEdge, FlowGraph, FlowNode, IFlowJsonConverter } from "@journeyman/core";
import type {
  ConductorTaskDef, ConductorWorkflowDef,
  ForkJoinTask, JoinTask, SwitchTask, DoWhileTask, WaitTask,
  SubWorkflowTask, TerminateTask, SimpleTask,
} from "./conductor-types.ts";
import { resolveInputs, parseRef } from "./resolve-inputs.ts";
import { dominators } from "./reachability.ts";

export class UnsupportedNodeTypeError extends Error {
  constructor(public readonly nodeType: string) {
    super(`Node type '${nodeType}' is not yet supported`);
    this.name = "UnsupportedNodeTypeError";
  }
}

export class FlowValidationError extends Error {
  constructor(message: string) { super(message); this.name = "FlowValidationError"; }
}

export class ConductorJsonConverter implements IFlowJsonConverter<ConductorWorkflowDef> {
  static validateGraph(graph: FlowGraph): void {
    new ConvertCtx(graph).validate();
  }

  toEngineJson(def: FlowGraph, opts: {
    workflowName: string;
    workflowVersion: number;
  }): ConductorWorkflowDef {
    const ctx = new ConvertCtx(def);
    ctx.validate();

    const start = ctx.startNode();
    const tasks = ctx.buildSequence(ctx.successor(start.id));
    const flowRetry = (start.config as { flowRetry?: { maxAttempts?: number; backoffSeconds?: number } } | undefined)?.flowRetry;

    return {
      name: opts.workflowName,
      version: opts.workflowVersion,
      schemaVersion: 2,
      tasks,
      cycleVisitLimit: def.maxCycleVisits ?? 100,
      ...(flowRetry ? { flowRetry } : {}),
    };
  }
}

class ConvertCtx {
  readonly nodes: Map<string, FlowNode>;
  readonly outgoing: Map<string, FlowEdge[]>;
  emitted = new Set<string>();

  constructor(public flow: FlowGraph) {
    this.nodes = new Map(flow.nodes.map(n => [n.id, n]));
    this.outgoing = new Map();
    for (const e of flow.edges) {
      const arr = this.outgoing.get(e.source) ?? [];
      arr.push(e);
      this.outgoing.set(e.source, arr);
    }
  }

  validate(): void {
    const starts = this.flow.nodes.filter(n => n.type === "start");
    if (starts.length !== 1) throw new FlowValidationError("Flow must have exactly one start node");
    const ends = this.flow.nodes.filter(n => n.type === "end");
    if (ends.length === 0) throw new FlowValidationError("Flow must have at least one end node");

    const nodeIds = new Set(this.flow.nodes.map(n => n.id));
    const startNode = this.flow.nodes.find(n => n.type === "start");
    const runInputDefs = ((startNode?.config as { runInputs?: Array<{ name: string }> } | undefined)?.runInputs ?? []);
    const runInputNames = new Set(runInputDefs.map(d => d.name));

    for (const node of this.flow.nodes) {
      for (const [field, val] of Object.entries(node.inputs ?? {})) {
        if (val.kind !== "ref") continue;
        const parsed = parseRef(val.ref);
        if (!parsed) {
          throw new FlowValidationError(`Node '${node.id}' input '${field}' has unparseable ref '${val.ref}'`);
        }
        if (parsed.source === "workflow.input") {
          if (!runInputNames.has(parsed.field)) {
            throw new FlowValidationError(`Node '${node.id}' references undeclared run input '${parsed.field}'`);
          }
          continue;
        }
        if (!nodeIds.has(parsed.source)) {
          throw new FlowValidationError(`Node '${node.id}' references missing node '${parsed.source}'`);
        }
        const doms = dominators(this.flow, node.id);
        if (!doms.has(parsed.source)) {
          throw new FlowValidationError(
            `Node '${node.id}' references '${parsed.source}' which does not execute on every path to '${node.id}'`
          );
        }
      }
    }
  }

  startNode(): FlowNode { return this.flow.nodes.find(n => n.type === "start")!; }

  successor(nodeId: string): string | null {
    const out = this.outgoing.get(nodeId) ?? [];
    return out[0]?.target ?? null;
  }

  outsOf(nodeId: string): FlowEdge[] { return this.outgoing.get(nodeId) ?? []; }

  buildSequence(startId: string | null, stopAt?: Set<string>): ConductorTaskDef[] {
    const tasks: ConductorTaskDef[] = [];
    let cur = startId;
    while (cur) {
      if (stopAt?.has(cur)) break;
      if (this.emitted.has(cur)) break;
      this.emitted.add(cur);
      const node = this.nodes.get(cur);
      if (!node) break;

      if (node.type === "end") {
        tasks.push(this.terminateTask(node));
        break;
      }

      const emitted = this.emitNode(node);
      tasks.push(...emitted.tasks);
      cur = emitted.nextNodeId;
    }
    return tasks;
  }

  emitNode(node: FlowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    switch (node.type) {
      case "phase":        return this.emitPhase(node);
      case "gateway-xor":
      case "if":           return this.emitSwitch(node);
      case "gateway-and":  return this.emitForkJoin(node);
      case "loop":         return this.emitDoWhile(node);
      case "timer":        return this.emitWait(node);
      case "subflow":      return this.emitSubflow(node);
      case "retry-block":
      case "try-catch":
      case "human-task":   throw new UnsupportedNodeTypeError(node.type);
      default:             throw new UnsupportedNodeTypeError(node.type);
    }
  }

  emitPhase(node: FlowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    if (!node.phaseType) throw new FlowValidationError(`Phase node '${node.id}' missing phaseType`);
    const r = node.retry ?? {};
    const enabled = r.enabled === true;

    const task: SimpleTask = {
      type: "SIMPLE",
      name: node.phaseType,
      taskReferenceName: node.id,
      inputParameters: (() => {
        const creds: Record<string, string> = {
          ...((node.config as { credentials?: Record<string, string> } | undefined)?.credentials ?? {}),
        };
        for (const name of node.requiredSecrets ?? []) {
          creds[name] = `env:${name}`;
        }
        return {
          ...(node.config ?? {}),
          ...resolveInputs(node.inputs),
          retry: node.retry ?? {},
          credentials: creds,
        };
      })(),
      retryCount: enabled ? (r.maxAttempts ?? 3) : 0,
      retryLogic: enabled ? mapBackoff(r.backoff ?? "exponential") : "FIXED",
      retryDelaySeconds: enabled ? (r.backoffSeconds ?? 5) : 0,
      backoffScaleFactor: enabled ? (r.backoffMultiplier ?? 2) : 1,
      timeoutSeconds: r.timeoutSeconds ?? 600,
      responseTimeoutSeconds: r.timeoutSeconds ?? 600,
    };
    return { tasks: [task], nextNodeId: this.successor(node.id) };
  }

  emitSwitch(node: FlowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    const outs = this.outsOf(node.id);
    if (outs.length === 0) {
      throw new FlowValidationError(`Switch '${node.id}' has no outgoing edges`);
    }
    const cases: Record<string, ConductorTaskDef[]> = {};
    let defaultCase: ConductorTaskDef[] | undefined;

    const branchTargets = outs.map(e => e.target);
    const convergence = findConvergence(branchTargets, this);
    const stopAt = convergence ? new Set([convergence]) : undefined;

    for (const e of outs) {
      const branchTasks = this.buildSequence(e.target, stopAt);
      if (e.type === "else" || e.branchLabel === "default") {
        defaultCase = branchTasks;
      } else {
        const label = e.branchLabel
          ?? (e.type === "conditional" ? jsonLogicToString(e.condition) : `case_${Object.keys(cases).length + 1}`);
        cases[label] = branchTasks;
      }
    }

    const task: SwitchTask = {
      type: "SWITCH",
      name: `switch_${node.id}`,
      taskReferenceName: node.id,
      evaluatorType: "value-param",
      expression: "branch",
      inputParameters: { branch: "${workflow.input.branch}" },
      decisionCases: cases,
      ...(defaultCase ? { defaultCase } : {}),
    };
    return { tasks: [task], nextNodeId: convergence };
  }

  emitForkJoin(node: FlowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    const outs = this.outsOf(node.id);
    if (outs.length < 2) {
      throw new FlowValidationError(`gateway-and '${node.id}' must have at least 2 outgoing edges`);
    }
    const branchTargets = outs.map(e => e.target);
    const convergence = findConvergence(branchTargets, this);
    if (!convergence) {
      throw new FlowValidationError(`gateway-and '${node.id}' branches must converge on a single join node`);
    }
    const stopAt = new Set([convergence]);

    const forkTasks: ConductorTaskDef[][] = outs.map(e => this.buildSequence(e.target, stopAt));

    const fork: ForkJoinTask = {
      type: "FORK_JOIN",
      name: `fork_${node.id}`,
      taskReferenceName: node.id,
      forkTasks,
    };
    const join: JoinTask = {
      type: "JOIN",
      name: `join_${node.id}`,
      taskReferenceName: `${node.id}_join`,
      joinOn: forkTasks
        .map(branch => branch.at(-1)?.taskReferenceName)
        .filter((x): x is string => !!x),
    };
    return { tasks: [fork, join], nextNodeId: convergence };
  }

  emitDoWhile(node: FlowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    const outs = this.outsOf(node.id);
    if (outs.length === 0) throw new FlowValidationError(`Loop '${node.id}' has no body edge`);
    const bodyHead = outs[0].target;
    const stopAt = new Set([node.id]);

    const savedEmitted = new Set(this.emitted);
    const body = this.buildSequence(bodyHead, stopAt);
    this.emitted = savedEmitted;
    this.emitted.add(node.id);

    const condition = (node.config?.["loopCondition"] as string | undefined)
      ?? `$.${node.id}["iteration"] < ${(node.config?.["maxIterations"] as number | undefined) ?? 5}`;

    const task: DoWhileTask = {
      type: "DO_WHILE",
      name: `loop_${node.id}`,
      taskReferenceName: node.id,
      loopCondition: condition,
      loopOver: body,
      inputParameters: { ...(node.config ?? {}), ...resolveInputs(node.inputs) },
    };

    const exit = outs[1]?.target ?? null;
    return { tasks: [task], nextNodeId: exit };
  }

  emitWait(node: FlowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    const cfg = (node.config ?? {}) as { duration?: string; until?: string };
    const task: WaitTask = {
      type: "WAIT",
      name: `wait_${node.id}`,
      taskReferenceName: node.id,
      inputParameters: cfg,
    };
    return { tasks: [task], nextNodeId: this.successor(node.id) };
  }

  emitSubflow(node: FlowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    const target = (node.config ?? {}) as { workflowName?: string; workflowVersion?: number };
    if (!target.workflowName) {
      throw new FlowValidationError(`Subflow '${node.id}' must specify config.workflowName`);
    }
    const task: SubWorkflowTask = {
      type: "SUB_WORKFLOW",
      name: `sub_${node.id}`,
      taskReferenceName: node.id,
      subWorkflowParam: { name: target.workflowName, version: target.workflowVersion },
      inputParameters: { ...(node.config ?? {}), ...resolveInputs(node.inputs) },
    };
    return { tasks: [task], nextNodeId: this.successor(node.id) };
  }

  terminateTask(endNode: FlowNode): TerminateTask {
    return {
      type: "TERMINATE",
      name: `terminate_${endNode.id}`,
      taskReferenceName: endNode.id,
      inputParameters: {
        terminationStatus: "COMPLETED",
        ...(endNode.outcome ? { workflowOutput: { outcome: endNode.outcome } } : {}),
      },
    };
  }
}

function findConvergence(branchHeads: string[], ctx: ConvertCtx): string | null {
  if (branchHeads.length === 0) return null;
  const visitedPerBranch: Set<string>[] = branchHeads.map(h => walkReachable(h, ctx));
  const intersection = [...visitedPerBranch[0]].filter(id =>
    visitedPerBranch.every(s => s.has(id)),
  );
  if (intersection.length === 0) return null;
  intersection.sort();
  return intersection[0] ?? null;
}

function walkReachable(start: string, ctx: ConvertCtx): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of ctx.outsOf(cur)) {
      if (!seen.has(e.target)) stack.push(e.target);
    }
  }
  return seen;
}

function jsonLogicToString(expr: unknown): string {
  if (expr == null) return "case";
  try { return JSON.stringify(expr).slice(0, 32); } catch { return "case"; }
}

function mapBackoff(b: "fixed" | "linear" | "exponential"): "FIXED" | "LINEAR_BACKOFF" | "EXPONENTIAL_BACKOFF" {
  switch (b) {
    case "fixed":       return "FIXED";
    case "linear":      return "LINEAR_BACKOFF";
    case "exponential": return "EXPONENTIAL_BACKOFF";
  }
}
