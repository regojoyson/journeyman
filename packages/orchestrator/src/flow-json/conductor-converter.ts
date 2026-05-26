import type { WorkflowEdge, WorkflowGraph, WorkflowNode, IWorkflowJsonConverter, Shape } from "@journeyman/core";
import { getStartWorkflowInputs, isTriggerNode, findTriggerNodes, findManualTriggerNode, WORKFLOW_SCHEMA_VERSION } from "@journeyman/core";
import { extractTemplateRefs } from "@journeyman/core";
import { findConvergence as coreFindConvergence } from "@journeyman/core";
import type {
  ConductorTaskDef, ConductorWorkflowDef,
  ForkJoinTask, JoinTask, SwitchTask, DoWhileTask, WaitTask,
  SubWorkflowTask, TerminateTask, SimpleTask,
} from "./conductor-types.ts";
import { resolveInputs, parseRef } from "./resolve-inputs.ts";
import { applyWorkflowDefaults } from "./apply-flow-defaults.ts";
import { dominators } from "./reachability.ts";
import { validateRefShapeAgainst, labelNode, type CatalogShapeEntry, type CustomStepShapeEntry } from "./validate-ref-shape.ts";
import { compileSwitchExpression } from "./jsonlogic-to-js.ts";

/**
 * Read-time migration of v1 workflow JSON (with a `start` node and inputs nested
 * in `start.config.workflowInputs`) to v2 (trigger-manual + graph-level inputDefs).
 * Idempotent: returns input unchanged when schemaVersion >= 2.
 */
export function migrateV1ToV2(raw: WorkflowGraph): WorkflowGraph {
  const sv = (raw as { schemaVersion?: number }).schemaVersion ?? 1;
  if (sv >= WORKFLOW_SCHEMA_VERSION) return raw;

  const startNode = raw.nodes.find((n) => (n.type as string) === "start");
  const legacyInputs = startNode
    ? ((startNode.config as { workflowInputs?: unknown[] } | undefined)?.workflowInputs ?? [])
    : [];
  const liftedInputs = (raw.inputDefs && raw.inputDefs.length > 0)
    ? raw.inputDefs
    : (legacyInputs as WorkflowGraph["inputDefs"]);

  const migratedNodes: WorkflowNode[] = raw.nodes.map((n) => {
    if ((n.type as string) !== "start") return n;
    // Preserve the start node's `config` (workflowRetry lives there) but
    // strip the migrated `workflowInputs` field so it isn't duplicated.
    const cfgRaw = (n.config ?? {}) as Record<string, unknown>;
    const { workflowInputs: _drop, ...restCfg } = cfgRaw;
    return { ...n, type: "trigger-manual", config: restCfg };
  });

  return {
    ...raw,
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    inputDefs: liftedInputs,
    nodes: migratedNodes,
  };
}

export class UnsupportedNodeTypeError extends Error {
  constructor(public readonly nodeType: string) {
    super(`Node type '${nodeType}' is not yet supported`);
    this.name = "UnsupportedNodeTypeError";
  }
}

export class WorkflowValidationError extends Error {
  constructor(message: string) { super(message); this.name = "WorkflowValidationError"; }
}

export class ConductorJsonConverter implements IWorkflowJsonConverter<ConductorWorkflowDef> {
  static validateGraph(
    graph: WorkflowGraph,
    catalog?: Map<string, CatalogShapeEntry>,
    customStepDefs?: Map<string, CustomStepShapeEntry>,
  ): void {
    new ConvertCtx(graph, catalog, customStepDefs).validate();
  }

  toEngineJson(def: WorkflowGraph, opts: {
    workflowName: string;
    workflowVersion: number;
  }): ConductorWorkflowDef {
    const ctx = new ConvertCtx(def);
    ctx.validate();

    const start = ctx.startNode();
    const tasks = ctx.buildSequence(ctx.successor(start.id));
    // workflowRetry historically lived on the start node's config; for v2 it
    // moves to the manual trigger (if any), with a fallback to whichever
    // trigger fired.
    const manual = findManualTriggerNode(def);
    const workflowRetryHost = manual ?? start;
    const workflowRetry = (workflowRetryHost.config as { workflowRetry?: { maxAttempts?: number; backoffSeconds?: number } } | undefined)?.workflowRetry;

    return {
      name: opts.workflowName,
      version: opts.workflowVersion,
      schemaVersion: 2,
      tasks,
      cycleVisitLimit: def.maxCycleVisits ?? 100,
      ...(workflowRetry ? { workflowRetry } : {}),
    };
  }
}

