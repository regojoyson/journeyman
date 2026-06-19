import {
  createLogger, PROVIDER_CATALOG, kindForStepType,
  loggerForRun, appendStepEvent, serializeError, LogTail,
  type WorkflowLogCtx,
} from "@journeyman/core";
import type {
  IEventBus, IStepRegistry,
  SecretBinding,
  ResolvedMcpInstance,
  ResolvedSkillPackage,
  ExecOp,
} from "@journeyman/core";
import type { EnsureWorkspaceResult } from "../sandbox/ensure-workspace.ts";
import type { ConductorClient } from "../engines/conductor/conductor-client.ts";
import { VisitCounter } from "./visit-counter.ts";
import { startHeartbeat } from "./heartbeat.ts";

const baseLog = createLogger("orchestrator:worker");

export interface WorkerHarnessDeps {
  client: ConductorClient;
  registry: IStepRegistry;
  events: IEventBus;
  workerId: string;
  pollIntervalMs?: number;

  bindingResolver: (input: {
    ctx: { userId: string | null; orgId: string | null; workflowId: string | null; workspaceId: string | null };
    slots: Array<{ name: string; optional?: boolean }>;
    bindings: Record<string, SecretBinding>;
  }) => Promise<Record<string, string>>;

  mcpResolver: (input: {
    ctx: { userId: string; orgId: string; workspaceId: string | null };
    instanceIds: string[];
  }) => Promise<ResolvedMcpInstance[]>;

  skillsResolver: (input: {
    ctx: { userId: string; orgId: string; workspaceId: string | null };
    packageIds: string[];
  }) => Promise<ResolvedSkillPackage[]>;

  modelResolver?: (input: { provider: string }) => Promise<string | undefined>;

  modelConfigResolver?: (input: { provider: string; modelId: string }) =>
    Promise<import("@journeyman/core").CodingModelConfig | undefined>;

  /**
   * Provision (or reconnect to) the per-run workspace on demand.
   * Returns the execution environment + provisioned handle for this run.
   */
  ensureWorkspace: (args: {
    runId: string;
    sandboxId: string | undefined;
    userId: string | null;
    orgId: string | null;
    log?: (line: string) => void;
    verbose?: boolean;
  }) => Promise<EnsureWorkspaceResult>;
}

export class WorkerHarness {
  private running = false;
  private visitCounter = new VisitCounter(Number(process.env.CYCLE_VISIT_LIMIT ?? 100));

  constructor(private deps: WorkerHarnessDeps) {}

  async start(stepTypes: string[]): Promise<void> {
    this.running = true;
    await Promise.all(stepTypes.map(t => this.loop(t)));
  }

  stop(): void { this.running = false; }

  private async loop(stepType: string): Promise<void> {
    const interval = this.deps.pollIntervalMs ?? 500;
    while (this.running) {
      try { await this.processOnce(stepType); }
      catch (err) { baseLog.error({ err, stepType }, "poll loop error"); }
      await new Promise(r => setTimeout(r, interval));
    }
  }

