import { createLogger, PROVIDER_CATALOG, kindForPhaseType } from "@journeyman/core";
import type {
  IEventBus, IPhaseRegistry, IWorkspaceProvider,
  SecretBinding,
  ResolvedMcpInstance,
  ResolvedSkillPackage,
} from "@journeyman/core";
import type { ConductorClient } from "../engines/conductor/conductor-client.ts";
import { VisitCounter } from "./visit-counter.ts";

const log = createLogger("orchestrator:worker");

export interface WorkerHarnessDeps {
  client: ConductorClient;
  registry: IPhaseRegistry;
  workspace: IWorkspaceProvider;
  events: IEventBus;
  workerId: string;
  pollIntervalMs?: number;

  /**
   * Slot-aware resolver injected by the composition root. Walks the phase's
   * declared slots and the task's bindings, returns slot-keyed env values.
   */
  bindingResolver: (input: {
    ctx: { userId: string | null; orgId: string | null; flowId: string | null };
    slots: Array<{ name: string; optional?: boolean }>;
    bindings: Record<string, SecretBinding>;
  }) => Promise<Record<string, string>>;

  /**
   * Resolves `mcpInstanceIds` (declared on a phase's node config) into
   * fully-formed `ResolvedMcpInstance[]` ready to hand to coding-cli.
   * Composition root supplies the implementation (curries the pg pool
   * over `resolveMcpInstances` from `@journeyman/mcp`).
   */
  mcpResolver: (input: {
    ctx: { userId: string; orgId: string };
    instanceIds: string[];
  }) => Promise<ResolvedMcpInstance[]>;

  /**
   * Resolves `skillPackageIds` (declared on a phase's node config) into
   * fully-formed `ResolvedSkillPackage[]` ready to hand to coding-cli.
   * Composition root supplies the implementation (curries the pg pool
   * over `resolveSkillPackagesByIds` from `@journeyman/skills`).
   */
  skillsResolver: (input: {
    ctx: { userId: string; orgId: string };
    packageIds: string[];
  }) => Promise<ResolvedSkillPackage[]>;

  /**
   * Optional fallback resolver for the model when neither the node nor the
   * flow defaults provide one. Returns the admin-flagged DB default model_id
   * for the given coding provider, or undefined to defer to the provider's
   * own hardcoded fallback.
   */
  modelResolver?: (input: { provider: string }) => Promise<string | undefined>;
}

export class WorkerHarness {
  private running = false;
  private visitCounter = new VisitCounter(Number(process.env.CYCLE_VISIT_LIMIT ?? 100));

  constructor(private deps: WorkerHarnessDeps) {}

  /** Start the long-poll loops for the given phase types. */
  async start(phaseTypes: string[]): Promise<void> {
    this.running = true;
    await Promise.all(phaseTypes.map(t => this.loop(t)));
  }

  stop(): void { this.running = false; }

  private async loop(phaseType: string): Promise<void> {
    const interval = this.deps.pollIntervalMs ?? 500;
    while (this.running) {
      try { await this.processOnce(phaseType); }
      catch (err) { log.error({ err, phaseType }, "poll loop error"); }
      await new Promise(r => setTimeout(r, interval));
    }
  }