class ConvertCtx {
  readonly nodes: Map<string, WorkflowNode>;
  readonly outgoing: Map<string, WorkflowEdge[]>;
  emitted = new Set<string>();

  public flow: WorkflowGraph;

  constructor(
    flow: WorkflowGraph,
    private catalog?: Map<string, CatalogShapeEntry>,
    private customStepDefs?: Map<string, CustomStepShapeEntry>,
  ) {
    this.flow = migrateV1ToV2(flow);
    this.nodes = new Map(this.flow.nodes.map(n => [n.id, n]));
    this.outgoing = new Map();
    for (const e of this.flow.edges) {
      const arr = this.outgoing.get(e.source) ?? [];
      arr.push(e);
      this.outgoing.set(e.source, arr);
    }
  }

  /** Format `node` as it should appear in validation error messages. */
  private label(n: WorkflowNode): string {
    return labelNode(n, n.id);
  }

  /** Look up a node by id and format it for error messages. */
  private labelById(id: string): string {
    return labelNode(this.nodes.get(id), id);
  }

  validate(): void {
    const triggers = findTriggerNodes(this.flow);
    if (triggers.length === 0) throw new WorkflowValidationError("Flow must have at least one trigger node");
    const manualCount = triggers.filter(t => t.type === "trigger-manual").length;
    if (manualCount > 1) throw new WorkflowValidationError("Flow may declare at most one manual trigger");
    const ends = this.flow.nodes.filter(n => n.type === "end");
    if (ends.length === 0) throw new WorkflowValidationError("Flow must have at least one end node");

    const nodeIds = new Set(this.flow.nodes.map(n => n.id));
    // Inputs live on the graph (lifted off start in v2). Fall back to any trigger's
    // legacy config.workflowInputs if graph-level inputDefs is empty.
    const runInputDefs = (this.flow.inputDefs && this.flow.inputDefs.length > 0)
      ? this.flow.inputDefs
      : getStartWorkflowInputs(triggers[0]?.config);
    const runInputNames = new Set(runInputDefs.map(d => d.name));

    for (const node of this.flow.nodes) {
      for (const [field, val] of Object.entries(node.inputs ?? {})) {
        // Friendly short-circuit: ref-kind input with empty value means the user
        // never connected it, not that the ref string is malformed.
        if (val.kind === "ref" && val.ref.trim() === "") {
          throw new WorkflowValidationError(
            `Node ${this.label(node)} input '${field}' is not connected`,
          );
        }

        const refs: Array<{ ref: string; enforceShape: boolean }> = [];
        if (val.kind === "ref") refs.push({ ref: val.ref, enforceShape: true });
        else if (val.kind === "template") {
          for (const seg of extractTemplateRefs(val.template)) {
            refs.push({ ref: seg.ref, enforceShape: false });
          }
        } else continue;

        for (const { ref, enforceShape } of refs) {
          const parsed = parseRef(ref);
          if (!parsed) {
            throw new WorkflowValidationError(`Node ${this.label(node)} input '${field}' has unparseable ref '${ref}'`);
          }
          if (parsed.source === "workflow.input") {
            if (!runInputNames.has(parsed.field)) {
              throw new WorkflowValidationError(`Node ${this.label(node)} references undeclared run input '${parsed.field}'`);
            }
            continue;
          }
          if (!nodeIds.has(parsed.source)) {
            throw new WorkflowValidationError(`Node ${this.label(node)} references missing node '${parsed.source}'`);
          }
          const doms = dominators(this.flow, node.id);
          if (!doms.has(parsed.source)) {
            throw new WorkflowValidationError(
              `${this.label(node)} reads input '${field}' from ${this.labelById(parsed.source)}, but those two steps are on different branches — ${this.labelById(parsed.source)} won't always have run by the time ${this.label(node)} needs it. Either remove this input link, or move the steps so they're on the same path (e.g. place ${this.labelById(parsed.source)} before the fork, or place ${this.label(node)} after the Join).`,
            );
          }
          // Shape compatibility (only when a catalog is supplied).
          if (enforceShape && this.catalog && node.type === "step" && node.stepType) {
            let expected: Shape | undefined;
            if (node.stepType === "custom-ai") {
              const customId = (node.config as { customStepId?: unknown } | undefined)?.customStepId;
              const def = typeof customId === "string" && customId ? this.customStepDefs?.get(customId) : undefined;
              expected = def?.inputFields?.[field]?.shape;
            } else {
              expected = this.catalog.get(node.stepType)?.inputFields?.[field]?.shape;
            }
            if (expected) {
              const result = validateRefShapeAgainst(this.flow, ref, expected, this.catalog, this.customStepDefs);
              if (!result.ok) {
                throw new WorkflowValidationError(
                  `Node ${this.label(node)} input '${field}': ${result.error}`,
                );
              }
            }
          }
        }
      }
    }
  }

