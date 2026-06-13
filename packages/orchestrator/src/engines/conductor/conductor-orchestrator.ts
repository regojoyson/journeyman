import type {
  WorkflowGraph,
  IEventBus,
  IOrchestratorEngine, IPauseableEngine, IRetryableEngine,
  IWorkflowInstanceStore, IWorkflowInstanceGrantsStore, WorkflowInstance, WorkflowInstanceStatus,
  SubmitWorkflowInstanceArgs,
} from "@journeyman/core";
import { createLogger, findManualTriggerNode, isTriggerNode, isTerminalStatus } from "@journeyman/core";
import type { ConductorClient } from "./conductor-client.ts";
import { emitRoutingEvents } from "./emit-routing-events.ts";
import { buildAttributeInputs } from "../../flow-json/attribute-inputs.ts";
import type { IWorkflowJsonConverter } from "@journeyman/core";
import type { ConductorWorkflowDef } from "../../flow-json/conductor-types.ts";

const log = createLogger("orchestrator:conductor");

interface WorkflowRetryPolicy { maxAttempts?: number; backoffSeconds?: number }

function readWorkflowRetry(def: WorkflowGraph): WorkflowRetryPolicy | undefined {
  // workflowRetry historically lived on the start node's config. In v2 it sits
  // on the manual trigger (if any); fall back to the first trigger otherwise.
  const host = findManualTriggerNode(def) ?? def.nodes.find((n) => isTriggerNode(n));
  return (host?.config as { workflowRetry?: WorkflowRetryPolicy } | undefined)?.workflowRetry;
}

export interface ConductorOrchestratorDeps {
  client: ConductorClient;
  converter: IWorkflowJsonConverter<ConductorWorkflowDef>;
  workflowInstances: IWorkflowInstanceStore;
  workflowInstanceGrants: IWorkflowInstanceGrantsStore;
  events: IEventBus;
  /** Provisions a sandbox for a run at start; absent/no-op for local-only deployments. */
  sandboxProvisioner?: (args: {
    workflowInstanceId: string;
    sandboxId?: string;
    userId: string | null;
    orgId: string | null;
  }) => Promise<void>;
  /** Tears down a run's sandbox when it reaches a terminal state. */
  sandboxReaper?: (workflowInstanceId: string) => Promise<void>;
}

export class ConductorOrchestrator implements IOrchestratorEngine, IPauseableEngine, IRetryableEngine {
  /** workflowInstanceIds with a pending workflowRetry timer — guards against the syncer firing multiple retries. Transient by design. */
  private workflowRetryPending = new Set<string>();

  /**
   * Consecutive Conductor-404 counts per instance. A single 404 may be the
   * engine's read path briefly lagging a just-submitted workflow (start race),
   * so we only reconcile an orphan to terminal after NOT_FOUND_TERMINAL_THRESHOLD
   * consecutive 404s. Reset on any successful read. Transient by design.
   */
  private notFoundCounts = new Map<string, number>();
  private static readonly NOT_FOUND_TERMINAL_THRESHOLD = 2;

  constructor(private deps: ConductorOrchestratorDeps) {}