  async processOnce(stepType: string): Promise<void> {
    const task = await this.deps.client.pollTask(stepType, this.deps.workerId);
    if (!task) return;
    const conductorWorkflowId = task.workflowInstanceId;
    const workflowInstanceId =
      (task.inputData as { workflowInstanceId?: string }).workflowInstanceId ?? conductorWorkflowId;
    const nodeId = task.referenceTaskName;
    const attempt = task.retryCount + 1;

    const ctx: WorkflowLogCtx = {
      workflowInstanceId, nodeId, stepType,
      attempt, taskId: task.taskId, workerId: this.deps.workerId,
    };
    const rlog = loggerForRun(baseLog, ctx);

    await appendStepEvent(this.deps.events, ctx, "task.polled", {},
      e => rlog.error({ err: e }, "task.polled emit failed"));
    rlog.info("task picked up");

    const handler = this.deps.registry.get(stepType);
    if (!handler) {
      rlog.error("no handler registered for step — failing task");
      await appendStepEvent(this.deps.events, ctx, "step.failed", {
        reason: "handler_missing",
        error: { errorClass: "HandlerMissing", message: `No handler for step '${stepType}'` },
      });
      await this.deps.client.completeTask({
        workflowInstanceId: conductorWorkflowId,
        taskId: task.taskId,
        status: "FAILED_WITH_TERMINAL_ERROR",
        reasonForIncompletion: `No handler for step '${stepType}'`,
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
    const stepInput: Record<string, unknown> = { ...rawInput };
    delete stepInput["_flowDefaultSources"];

    const userId = (stepInput as { startedByUserId?: string | null }).startedByUserId ?? null;
    const orgId = (stepInput as { startedByOrgId?: string | null }).startedByOrgId ?? null;
    const workspaceId = (stepInput as { workspaceId?: string | null }).workspaceId ?? null;
    const abort = new AbortController();
    // Per-step timeout: agents (and any step) may set `timeoutSeconds` in node config; auto-abort when it elapses.
    const timeoutSeconds =
      typeof (stepInput as { timeoutSeconds?: unknown }).timeoutSeconds === "number"
        ? (stepInput as { timeoutSeconds: number }).timeoutSeconds
        : undefined;
    const timeoutHandle =
      timeoutSeconds && timeoutSeconds > 0
        ? setTimeout(() => abort.abort(new DOMException("Step timed out", "TimeoutError")), timeoutSeconds * 1000)
        : undefined;

    const workflowId = (stepInput as { workflowId?: string | null }).workflowId ?? null;
    const declaredBindings =
      (stepInput as { secretBindings?: Record<string, SecretBinding> }).secretBindings ?? {};

    let resolvedEnv: Record<string, string>;
    try {
      const stepDef = this.deps.registry.get(stepType);
      const stepKind = kindForStepType(stepType);
      const provider = (stepInput as { provider?: string }).provider;
      const providerSlots = stepKind
        ? (PROVIDER_CATALOG.find(p => p.value === provider && p.kind === stepKind)?.slots ?? [])
        : [];
      const stepSlots = (stepDef as unknown as { slots?: Array<{ name: string; optional?: boolean }> })?.slots ?? [];

      const slotsFromKind = (stepDef as unknown as { slotsFromKind?: string }).slotsFromKind;
      const kindProviders =
        (stepInput as { _kindProviders?: Record<string, string> })._kindProviders ?? {};
      const kindOverrideSlots = slotsFromKind && kindProviders[slotsFromKind]
        ? (PROVIDER_CATALOG.find(p => p.kind === slotsFromKind && p.value === kindProviders[slotsFromKind])?.slots ?? [])
        : [];

      const slots = kindOverrideSlots.length > 0
        ? kindOverrideSlots
        : (stepSlots.length > 0 ? stepSlots : providerSlots);

      rlog.info({
        stepKind, provider,
        slotsFromKind: slotsFromKind ?? null,
        kindProvider: slotsFromKind ? (kindProviders[slotsFromKind] ?? null) : null,
        slots: slots.map(s => s.name),
        bindings: Object.fromEntries(Object.entries(declaredBindings).map(([k, v]) => [k, v.mode])),
        userId: userId ?? "(null)",
        orgId: orgId ?? "(null)",
      }, "resolving secrets");

      resolvedEnv = await this.deps.bindingResolver({
        ctx: { userId, orgId, workflowId, workspaceId },
        slots,
        bindings: declaredBindings,
      });

      rlog.info({ resolvedKeys: Object.keys(resolvedEnv) }, "secrets resolved");
    } catch (err: any) {
      const isCredErr = err?.name === "MissingSecretsError";
      if (isCredErr) {
        const missing: string[] = err.missing ?? (err.ref ? [String(err.ref)] : []);
        rlog.error({ missing }, "step failed: missing secrets");
        await appendStepEvent(this.deps.events, ctx, "step.failed", {
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

    const mcpInstanceIds = Array.isArray((stepInput as { mcpInstanceIds?: unknown }).mcpInstanceIds)
      ? ((stepInput as { mcpInstanceIds: unknown[] }).mcpInstanceIds.filter(
          (x): x is string => typeof x === "string"
        ))
      : [];
    let mcps: ResolvedMcpInstance[] = [];
    if (mcpInstanceIds.length > 0 && userId && orgId) {
      try {
        mcps = await this.deps.mcpResolver({
          ctx: { userId: userId ?? "", orgId: orgId ?? "", workspaceId },
          instanceIds: mcpInstanceIds,
        });
        rlog.info({ count: mcps.length }, "MCPs resolved");
      } catch (err: any) {
        rlog.error({ err: err?.message }, "MCP resolution failed");
        await appendStepEvent(this.deps.events, ctx, "step.failed", {
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
    (stepInput as { mcps?: ResolvedMcpInstance[] }).mcps = mcps;

    const skillPackageIds = Array.isArray((stepInput as { skillPackageIds?: unknown }).skillPackageIds)
      ? ((stepInput as { skillPackageIds: unknown[] }).skillPackageIds.filter(
          (x): x is string => typeof x === "string"
        ))
      : [];
    let skills: ResolvedSkillPackage[] = [];
    if (skillPackageIds.length > 0 && userId && orgId) {
      try {
        skills = await this.deps.skillsResolver({
          ctx: { userId: userId ?? "", orgId: orgId ?? "", workspaceId },
          packageIds: skillPackageIds,
        });
        rlog.info({ count: skills.length }, "skills resolved");
      } catch (err: any) {
        rlog.error({ err: err?.message }, "skills resolution failed");
        await appendStepEvent(this.deps.events, ctx, "step.failed", {
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
    (stepInput as { skills?: ResolvedSkillPackage[] }).skills = skills;

    const existingModel = (stepInput as { model?: unknown }).model;
    if ((typeof existingModel !== "string" || !existingModel) && this.deps.modelResolver) {
      const provider = (stepInput as { provider?: string }).provider;
      if (typeof provider === "string" && provider) {
        try {
          const sysModel = await this.deps.modelResolver({ provider });
          if (sysModel) {
            (stepInput as { model?: string }).model = sysModel;
          }
        } catch (err: any) {
          rlog.warn({ err: err?.message }, "model resolver failed; deferring to provider default");
        }
      }
    }

    // Resolve provider-specific model config (e.g. OpenCode custom endpoints) so the
    // operation can emit a provider block / bind the endpoint's key slot.
    const resolvedModel = (stepInput as { model?: unknown }).model;
    const cfgProvider = (stepInput as { provider?: string }).provider;
    if (
      this.deps.modelConfigResolver &&
      typeof resolvedModel === "string" && resolvedModel &&
      typeof cfgProvider === "string" && cfgProvider
    ) {
      try {
        const mc = await this.deps.modelConfigResolver({ provider: cfgProvider, modelId: resolvedModel });
        if (mc) (stepInput as { modelConfig?: unknown }).modelConfig = mc;
      } catch (err: any) {
        rlog.warn({ err: err?.message }, "model config resolver failed; continuing without custom config");
      }
    }

    const inputForEvent = redactStepInputForEvent(stepInput);
    await this.deps.events.append({
      workflowInstanceId, nodeId, eventType: "step.started",
      payload: { attempt: task.retryCount + 1, inputSources, input: inputForEvent },
    });

    const tail = new LogTail<string>(20);
    const heartbeatMs = Number(process.env.WORKER_HEARTBEAT_MS ?? 30_000);
    const startedAt = Date.now();
    const stopHeartbeat = startHeartbeat({
      intervalMs: heartbeatMs,
      onBeat: (elapsedMs) => {
        appendStepEvent(this.deps.events, ctx, "worker.heartbeat", { elapsedMs })
          .catch(e => rlog.debug({ err: e }, "heartbeat emit failed"));
        rlog.debug({ elapsedMs }, "step.heartbeat");
      },
    });

    // Determine whether this step needs a workspace (static flag OR dynamic predicate).
    const needsWorkspace =
      handler.requiresWorkspace === true ||
      (typeof handler.needsWorkspaceFor === "function" &&
        (await handler.needsWorkspaceFor(stepInput)) === true);

    let workspaceDir = "";
    let execFn: ((op: ExecOp) => Promise<import("@journeyman/core").ExecResult>) | undefined;
    let materializeFn: import("@journeyman/core").StepContext["materialize"];

    if (needsWorkspace) {
      const sandboxId = (stepInput as { sandboxId?: string }).sandboxId;
      const provisionLogLevel =
        typeof (stepInput as { agentLogLevel?: string }).agentLogLevel === "string"
          ? (stepInput as { agentLogLevel: string }).agentLogLevel
          : "light";
      const provisionVerbose = provisionLogLevel === "medium" || provisionLogLevel === "all";
      const { env: wsEnv, provisioned } = await this.deps.ensureWorkspace({
        runId: workflowInstanceId,
        sandboxId,
        userId,
        orgId,
        log: (line: string) =>
          this.deps.events
            .append({ workflowInstanceId, nodeId, eventType: "step.log", payload: { line } })
            .catch((err) => rlog.error({ err }, "provision log emit failed")),
        verbose: provisionVerbose,
      });
      workspaceDir = provisioned.workspaceDir;
      // Local runs: leave exec undefined — handlers run in-process.
      // Non-local (docker, etc.): wire exec so operations go into the container.
      if (provisioned.type !== "local") {
        execFn = (op) => wsEnv.exec(provisioned, op);
      }
      materializeFn = (destDir, bundle) => wsEnv.materialize(provisioned, destDir, bundle);
    }

    try {
      const workflowInputs = ((stepInput as { __workflowInput?: Record<string, unknown> }).__workflowInput) ?? {};
      const result = await handler.run(stepInput, {
        workflowInstanceId, nodeId, attempt: task.retryCount + 1,
        workspaceDir, signal: abort.signal,
        env: resolvedEnv,
        workflowInputs,
        log: (line, meta) => {
          const text = typeof line === "string" ? line : String(line);
          tail.push(text);
          this.deps.events.append({
            workflowInstanceId, nodeId, eventType: "step.log", payload: { line, meta },
          }).catch(err => rlog.error({ err }, "log emit failed"));
        },
        ...(execFn ? { exec: execFn } : {}),
        ...(materializeFn ? { materialize: materializeFn } : {}),
      });

      if (result.kind === "success") {
        const durationMs = Date.now() - startedAt;
        rlog.info({ durationMs }, "step completed");
        await appendStepEvent(this.deps.events, ctx, "step.completed", {
          output: result.output, durationMs,
        });
        await this.deps.client.completeTask({
          workflowInstanceId: conductorWorkflowId, taskId: task.taskId,
          status: "COMPLETED", outputData: result.output,
        });
      } else {
        const retryable = result.failure.retryable ?? false;
        const durationMs = Date.now() - startedAt;
        rlog.error({ retryable, error: result.failure, durationMs }, "step failed");
        await appendStepEvent(this.deps.events, ctx, "step.failed", {
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
      if (err?.name === "ConfigurationError" || err?.name === "SandboxNotFoundError") {
        rlog.error({ message: err.message, durationMs }, "step failed: configuration error");
        await appendStepEvent(this.deps.events, ctx, "step.failed", {
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
      rlog.error({ err: serializeError(err), durationMs }, "step threw unhandled error");
      await appendStepEvent(this.deps.events, ctx, "step.failed", {
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
      if (timeoutHandle) clearTimeout(timeoutHandle);
      stopHeartbeat();
    }
  }
}

function redactStepInputForEvent(stepInput: Record<string, unknown>): Record<string, unknown> {
  const REDACT = new Set([
    "mcps", "skills", "secretBindings",
    "__workflowInput", "_flowDefaultSources",
    "startedByUserId", "startedByOrgId", "workspaceId",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stepInput)) {
    if (REDACT.has(k)) continue;
    out[k] = v;
  }
  return out;
}