  startNode(): WorkflowNode {
    // Prefer the manual trigger if present (preserves legacy behaviour where
    // workflowRetry / Run-button semantics live on a single entry node).
    // Otherwise pick the first trigger node in declaration order.
    const manual = findManualTriggerNode(this.flow);
    if (manual) return manual;
    const t = this.flow.nodes.find(n => isTriggerNode(n));
    if (!t) throw new WorkflowValidationError("Flow has no trigger node");
    return t;
  }

  successor(nodeId: string): string | null {
    const out = this.outgoing.get(nodeId) ?? [];
    return out[0]?.target ?? null;
  }

  outsOf(nodeId: string): WorkflowEdge[] { return this.outgoing.get(nodeId) ?? []; }

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

  emitNode(node: WorkflowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    switch (node.type) {
      case "step":        return this.emitStep(node);
      case "gateway-xor":
      case "if":           return this.emitSwitch(node);
      case "gateway-and":  return this.emitForkJoin(node);
      case "join":         return this.emitJoin(node);
      case "loop":         return this.emitDoWhile(node);
      case "timer":        return this.emitWait(node);
      case "subflow":      return this.emitSubflow(node);
      case "human-task":   return this.emitHumanTask(node);
      case "webhook-wait": return this.emitWebhookWait(node);
      case "trigger-manual":
      case "trigger-webhook":
      case "trigger-human":
        // Trigger nodes are pure graph entry points; they emit no engine tasks.
        // The build loop should call successor() and continue from there before
        // ever reaching emitNode, but this case is here defensively.
        return { tasks: [], nextNodeId: this.successor(node.id) };
      case "retry-block":
      case "try-catch":    throw new UnsupportedNodeTypeError(node.type);
      default:             throw new UnsupportedNodeTypeError(node.type);
    }
  }

  emitStep(node: WorkflowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    if (!node.stepType) throw new WorkflowValidationError(`Step node ${this.label(node)} missing stepType`);
    const { resolved: resolvedNode, sources: defaultSources } = applyWorkflowDefaults(node, this.flow.defaults);
    const r = resolvedNode.retry ?? {};
    const enabled = r.enabled === true;

    const task: SimpleTask = {
      type: "SIMPLE",
      name: resolvedNode.stepType!,
      taskReferenceName: resolvedNode.id,
      inputParameters: (() => {
        const bindings = resolvedNode.secretBindings ?? {};
        const kindProviders: Record<string, string> = {};
        const ec = this.flow.defaults?.executorConfig;
        if (ec) {
          for (const [kind, cfg] of Object.entries(ec)) {
            if (cfg?.provider) kindProviders[kind] = cfg.provider;
          }
        }
        return {
          ...(resolvedNode.config ?? {}),
          ...resolveInputs(resolvedNode.inputs),
          provider: resolvedNode.executorConfig?.provider,
          retry: resolvedNode.retry ?? {},
          secretBindings: bindings,
          ...(resolvedNode.model ? { model: resolvedNode.model } : {}),
          _flowDefaultSources: defaultSources,
          _kindProviders: kindProviders,
          workflowInstanceId: "${workflow.input.workflowInstanceId}",
          startedByUserId: "${workflow.input.startedByUserId}",
          startedByOrgId: "${workflow.input.startedByOrgId}",
          workflowId: "${workflow.input.workflowId}",
        };
      })(),
      retryCount: enabled ? (r.maxAttempts ?? 3) : 0,
      retryLogic: enabled ? mapBackoff(r.backoff ?? "exponential") : "FIXED",
      retryDelaySeconds: enabled ? (r.backoffSeconds ?? 5) : 0,
      backoffScaleFactor: enabled ? (r.backoffMultiplier ?? 2) : 1,
      timeoutSeconds: r.timeoutSeconds ?? 600,
      responseTimeoutSeconds: r.timeoutSeconds ?? 600,
    };
    return { tasks: [task], nextNodeId: this.successor(resolvedNode.id) };
  }