  async submit(args: SubmitWorkflowInstanceArgs): Promise<{ workflowInstanceId: string; engineWorkflowId: string | null }> {
    const versionSuffix = args.workflowVersionId ? args.workflowVersionId.replace(/-/g, "_") : "unknown";
    const wfName = `journeyman_v${versionSuffix}`;
    const wfDef = this.deps.converter.toEngineJson(args.definitionSnapshot, {
      workflowName: wfName, workflowVersion: 1,
    });

    // Register the def on the request path so a bad def fails the trigger early.
    await this.deps.client.putWorkflowDef(wfDef);

    const instance = await this.deps.workflowInstances.create({
      workflowId: args.workflowId,
      workflowVersionId: args.workflowVersionId,
      workflowNameSnapshot: args.workflowNameSnapshot,
      workflowScopeSnapshot: args.workflowScopeSnapshot,
      definitionSnapshot: args.definitionSnapshot,
      triggerSource: args.triggerSource ?? "api",
      startedByUserId: args.startedByUserId,
      startedByOrgId: args.startedByOrgId,
      inputs: args.inputs,
      triggerNodeId: args.triggerNodeId ?? null,
      webhookEventId: args.webhookEventId ?? null,
      formSubmissionId: args.formSubmissionId ?? null,
    });

    // Mark the run "provisioning" so the UI shows the phase while the sandbox builds.
    await this.deps.workflowInstances.setStatus(instance.id, "provisioning");

    const grantsToWrite: Array<{
      principalType: "user" | "org" | "global";
      principalId: string | null;
      role: "owner" | "editor" | "viewer";
      createdBy: string | null;
    }> = [];
    if (args.startedByUserId) {
      grantsToWrite.push({
        principalType: "user", principalId: args.startedByUserId,
        role: "owner", createdBy: args.startedByUserId,
      });
    }
    if (args.startedByOrgId) {
      grantsToWrite.push({
        principalType: "org", principalId: args.startedByOrgId,
        role: "viewer", createdBy: args.startedByUserId,
      });
    }
    if (grantsToWrite.length > 0) await this.deps.workflowInstanceGrants.createForInstance(instance.id, grantsToWrite);

    // Provision + start happen OFF the request path. Ordering (provision BEFORE
    // startWorkflow) is preserved inside runStart, so the "sandbox ready before the
    // first workspace step" invariant still holds. Provisioning failures mark the run
    // failed (see runStart's catch). A run left in "provisioning" after a crash is
    // reaped by the ProvisioningReaper.
    void this.runStart(instance.id, wfName, args).catch((err) => {
      log.error({ workflowInstanceId: instance.id, err: (err as Error)?.message }, "background run start failed");
    });

    return { workflowInstanceId: instance.id, engineWorkflowId: null };
  }

  /**
   * Provision the run's sandbox, then start the Conductor workflow. Runs detached from
   * submit() so the slow Docker build never blocks the trigger response. Any failure
   * marks the run "failed" and emits a step.log; startWorkflow is skipped, so no orphan
   * Conductor workflow is left behind.
   */
  async runStart(workflowInstanceId: string, wfName: string, args: SubmitWorkflowInstanceArgs): Promise<void> {
    try {
      if (this.deps.sandboxProvisioner) {
        await this.deps.sandboxProvisioner({
          workflowInstanceId,
          sandboxId: args.definitionSnapshot.defaults?.sandboxId,
          userId: args.startedByUserId ?? null,
          orgId: args.startedByOrgId ?? null,
        });
      }

      const engineWorkflowId = await this.deps.client.startWorkflow({
        name: wfName,
        version: 1,
        input: {
          ...args.inputs,
          attributes: buildAttributeInputs(args.definitionSnapshot.attributeDefs),
          workflowInstanceId,
          startedByUserId: args.startedByUserId ?? null,
          startedByOrgId: args.startedByOrgId ?? null,
          workflowId: args.workflowId,
        },
      });

      await this.deps.workflowInstances.setEngineWorkflowId(workflowInstanceId, engineWorkflowId);
      await this.deps.workflowInstances.setStatus(workflowInstanceId, "running");

      // Trigger nodes are graph markers, not steps — conductor-converter begins the task
      // sequence at successor(trigger), so no worker ever runs for them. Emit node.resolved
      // so the UI doesn't show the entry node stuck at "pending". Prefer the trigger that
      // fired (args.triggerNodeId), else the manual trigger, else any trigger in the graph.
      const startNode = (args.triggerNodeId
        ? args.definitionSnapshot.nodes.find((n) => n.id === args.triggerNodeId)
        : null)
        ?? findManualTriggerNode(args.definitionSnapshot)
        ?? args.definitionSnapshot.nodes.find((n) => isTriggerNode(n));
      if (startNode) {
        try {
          await this.deps.events.append({
            workflowInstanceId,
            nodeId: startNode.id,
            eventType: "node.resolved",
            payload: {},
          });
        } catch (err) {
          log.warn(
            { workflowInstanceId, err: (err as Error)?.message },
            "failed to emit start-node resolved event",
          );
        }
      }
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      log.error({ workflowInstanceId, err: message }, "run provisioning/start failed");
      await this.deps.events.append({
        workflowInstanceId,
        eventType: "step.log",
        payload: { line: `Run failed during provisioning: ${message}` },
      }).catch(() => undefined);
      await this.deps.workflowInstances
        .setStatus(workflowInstanceId, "failed", { completedAt: new Date() })
        .catch(() => undefined);
    }
  }

