import {
  createLogger, PROVIDER_CATALOG, kindForPhaseType,
  loggerForRun, appendPhaseEvent, serializeError, LogTail,
  type WorkflowLogCtx,
} from "@journeyman/core";
import type {
  IEventBus, IPhaseRegistry, IWorkspaceProvider,
  SecretBinding,
  ResolvedMcpInstance,
  ResolvedSkillPackage,
} from "@journeyman/core";
import type { ConductorClient } from "../engines/conductor/conductor-client.ts";
import { VisitCounter } from "./visit-counter.ts";
import { startHeartbeat } from "./heartbeat.ts";

const baseLog = createLogger("orchestrator:worker");

export interface WorkerHarnessDeps {
  client: ConductorClient;
  registry: IPhaseRegistry;
  workspace: IWorkspaceProvider;
  events: IEventBus;
  workerId: string;
  pollIntervalMs?: number;

  bindingResolver: (input: {
    ctx: { userId: string | null; orgId: string | null; workflowId: string | null };
    slots: Array<{ name: string; optional?: boolean }>;
    bindings: Record<string, SecretBinding>;
  }) => Promise<Record<string, string>>;

  mcpResolver: (input: {
    ctx: { userId: string; orgId: string };
    instanceIds: string[];
  }) => Promise<ResolvedMcpInstance[]>;

  skillsResolver: (input: {
    ctx: { userId: string; orgId: string };
    packageIds: string[];
  }) => Promise<ResolvedSkillPackage[]>;

  modelResolver?: (input: { provider: string }) => Promise<string | undefined>;
}

export class WorkerHarness {
  private running = false;
  private visitCounter = new VisitCounter(Number(process.env.CYCLE_VISIT_LIMIT ?? 100));

  constructor(private deps: WorkerHarnessDeps) {}

  async start(phaseTypes: string[]): Promise<void> {
    this.running = true;
    await Promise.all(phaseTypes.map(t => this.loop(t)));
  }

  stop(): void { this.running = false; }

  private async loop(phaseType: string): Promise<void> {
    const interval = this.deps.pollIntervalMs ?? 500;
    while (this.running) {
      try { await this.processOnce(phaseType); }
      catch (err) { baseLog.error({ err, phaseType }, "poll loop error"); }
      await new Promise(r => setTimeout(r, interval));
    }
  }