  emitSwitch(node: WorkflowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    const outs = this.outsOf(node.id);
    if (outs.length === 0) {
      throw new WorkflowValidationError(`Switch ${this.label(node)} has no outgoing edges`);
    }

    const conditional = outs.filter(e => e.type === "conditional");
    const elseEdge    = outs.find(e => e.type === "else");

    const seenLabels = new Set<string>();
    for (const e of conditional) {
      if (e.condition === undefined) {
        throw new WorkflowValidationError(`Edge ${e.id} on gateway ${this.label(node)} is conditional but has no condition`);
      }
      if (!e.branchLabel) {
        throw new WorkflowValidationError(`Edge ${e.id} on gateway ${this.label(node)} requires a branchLabel`);
      }
      if (seenLabels.has(e.branchLabel)) {
        throw new WorkflowValidationError(`Duplicate branchLabel '${e.branchLabel}' on gateway ${this.label(node)}`);
      }
      seenLabels.add(e.branchLabel);
    }

    const branchTargets = outs.map(e => e.target);
    const convergence   = coreFindConvergence(branchTargets, this.outgoing);
    const stopAt        = convergence ? new Set([convergence]) : undefined;

    const cases: Record<string, ConductorTaskDef[]> = {};
    for (const e of conditional) {
      cases[e.branchLabel!] = this.buildSequence(e.target, stopAt);
    }
    const defaultCase = elseEdge ? this.buildSequence(elseEdge.target, stopAt) : undefined;

    let expression: string;
    let inputParameters: Record<string, string>;
    try {
      ({ expression, inputParameters } = compileSwitchExpression(conditional));
    } catch (err) {
      throw new WorkflowValidationError(
        `Failed to compile conditions on gateway ${this.label(node)}: ${(err as Error).message}`,
      );
    }

    const task: SwitchTask = {
      type: "SWITCH",
      name: `switch_${node.id}`,
      taskReferenceName: node.id,
      evaluatorType: "javascript",
      expression,
      inputParameters,
      decisionCases: cases,
      ...(defaultCase ? { defaultCase } : {}),
    };
    return { tasks: [task], nextNodeId: convergence };
  }

  private validateOutputNames(
    node: WorkflowNode,
    outputs: ReadonlyArray<{ name: string }>,
    reserved: readonly string[],
    label: string,
  ): void {
    const reservedSet = new Set(reserved);
    const seen = new Set<string>();
    for (const o of outputs) {
      if (!o.name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(o.name)) {
        throw new WorkflowValidationError(
          `${label} ${this.label(node)} output name '${o.name}' is invalid (must be alphanumeric / underscore, not start with digit)`,
        );
      }
      if (reservedSet.has(o.name)) {
        throw new WorkflowValidationError(
          `${label} ${this.label(node)} output name '${o.name}' collides with a reserved meta key`,
        );
      }
      if (seen.has(o.name)) {
        throw new WorkflowValidationError(`${label} ${this.label(node)} has duplicate output name '${o.name}'`);
      }
      seen.add(o.name);
    }
  }

