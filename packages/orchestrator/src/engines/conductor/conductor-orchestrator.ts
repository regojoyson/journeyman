import type {
  WorkflowGraph,
  IEventBus,
  IOrchestratorEngine, IPauseableEngine, IRetryableEngine,
  IWorkflowInstanceStore, IWorkflowInstanceGrantsStore, WorkflowInstance, WorkflowInstanceStatus,
  SubmitWorkflowInstanceArgs,
} from "@journeyman/core";
import { createLogger } from "@journeyman/core";
import type { ConductorClient } from "./conductor-client.ts";
import type { IWorkflowJsonConverter } from "@journeyman/core";
import type { ConductorWorkflowDef } from "../../flow-json/conductor-types.ts";

const log = createLogger("orchestrator:conductor");

interface WorkflowRetryPolicy { maxAttempts?: number; backoffSeconds?: number }

function readWorkflowRetry(def: WorkflowGraph): WorkflowRetryPolicy | undefined {
  const start = def.nodes.find((n) => n.type === "start");
  return (start?.config as { workflowRetry?: WorkflowRetryPolicy } | undefined)?.workflowRetry;
}

export interface ConductorOrchestratorDeps {
  client: ConductorClient;
  converter: IWorkflowJsonConverter<ConductorWorkflowDef>;
  workflowInstances: IWorkflowInstanceStore;
  workflowInstanceGrants: IWorkflowInstanceGrantsStore;
  events: IEventBus;
}

export class ConductorOrchestrator implements IOrchestratorEngine, IPauseableEngine, IRetryableEngine {
  /** workflowInstanceIds with a pending workflowRetry timer — guards against the syncer firing multiple retries. Transient by design. */
  private workflowRetryPending = new Set<string>();

  constructor(private deps: ConductorOrchestratorDeps) {}

  async submit(args: SubmitWorkflowInstanceArgs): Promise<{ workflowInstanceId: string; engineWorkflowId: string }> {
    const versionSuffix = args.workflowVersionId ? args.workflowVersionId.replace(/-/g, "_") : "unknown";
    const wfName = `journeyman_v${versionSuffix}`;
    const wfDef = this.deps.converter.toEngineJson(args.definitionSnapshot, {
      workflowName: wfName, workflowVersion: 1,
    });

    await this.deps.client.putWorkflowDef(wfDef);

    const instance = await this.deps.workflowInstances.create({
      workflowId: args.workflowId,
      workflowVersionId: args.workflowVersionId,
      workflowNameSnapshot: args.workflowNameSnapshot,
      workflowScopeSnapshot: args.workflowScopeSnapshot,
      definitionSnapshot: args.definitionSnapshot,
      triggerSource: "api",
      startedByUserId: args.startedByUserId,
      startedByOrgId: args.startedByOrgId,
      inputs: args.inputs,
    });

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

    const engineWorkflowId = await this.deps.client.startWorkflow({
      name: wfName,
      version: 1,
      input: {
        ...args.inputs,
        workflowInstanceId: instance.id,
        startedByUserId: args.startedByUserId ?? null,
        startedByOrgId: args.startedByOrgId ?? null,
        workflowId: args.workflowId,
      },
    });

    await this.deps.workflowInstances.setEngineWorkflowId(instance.id, engineWorkflowId);
    await this.deps.workflowInstances.setStatus(instance.id, "running");

    // Start nodes are graph markers, not phases — conductor-converter begins the task sequence at
    // successor(start), so no worker ever runs for them. Emit node.resolved (the same family used
    // for human tasks) so the UI doesn't show the start node stuck at "pending".
    const startNode = args.definitionSnapshot.nodes.find((n) => n.type === "start");
    if (startNode) {
      try {
        await this.deps.events.append({
          workflowInstanceId: instance.id,
          nodeId: startNode.id,
          eventType: "node.resolved",
          payload: {},
        });
      } catch (err) {
        log.warn(
          { workflowInstanceId: instance.id, err: (err as Error)?.message },
          "failed to emit start-node resolved event",
        );
      }
    }

    return { workflowInstanceId: instance.id, engineWorkflowId };
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
    const mapped = mapConductorStatus(live.status);

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
    }
    return mapped;
  }

  /**
   * Several node types compile to engine-internal Conductor tasks that have no worker
   * (see conductor-converter#emitNode): SWITCH (if, gateway-xor), FORK_JOIN (gateway-and),
   * DO_WHILE (loop), WAIT (timer), SUB_WORKFLOW (subflow), TERMINATE (end). They never emit
   * phase.* events and would otherwise stay `pending` in the run viewer forever.
   *
   * On terminal sync, scan completed engine tasks and emit `node.resolved` for each. SIMPLE
   * tasks are skipped because worker-harness already emits phase.* for them; HUMAN tasks are
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