  async processOnce(phaseType: string): Promise<void> {
    const task = await this.deps.client.pollTask(phaseType, this.deps.workerId);
    if (!task) return;
    const conductorWorkflowId = task.workflowInstanceId;
    const workflowInstanceId =
      (task.inputData as { workflowInstanceId?: string }).workflowInstanceId ?? conductorWorkflowId;
    const nodeId = task.referenceTaskName;
    const attempt = task.retryCount + 1;

    const ctx: WorkflowLogCtx = {
      workflowInstanceId, nodeId, phaseType,
      attempt, taskId: task.taskId, workerId: this.deps.workerId,
    };
    const rlog = loggerForRun(baseLog, ctx);

    await appendPhaseEvent(this.deps.events, ctx, "task.polled", {},
      e => rlog.error({ err: e }, "task.polled emit failed"));
    rlog.info("task picked up");

    const handler = this.deps.registry.get(phaseType);
    if (!handler) {
      rlog.error("no handler registered for phase — failing task");
      await appendPhaseEvent(this.deps.events, ctx, "phase.failed", {
        reason: "handler_missing",
        error: { errorClass: "HandlerMissing", message: `No handler for phase '${phaseType}'` },
      });
      await this.deps.client.completeTask({
        workflowInstanceId: conductorWorkflowId,
        taskId: task.taskId,
        status: "FAILED_WITH_TERMINAL_ERROR",
        reasonForIncompletion: `No handler for phase '${phaseType}'`,
      });
      return;
    }

    const visit = this.visitCounter.recordVisit(workflowInstanceId, task.taskDefName);
    if (visit.exceeded) {
      rlog.warn({ count: visit.count }, "cycle limit exceeded");
      await this.deps.events.append({
        workflowInstanceId,
        nodeId: task.taskDefName,
        eventType: "node.cycled",
        payload: { count: visit.count, limit: -1 },
      });
      await this.deps.client.completeTask({
        workflowInstanceId: conductorWorkflowId,
        taskId: task.taskId,
        status: "FAILED_WITH_TERMINAL_ERROR",
        reasonForIncompletion: `CycleLimitExceeded: node '${task.taskDefName}' visited ${visit.count} times`,
      });
      return;
    }

    const rawInput = (task.inputData ?? {}) as Record<string, unknown>;
    const inputSources = (rawInput as { _flowDefaultSources?: Record<string, "node" | "flow-default"> })._flowDefaultSources;
    const phaseInput: Record<string, unknown> = { ...rawInput };
    delete phaseInput["_flowDefaultSources"];

    const userId = (phaseInput as { startedByUserId?: string | null }).startedByUserId ?? null;
    const orgId = (phaseInput as { startedByOrgId?: string | null }).startedByOrgId ?? null;
    const ws = await this.deps.workspace.create({ workflowInstanceId, nodeId, userId });
    const abort = new AbortController();

    const workflowId = (phaseInput as { workflowId?: string | null }).workflowId ?? null;
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

      const slotsFromKind = (phaseDef as unknown as { slotsFromKind?: string }).slotsFromKind;
      const kindProviders =
        (phaseInput as { _kindProviders?: Record<string, string> })._kindProviders ?? {};
      const kindOverrideSlots = slotsFromKind && kindProviders[slotsFromKind]
        ? (PROVIDER_CATALOG.find(p => p.kind === slotsFromKind && p.value === kindProviders[slotsFromKind])?.slots ?? [])
        : [];

      const slots = kindOverrideSlots.length > 0
        ? kindOverrideSlots
        : (phaseSlots.length > 0 ? phaseSlots : providerSlots);

      rlog.info({
        phaseKind, provider,
        slotsFromKind: slotsFromKind ?? null,
        kindProvider: slotsFromKind ? (kindProviders[slotsFromKind] ?? null) : null,
        slots: slots.map(s => s.name),
        bindings: Object.fromEntries(Object.entries(declaredBindings).map(([k, v]) => [k, v.mode])),
        userId: userId ?? "(null)",
        orgId: orgId ?? "(null)",
      }, "resolving secrets");

      resolvedEnv = await this.deps.bindingResolver({
        ctx: { userId, orgId, workflowId },
        slots,
        bindings: declaredBindings,
      });

      rlog.info({ resolvedKeys: Object.keys(resolvedEnv) }, "secrets resolved");
    } catch (err: any) {
      const isCredErr = err?.name === "MissingSecretsError";
      if (isCredErr) {
        const missing: string[] = err.missing ?? (err.ref ? [String(err.ref)] : []);
        rlog.error({ missing }, "phase failed: missing secrets");
        await appendPhaseEvent(this.deps.events, ctx, "phase.failed", {
          reason: "missing_secrets",
          missing,
          error: serializeError(err),
        });
        await this.deps.client.completeTask({
          workflowInstanceId: conductorWorkflowId, taskId: task.taskId,
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
        rlog.info({ count: mcps.length }, "MCPs resolved");
      } catch (err: any) {
        rlog.error({ err: err?.message }, "MCP resolution failed");
        await appendPhaseEvent(this.deps.events, ctx, "phase.failed", {
          reason: "mcp_resolution_failed",
          error: serializeError(err),
        });
        await this.deps.client.completeTask({
          workflowInstanceId: conductorWorkflowId, taskId: task.taskId,
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
        rlog.info({ count: skills.length }, "skills resolved");
      } catch (err: any) {
        rlog.error({ err: err?.message }, "skills resolution failed");
        await appendPhaseEvent(this.deps.events, ctx, "phase.failed", {
          reason: "skills_resolution_failed",
          error: serializeError(err),
        });
        await this.deps.client.completeTask({
          workflowInstanceId: conductorWorkflowId, taskId: task.taskId,
          status: "FAILED_WITH_TERMINAL_ERROR",
          reasonForIncompletion: `Skills resolution failed: ${err?.message ?? String(err)}`,
        });
        return;
      }
    }
    (phaseInput as { skills?: ResolvedSkillPackage[] }).skills = skills;

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
          rlog.warn({ err: err?.message }, "model resolver failed; deferring to provider default");
        }
      }
    }

    const inputForEvent = redactPhaseInputForEvent(phaseInput);
    await this.deps.events.append({
      workflowInstanceId, nodeId, eventType: "phase.started",
      payload: { attempt: task.retryCount + 1, inputSources, input: inputForEvent },
    });

    const tail = new LogTail<string>(20);
    const heartbeatMs = Number(process.env.WORKER_HEARTBEAT_MS ?? 30_000);
    const startedAt = Date.now();
    const stopHeartbeat = startHeartbeat({
      intervalMs: heartbeatMs,
      onBeat: (elapsedMs) => {
        appendPhaseEvent(this.deps.events, ctx, "worker.heartbeat", { elapsedMs })
          .catch(e => rlog.debug({ err: e }, "heartbeat emit failed"));
        rlog.debug({ elapsedMs }, "phase.heartbeat");
      },
    });

    try {
      const workflowInputs = ((phaseInput as { __workflowInput?: Record<string, unknown> }).__workflowInput) ?? {};
      const result = await handler.run(phaseInput, {
        workflowInstanceId, nodeId, attempt: task.retryCount + 1,
        workspaceDir: ws.path, signal: abort.signal,
        env: resolvedEnv,
        workflowInputs,
        log: (line, meta) => {
          const text = typeof line === "string" ? line : String(line);
          tail.push(text);
          this.deps.events.append({
            workflowInstanceId, nodeId, eventType: "phase.log", payload: { line, meta },
          }).catch(err => rlog.error({ err }, "log emit failed"));
        },
      });

      if (result.kind === "success") {
        const durationMs = Date.now() - startedAt;
        rlog.info({ durationMs }, "phase completed");
        await appendPhaseEvent(this.deps.events, ctx, "phase.completed", {
          output: result.output, durationMs,
        });
        await this.deps.client.completeTask({
          workflowInstanceId: conductorWorkflowId, taskId: task.taskId,
          status: "COMPLETED", outputData: result.output,
        });
      } else {
        const retryable = result.failure.retryable ?? false;
        const durationMs = Date.now() - startedAt;
        rlog.error({ retryable, error: result.failure, durationMs }, "phase failed");
        await appendPhaseEvent(this.deps.events, ctx, "phase.failed", {
          reason: "handler_error",
          error: { ...result.failure, retryable },
          tail: tail.drain(),
          classified: { retryable },
          durationMs,
        });
        await this.deps.client.completeTask({
          workflowInstanceId: conductorWorkflowId, taskId: task.taskId,
          status: retryable ? "FAILED" : "FAILED_WITH_TERMINAL_ERROR",
          reasonForIncompletion: result.failure.message,
        });
      }
    } catch (err: any) {
      const durationMs = Date.now() - startedAt;
      if (err?.name === "ConfigurationError") {
        rlog.error({ message: err.message, durationMs }, "phase failed: configuration error");
        await appendPhaseEvent(this.deps.events, ctx, "phase.failed", {
          reason: "configuration_error",
          error: serializeError(err),
          tail: tail.drain(),
          durationMs,
        });
        await this.deps.client.completeTask({
          workflowInstanceId: conductorWorkflowId, taskId: task.taskId,
          status: "FAILED_WITH_TERMINAL_ERROR",
          reasonForIncompletion: `configuration_error: ${err.message}`,
        });
        return;
      }
      rlog.error({ err: serializeError(err), durationMs }, "phase threw unhandled error");
      await appendPhaseEvent(this.deps.events, ctx, "phase.failed", {
        reason: "unhandled",
        error: serializeError(err),
        tail: tail.drain(),
        durationMs,
      });
      await this.deps.client.completeTask({
        workflowInstanceId: conductorWorkflowId, taskId: task.taskId,
        status: "FAILED",
        reasonForIncompletion: String(err?.message ?? err),
      });
    } finally {
      stopHeartbeat();
      await ws.destroy().catch(e => rlog.warn({ err: e }, "workspace destroy failed"));
    }
  }
}

function redactPhaseInputForEvent(phaseInput: Record<string, unknown>): Record<string, unknown> {
  const REDACT = new Set([
    "mcps", "skills", "secretBindings",
    "__workflowInput", "_flowDefaultSources",
    "startedByUserId", "startedByOrgId",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(phaseInput)) {
    if (REDACT.has(k)) continue;
    out[k] = v;
  }
  return out;
}