  emitHumanTask(node: WorkflowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    const cfg = (node.config ?? {}) as Partial<import("@journeyman/core").HumanTaskConfig>;
    const outputs = Array.isArray(cfg.outputs) ? cfg.outputs : [];
    this.validateOutputNames(node, outputs, ["source", "actor", "resolvedAt", "payload"], "Human-task");

    const human: import("./conductor-types.ts").HumanTask = {
      type: "HUMAN",
      name: `human_${node.id}`,
      taskReferenceName: node.id,
      inputParameters: {
        outputs,
        ...(cfg.prompt !== undefined ? { prompt: cfg.prompt } : {}),
        ...(cfg.notify ? { notify: cfg.notify } : {}),
        ...(cfg.timeout ? {
          timeoutDurationMs: parseDurationMs(cfg.timeout.duration),
          ...(cfg.timeout.defaults ? { timeoutDefaults: cfg.timeout.defaults } : {}),
        } : {}),
        kind: "human-task",
      },
    };

    return { tasks: [human], nextNodeId: this.successor(node.id) };
  }

  emitWebhookWait(node: WorkflowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    const cfg = (node.config ?? {}) as Partial<import("@journeyman/core").WebhookWaitConfig>;

    if (!cfg.webhookId) {
      throw new WorkflowValidationError(`Webhook-wait ${this.label(node)} must reference a webhookId`);
    }

    const outputs = Array.isArray(cfg.outputs) ? cfg.outputs : [];
    this.validateOutputNames(node, outputs, ["source", "resolvedAt", "webhookEventId", "payload"], "Webhook-wait");

    const human: import("./conductor-types.ts").HumanTask = {
      type: "HUMAN",
      name: `webhookwait_${node.id}`,
      taskReferenceName: node.id,
      inputParameters: {
        outputs,
        webhookId: cfg.webhookId,
        correlationKey: cfg.correlationKey ?? "issueRef",
        ...(cfg.listensFor ? { listensFor: cfg.listensFor } : {}),
        ...(cfg.acceptIf ? { acceptIf: cfg.acceptIf } : {}),
        ...(cfg.timeout ? {
          timeoutDurationMs: parseDurationMs(cfg.timeout.duration),
          ...(cfg.timeout.defaults ? { timeoutDefaults: cfg.timeout.defaults } : {}),
        } : {}),
        kind: "webhook-wait",
      },
    };

    return { tasks: [human], nextNodeId: this.successor(node.id) };
  }

  emitForkJoin(node: WorkflowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    const outs = this.outsOf(node.id);
    if (outs.length < 2) {
      throw new WorkflowValidationError(`Fork ${this.label(node)} must have at least 2 outgoing edges`);
    }

    const joinIds = new Set<string>();
    const branches: Array<{ head: string; stopAt: Set<string> }> = [];
    for (const e of outs) {
      const join = this.findJoinAlongBranch(e.target);
      if (!join) {
        throw new WorkflowValidationError(`Fork ${this.label(node)} branch starting at ${e.target} does not reach a join`);
      }
      joinIds.add(join);
      branches.push({ head: e.target, stopAt: new Set([join]) });
    }
    if (joinIds.size !== 1) {
      throw new WorkflowValidationError(
        `Fork ${this.label(node)} branches converge on multiple joins: ${[...joinIds].join(", ")}`,
      );
    }
    const joinId = [...joinIds][0];

    const forkTasks: ConductorTaskDef[][] = branches.map(b => this.buildSequence(b.head, b.stopAt));

    const fork: ForkJoinTask = {
      type: "FORK_JOIN",
      name: `fork_${node.id}`,
      taskReferenceName: node.id,
      forkTasks,
    };
    return { tasks: [fork], nextNodeId: joinId };
  }

  private findJoinAlongBranch(start: string): string | null {
    const visited = new Set<string>();
    let cur: string | null = start;
    while (cur !== null && !visited.has(cur)) {
      const here: string = cur;
      visited.add(here);
      const n = this.nodes.get(here);
      if (!n) return null;
      if (n.type === "join") return here;
      const nexts: WorkflowEdge[] = this.outgoing.get(here) ?? [];
      cur = nexts.length > 0 ? nexts[0].target : null;
    }
    return null;
  }