  async getWorkflowInstance(workflowInstanceId: string): Promise<WorkflowInstance | null> {
    return await this.deps.workflowInstances.getById(workflowInstanceId);
  }

  async cancel(workflowInstanceId: string, reason?: string): Promise<void> {
    const instance = await this.deps.workflowInstances.getById(workflowInstanceId);
    if (!instance?.engineWorkflowId) return;
    await this.deps.client.terminate(instance.engineWorkflowId, reason);
    await this.deps.workflowInstances.setStatus(workflowInstanceId, "cancelled");
  }

  async pause(workflowInstanceId: string): Promise<void> {
    const instance = await this.deps.workflowInstances.getById(workflowInstanceId);
    if (!instance?.engineWorkflowId) return;
    await this.deps.client.pauseWorkflow(instance.engineWorkflowId);
    await this.deps.workflowInstances.setStatus(workflowInstanceId, "paused");
  }

  async resume(workflowInstanceId: string): Promise<void> {
    const instance = await this.deps.workflowInstances.getById(workflowInstanceId);
    if (!instance?.engineWorkflowId) return;
    await this.deps.client.resumeWorkflow(instance.engineWorkflowId);
    await this.deps.workflowInstances.setStatus(workflowInstanceId, "running");
  }

  async retryFromTask(workflowInstanceId: string, nodeId: string | undefined): Promise<void> {
    const instance = await this.deps.workflowInstances.getById(workflowInstanceId);
    if (!instance?.engineWorkflowId) throw new Error("WorkflowInstance has no engine workflow id");
    await this.deps.client.retryWorkflow(instance.engineWorkflowId, { taskId: nodeId });
    await this.deps.workflowInstances.setStatus(workflowInstanceId, "running");
  }

  async syncStatus(workflowInstanceId: string): Promise<WorkflowInstanceStatus> {
    const instance = await this.deps.workflowInstances.getById(workflowInstanceId);
    if (!instance?.engineWorkflowId) return instance?.status ?? "pending";
    const live = await this.deps.client.getWorkflow(instance.engineWorkflowId);

    // Conductor 404 (live === null): the engine no longer knows this run — almost
    // always because its storage was reset while our DB kept the instance active.
    // Reconcile to a terminal `cancelled` so the syncer stops polling it forever.
    // Guard against the start race (a just-submitted workflow that 404s before the
    // engine's read path catches up) by requiring consecutive 404s. This is its OWN
    // path — it must not flow through the `failed` branch below, which would try to
    // retryWorkflow() a workflow that doesn't exist.
    if (live === null) {
      const count = (this.notFoundCounts.get(workflowInstanceId) ?? 0) + 1;
      if (count < ConductorOrchestrator.NOT_FOUND_TERMINAL_THRESHOLD) {
        this.notFoundCounts.set(workflowInstanceId, count);
        return instance.status;
      }
      this.notFoundCounts.delete(workflowInstanceId);
      log.warn(
        { workflowInstanceId, engineWorkflowId: instance.engineWorkflowId },
        "engine no longer knows this workflow (404); reconciling to cancelled",
      );
      const completedAt = new Date();
      const durationMs = instance.startedAt
        ? completedAt.getTime() - instance.startedAt.getTime() : undefined;
      await this.deps.workflowInstances.setStatus(workflowInstanceId, "cancelled", {
        completedAt, durationMs,
      });
      if (this.deps.sandboxReaper) {
        await this.deps.sandboxReaper(workflowInstanceId).catch(() => undefined);
      }
      return "cancelled";
    }
    this.notFoundCounts.delete(workflowInstanceId);

    const mapped = mapConductorStatus(live.status);

    // The paused/running distinction for a live (engine-RUNNING) workflow is
    // owned by waiting-row derivation (recomputeWaitStatus, run from
    // resolveHumanTask and the reconcile backstop) — NOT by the coarse Conductor
    // status, which reports RUNNING even while waiting on a HUMAN task. So when
    // the engine reports RUNNING we never overwrite the stored running/paused
    // value here; derivation sets it correctly and we just surface it. (A manual
    // pause reports Conductor PAUSED and is handled by the terminal/paused block
    // below.) Leaving a derived `paused` untouched keeps the webhook matcher
    // able to find genuinely-waiting instances.
    if (instance.status === "paused" && mapped === "running") {
      return "paused";
    }

    if (mapped === "failed" && this.shouldWorkflowRetry(instance)) {
      this.scheduleWorkflowRetry(instance);
      return "running";
    }

    if (mapped !== instance.status) {
      if (mapped === "completed") {
        await this.emitEngineNodeResolveds(instance);
      }
      const completedAt = ["completed", "failed", "cancelled"].includes(mapped)
        ? new Date() : undefined;
      const durationMs = completedAt && instance.startedAt
        ? completedAt.getTime() - instance.startedAt.getTime() : undefined;
      await this.deps.workflowInstances.setStatus(workflowInstanceId, mapped, {
        completedAt, durationMs,
        outputs: live.output,
      });
      if (isTerminalStatus(mapped) && this.deps.sandboxReaper) {
        await this.deps.sandboxReaper(workflowInstanceId).catch(() => undefined);
      }
    }
    return mapped;
  }