  /** Test seam: poll once and process if a task is available. */
  async processOnce(phaseType: string): Promise<void> {
    const task = await this.deps.client.pollTask(phaseType, this.deps.workerId);
    if (!task) return;
    log.info({ runId: task.workflowInstanceId, nodeId: task.taskDefName, phaseType, attempt: task.retryCount + 1 }, "task picked up");

    const handler = this.deps.registry.get(phaseType);
    if (!handler) {
      log.error({ runId: task.workflowInstanceId, nodeId: task.taskDefName, phaseType }, "no handler registered for phase — failing task");
      await this.deps.client.completeTask({
        workflowInstanceId: task.workflowInstanceId,
        taskId: task.taskId,
        status: "FAILED_WITH_TERMINAL_ERROR",
        reasonForIncompletion: `No handler for phase '${phaseType}'`,
      });
      return;
    }

    const visit = this.visitCounter.recordVisit(task.workflowInstanceId, task.taskDefName);
    if (visit.exceeded) {
      log.warn({ runId: task.workflowInstanceId, nodeId: task.taskDefName, count: visit.count }, "cycle limit exceeded");
      await this.deps.events.append({
        runId: task.workflowInstanceId,
        nodeId: task.taskDefName,
        eventType: "node.cycled",
        payload: { count: visit.count, limit: -1 },
      });
      await this.deps.client.completeTask({
        workflowInstanceId: task.workflowInstanceId,
        taskId: task.taskId,
        status: "FAILED_WITH_TERMINAL_ERROR",
        reasonForIncompletion: `CycleLimitExceeded: node '${task.taskDefName}' visited ${visit.count} times`,
      });
      return;
    }

    const runId = task.workflowInstanceId;
    const nodeId = task.referenceTaskName;
    const rawInput = (task.inputData ?? {}) as Record<string, unknown>;
    const inputSources = (rawInput as { _flowDefaultSources?: Record<string, "node" | "flow-default"> })._flowDefaultSources;
    const phaseInput: Record<string, unknown> = { ...rawInput };
    delete phaseInput["_flowDefaultSources"];

    const userId = (phaseInput as { startedByUserId?: string | null }).startedByUserId ?? null;
    const orgId = (phaseInput as { startedByOrgId?: string | null }).startedByOrgId ?? null;
    const ws = await this.deps.workspace.create({ runId, nodeId, userId });
    const abort = new AbortController();

    const flowId = (phaseInput as { flowId?: string | null }).flowId ?? null;
    const declaredBindings =
      (phaseInput as { secretBindings?: Record<string, SecretBinding> }).secretBindings ?? {};

    let resolvedEnv: Record<string, string>;
    try {
      const phaseDef = this.deps.registry.get(phaseType);
      const phaseKind = kindForPhaseType(phaseType);
      const provider = (phaseInput as { provider?: string }).provider;
      const providerSlots = phaseKind
        ? (PROVIDER_CATALOG.find(p => p.value === provider && p.kind === phaseKind)?.slots ?? [])
        : [];
      const phaseSlots = (phaseDef as unknown as { slots?: Array<{ name: string; optional?: boolean }> })?.slots ?? [];
      const slots = phaseSlots.length > 0 ? phaseSlots : providerSlots;

      log.info({
        runId, nodeId, phaseKind, provider,
        slots: slots.map(s => s.name),
        bindings: Object.fromEntries(Object.entries(declaredBindings).map(([k, v]) => [k, v.mode])),
        userId: userId ?? "(null)",
        orgId: orgId ?? "(null)",
      }, "resolving secrets");

      resolvedEnv = await this.deps.bindingResolver({
        ctx: { userId, orgId, flowId },
        slots,
        bindings: declaredBindings,
      });

      log.info({ runId, nodeId, resolvedKeys: Object.keys(resolvedEnv) }, "secrets resolved");
    } catch (err: any) {
      const isCredErr = err?.name === "MissingSecretsError";
      if (isCredErr) {
        const missing: string[] = err.missing ?? (err.ref ? [String(err.ref)] : []);
        log.error({ runId, nodeId, missing }, "phase failed: missing secrets");
        await this.deps.events.append({
          runId, nodeId, eventType: "phase.failed",
          payload: { reason: "missing_secrets", missing, message: String(err?.message ?? "") },
        });
        await this.deps.client.completeTask({
          workflowInstanceId: runId, taskId: task.taskId,
          status: "FAILED_WITH_TERMINAL_ERROR",
          reasonForIncompletion: `missing_secrets: ${missing.join(", ") || err?.message || "unknown"}`,
        });
        return;
      }
      throw err;
    }

    const mcpInstanceIds = Array.isArray((phaseInput as { mcpInstanceIds?: unknown }).mcpInstanceIds)
      ? ((phaseInput as { mcpInstanceIds: unknown[] }).mcpInstanceIds.filter(
          (x): x is string => typeof x === "string"
        ))
      : [];
    let mcps: ResolvedMcpInstance[] = [];
    if (mcpInstanceIds.length > 0 && userId && orgId) {
      try {
        mcps = await this.deps.mcpResolver({
          ctx: { userId, orgId },
          instanceIds: mcpInstanceIds,
        });
        log.info({ runId, nodeId, count: mcps.length }, "MCPs resolved");
      } catch (err: any) {
        log.error({ runId, nodeId, err: err?.message }, "MCP resolution failed");
        await this.deps.events.append({
          runId, nodeId, eventType: "phase.failed",
          payload: { reason: "mcp_resolution_failed", message: String(err?.message ?? "") },
        });
        await this.deps.client.completeTask({
          workflowInstanceId: runId, taskId: task.taskId,
          status: "FAILED_WITH_TERMINAL_ERROR",
          reasonForIncompletion: `MCP resolution failed: ${err?.message ?? String(err)}`,
        });
        return;
      }
    }
    (phaseInput as { mcps?: ResolvedMcpInstance[] }).mcps = mcps;

    const skillPackageIds = Array.isArray((phaseInput as { skillPackageIds?: unknown }).skillPackageIds)
      ? ((phaseInput as { skillPackageIds: unknown[] }).skillPackageIds.filter(
          (x): x is string => typeof x === "string"
        ))
      : [];
    let skills: ResolvedSkillPackage[] = [];
    if (skillPackageIds.length > 0 && userId && orgId) {
      try {
        skills = await this.deps.skillsResolver({
          ctx: { userId, orgId },
          packageIds: skillPackageIds,
        });
        log.info({ runId, nodeId, count: skills.length }, "skills resolved");
      } catch (err: any) {
        log.error({ runId, nodeId, err: err?.message }, "skills resolution failed");
        await this.deps.events.append({
          runId, nodeId, eventType: "phase.failed",
          payload: { reason: "skills_resolution_failed", message: String(err?.message ?? "") },
        });
        await this.deps.client.completeTask({
          workflowInstanceId: runId, taskId: task.taskId,
          status: "FAILED_WITH_TERMINAL_ERROR",
          reasonForIncompletion: `Skills resolution failed: ${err?.message ?? String(err)}`,
        });
        return;
      }
    }
    (phaseInput as { skills?: ResolvedSkillPackage[] }).skills = skills;

    // Model resolution: if the converter didn't set `model` (no node override
    // and no flow default), ask the optional resolver for the system default
    // for this coding provider. Undefined ⇒ provider uses its own fallback.
    const existingModel = (phaseInput as { model?: unknown }).model;
    if ((typeof existingModel !== "string" || !existingModel) && this.deps.modelResolver) {
      const provider = (phaseInput as { provider?: string }).provider;
      if (typeof provider === "string" && provider) {
        try {
          const sysModel = await this.deps.modelResolver({ provider });
          if (sysModel) {
            (phaseInput as { model?: string }).model = sysModel;
          }
        } catch (err: any) {
          log.warn({ runId, nodeId, err: err?.message }, "model resolver failed; deferring to provider default");
        }
      }
    }

    await this.deps.events.append({
      runId, nodeId, eventType: "phase.started",
      payload: { attempt: task.retryCount + 1, inputSources },
    });

    try {
      const runInputs = ((phaseInput as { __workflowInput?: Record<string, unknown> }).__workflowInput) ?? {};
      const result = await handler.run(phaseInput, {
        runId, nodeId, attempt: task.retryCount + 1,
        workspaceDir: ws.path, signal: abort.signal,
        env: resolvedEnv,
        runInputs,
        log: (line, meta) => {
          this.deps.events.append({
            runId, nodeId, eventType: "phase.log", payload: { line, meta },
          }).catch(err => log.error(err, "log emit failed"));
        },
      });

      if (result.kind === "success") {
        log.info({ runId, nodeId }, "phase completed");
        await this.deps.events.append({
          runId, nodeId, eventType: "phase.completed",
          payload: { output: result.output },
        });
        await this.deps.client.completeTask({
          workflowInstanceId: runId, taskId: task.taskId,
          status: "COMPLETED", outputData: result.output,
        });
      } else {
        const retryable = result.failure.retryable ?? false;
        log.error({ runId, nodeId, retryable, error: result.failure }, "phase failed");
        await this.deps.events.append({
          runId, nodeId, eventType: "phase.failed",
          payload: { error: result.failure, classified: { retryable } },
        });
        await this.deps.client.completeTask({
          workflowInstanceId: runId, taskId: task.taskId,
          status: retryable ? "FAILED" : "FAILED_WITH_TERMINAL_ERROR",
          reasonForIncompletion: result.failure.message,
        });
      }
    } catch (err: any) {
      if (err?.name === "ConfigurationError") {
        log.error({ runId, nodeId, message: err.message }, "phase failed: configuration error");
        await this.deps.events.append({
          runId, nodeId, eventType: "phase.failed",
          payload: { reason: "configuration_error", message: String(err?.message ?? "") },
        });
        await this.deps.client.completeTask({
          workflowInstanceId: runId, taskId: task.taskId,
          status: "FAILED_WITH_TERMINAL_ERROR",
          reasonForIncompletion: `configuration_error: ${err.message}`,
        });
        return;
      }
      log.error({ runId, nodeId, err }, "phase threw unhandled error");
      await this.deps.events.append({
        runId, nodeId, eventType: "phase.failed",
        payload: { error: { errorClass: "UnhandledError", message: String(err?.message ?? err) } },
      });
      await this.deps.client.completeTask({
        workflowInstanceId: runId, taskId: task.taskId,
        status: "FAILED",
        reasonForIncompletion: String(err?.message ?? err),
      });
    } finally {
      await ws.destroy().catch(e => log.warn(e, "workspace destroy failed"));
    }
  }
}