  emitJoin(node: WorkflowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    const ins = this.flow.edges.filter(e => e.target === node.id);
    if (ins.length < 2) {
      throw new WorkflowValidationError(`Join ${this.label(node)} must have at least 2 incoming edges`);
    }

    const joinOn = ins.map(e => e.source);

    const forkId = this.findMatchingFork(node.id);
    if (!forkId) {
      throw new WorkflowValidationError(`Join ${this.label(node)} has no matching fork`);
    }

    const cfg = (node.config ?? {}) as Partial<import("@journeyman/core").JoinConfig>;
    const errorMode = cfg.errorMode ?? "fail-fast";

    const branchTaskRefs: string[][] = (this.outgoing.get(forkId) ?? []).map(e => {
      const chain: string[] = [];
      let cur: string | null = e.target;
      const visited = new Set<string>();
      while (cur !== null && !visited.has(cur) && cur !== node.id) {
        const here: string = cur;
        visited.add(here);
        chain.push(here);
        const nexts: WorkflowEdge[] = this.outgoing.get(here) ?? [];
        cur = nexts.length > 0 ? nexts[0].target : null;
      }
      return chain;
    });

    const join: JoinTask = {
      type: "JOIN",
      name: `join_${node.id}`,
      taskReferenceName: node.id,
      joinOn,
      inputParameters: {
        errorMode,
        branchTaskRefs,
        ...(cfg.description ? { description: cfg.description } : {}),
      },
    };

    return { tasks: [join], nextNodeId: this.successor(node.id) };
  }

  private findMatchingFork(joinId: string): string | null {
    for (const n of this.flow.nodes) {
      if (n.type !== "gateway-and") continue;
      const branchHeads = (this.outgoing.get(n.id) ?? []).map(e => e.target);
      if (branchHeads.length < 2) continue;
      const allReach = branchHeads.every(head => {
        const visited = new Set<string>();
        let cur: string | null = head;
        while (cur !== null && !visited.has(cur)) {
          const here: string = cur;
          visited.add(here);
          if (here === joinId) return true;
          const nexts: WorkflowEdge[] = this.outgoing.get(here) ?? [];
          cur = nexts.length > 0 ? nexts[0].target : null;
        }
        return false;
      });
      if (allReach) return n.id;
    }
    return null;
  }

  emitDoWhile(node: WorkflowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    const outs = this.outsOf(node.id);
    if (outs.length === 0) throw new WorkflowValidationError(`Loop ${this.label(node)} has no body edge`);
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

  emitWait(node: WorkflowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    const cfg = (node.config ?? {}) as { duration?: string; until?: string };
    const task: WaitTask = {
      type: "WAIT",
      name: `wait_${node.id}`,
      taskReferenceName: node.id,
      inputParameters: cfg,
    };
    return { tasks: [task], nextNodeId: this.successor(node.id) };
  }

  emitSubflow(node: WorkflowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    const target = (node.config ?? {}) as { workflowName?: string; workflowVersion?: number };
    if (!target.workflowName) {
      throw new WorkflowValidationError(`Subflow ${this.label(node)} must specify config.workflowName`);
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

  terminateTask(endNode: WorkflowNode): TerminateTask {
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

function mapBackoff(b: "fixed" | "linear" | "exponential"): "FIXED" | "LINEAR_BACKOFF" | "EXPONENTIAL_BACKOFF" {
  switch (b) {
    case "fixed":       return "FIXED";
    case "linear":      return "LINEAR_BACKOFF";
    case "exponential": return "EXPONENTIAL_BACKOFF";
  }
}

function parseDurationMs(input: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)$/.exec(input.trim());
  if (!m) throw new WorkflowValidationError(`Invalid duration '${input}' — expected e.g. '48h', '30m', '7d'`);
  const n = Number(m[1]);
  switch (m[2]) {
    case "ms": return n;
    case "s":  return n * 1000;
    case "m":  return n * 60_000;
    case "h":  return n * 3_600_000;
    case "d":  return n * 86_400_000;
    default:   throw new WorkflowValidationError(`Invalid duration unit '${m[2]}'`);
  }
}