  /**
   * Several node types compile to engine-internal Conductor tasks that have no worker
   * (see conductor-converter#emitNode): SWITCH (if, gateway-xor), FORK_JOIN (gateway-and),
   * DO_WHILE (loop), WAIT (timer), SUB_WORKFLOW (subflow), TERMINATE (end). They never emit
   * step.* events and would otherwise stay `pending` in the run viewer forever.
   *
   * On terminal sync, scan completed engine tasks and emit `node.resolved` for each. SIMPLE
   * tasks are skipped because worker-harness already emits step.* for them; HUMAN tasks are
   * skipped because they emit their own node.waiting/node.resolved.
   */
  private async emitEngineNodeResolveds(instance: WorkflowInstance): Promise<void> {
    if (!instance.engineWorkflowId) return;
    try {
      const exec = await this.deps.client.getWorkflowWithTasks(instance.engineWorkflowId);
      for (const t of exec.tasks) {
        if (t.status !== "COMPLETED") continue;
        if (t.taskType === "SIMPLE" || t.taskType === "HUMAN") continue;
        await this.deps.events.append({
          workflowInstanceId: instance.id,
          nodeId: t.referenceTaskName,
          eventType: "node.resolved",
          payload: { taskType: t.taskType, output: t.outputData ?? {} },
        });
      }
      await emitRoutingEvents(this.deps.events, instance.id, exec.tasks as unknown as Parameters<typeof emitRoutingEvents>[2]);
    } catch (err) {
      log.warn(
        { workflowInstanceId: instance.id, err: (err as Error)?.message },
        "failed to emit engine node resolved events",
      );
    }
  }

  private shouldWorkflowRetry(instance: WorkflowInstance): boolean {
    if (this.workflowRetryPending.has(instance.id)) return true;
    const policy = readWorkflowRetry(instance.definitionSnapshot);
    if (!policy) return false;
    const max = policy.maxAttempts ?? 1;
    return instance.attemptNumber < max;
  }

  private scheduleWorkflowRetry(instance: WorkflowInstance): void {
    if (this.workflowRetryPending.has(instance.id)) return;
    const policy = readWorkflowRetry(instance.definitionSnapshot);
    if (!policy) return;
    this.workflowRetryPending.add(instance.id);
    const delayMs = (policy.backoffSeconds ?? 0) * 1000;
    const nextAttempt = instance.attemptNumber + 1;
    log.info({ workflowInstanceId: instance.id, attempt: nextAttempt, delayMs }, "workflow-retry scheduled");
    setTimeout(async () => {
      try {
        if (!instance.engineWorkflowId) return;
        await this.deps.client.retryWorkflow(instance.engineWorkflowId);
        await this.deps.workflowInstances.setAttemptNumber(instance.id, nextAttempt);
        log.info({ workflowInstanceId: instance.id, attempt: nextAttempt }, "workflow-retry triggered");
      } catch (err) {
        log.error({ workflowInstanceId: instance.id, err: (err as Error)?.message }, "workflow-retry failed");
      } finally {
        this.workflowRetryPending.delete(instance.id);
      }
    }, delayMs);
  }
}

function mapConductorStatus(s: string): WorkflowInstanceStatus {
  switch (s) {
    case "RUNNING": return "running";
    case "COMPLETED": return "completed";
    case "FAILED": case "TIMED_OUT": return "failed";
    case "PAUSED": return "paused";
    case "TERMINATED": return "cancelled";
    default: return "pending";
  }
}
