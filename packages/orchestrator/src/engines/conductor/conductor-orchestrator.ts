import type {
  FlowGraph,
  IOrchestratorEngine, IPauseableEngine, IRetryableEngine,
  IRunStore, IRunGrantsStore, Run, RunStatus, SubmitRunArgs,
} from "@journeyman/core";
import { createLogger } from "@journeyman/core";
import type { ConductorClient } from "./conductor-client.ts";
import type { IFlowJsonConverter } from "@journeyman/core";
import type { ConductorWorkflowDef } from "../../flow-json/conductor-types.ts";

const log = createLogger("orchestrator:conductor");

interface FlowRetryPolicy { maxAttempts?: number; backoffSeconds?: number }

function readFlowRetry(def: FlowGraph): FlowRetryPolicy | undefined {
  const start = def.nodes.find((n) => n.type === "start");
  return (start?.config as { flowRetry?: FlowRetryPolicy } | undefined)?.flowRetry;
}

export interface ConductorOrchestratorDeps {
  client: ConductorClient;
  converter: IFlowJsonConverter<ConductorWorkflowDef>;
  runs: IRunStore;
  runGrants: IRunGrantsStore;
}

export class ConductorOrchestrator implements IOrchestratorEngine, IPauseableEngine, IRetryableEngine {
  /** runIds with a pending flowRetry timer — guards against the syncer firing multiple retries. Transient by design. */
  private flowRetryPending = new Set<string>();

  constructor(private deps: ConductorOrchestratorDeps) {}

  async submit(args: SubmitRunArgs): Promise<{ runId: string; engineWorkflowId: string }> {
    const versionSuffix = args.flowVersionId ? args.flowVersionId.replace(/-/g, "_") : "unknown";
    const wfName = `journeyman_v${versionSuffix}`;
    const wfDef = this.deps.converter.toEngineJson(args.definitionSnapshot, {
      workflowName: wfName, workflowVersion: 1,
    });

    await this.deps.client.putWorkflowDef(wfDef);

    const run = await this.deps.runs.create({
      flowId: args.flowId,
      flowVersionId: args.flowVersionId,
      flowNameSnapshot: args.flowNameSnapshot,
      flowScopeSnapshot: args.flowScopeSnapshot,
      definitionSnapshot: args.definitionSnapshot,
      triggerSource: "api",
      startedByUserId: args.startedByUserId,
      startedByOrgId: args.startedByOrgId,
      inputs: args.inputs,
    });

    // Write run grants: ('user', starter, 'owner') always; ('org', org, 'viewer') when known.
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
    if (grantsToWrite.length > 0) await this.deps.runGrants.createForRun(run.id, grantsToWrite);

    const engineWorkflowId = await this.deps.client.startWorkflow({
      name: wfName, version: 1, input: args.inputs,
    });

    await this.deps.runs.setEngineWorkflowId(run.id, engineWorkflowId);
    await this.deps.runs.setStatus(run.id, "running");

    return { runId: run.id, engineWorkflowId };
  }

  async getRun(runId: string): Promise<Run | null> {
    return await this.deps.runs.getById(runId);
  }

  async cancel(runId: string, reason?: string): Promise<void> {
    const r = await this.deps.runs.getById(runId);
    if (!r?.engineWorkflowId) return;
    await this.deps.client.terminate(r.engineWorkflowId, reason);
    await this.deps.runs.setStatus(runId, "cancelled");
  }

  async pause(runId: string): Promise<void> {
    const r = await this.deps.runs.getById(runId);
    if (!r?.engineWorkflowId) return;
    await this.deps.client.pauseWorkflow(r.engineWorkflowId);
    await this.deps.runs.setStatus(runId, "paused");
  }

  async resume(runId: string): Promise<void> {
    const r = await this.deps.runs.getById(runId);
    if (!r?.engineWorkflowId) return;
    await this.deps.client.resumeWorkflow(r.engineWorkflowId);
    await this.deps.runs.setStatus(runId, "running");
  }

  async retryFromTask(runId: string, nodeId: string | undefined): Promise<void> {
    const r = await this.deps.runs.getById(runId);
    if (!r?.engineWorkflowId) throw new Error("Run has no engine workflow id");
    await this.deps.client.retryWorkflow(r.engineWorkflowId, { taskId: nodeId });
    await this.deps.runs.setStatus(runId, "running");
  }

  async syncStatus(runId: string): Promise<RunStatus> {
    const r = await this.deps.runs.getById(runId);
    if (!r?.engineWorkflowId) return r?.status ?? "pending";
    const live = await this.deps.client.getWorkflow(r.engineWorkflowId);
    const mapped = mapConductorStatus(live.status);

    if (mapped === "failed" && this.shouldFlowRetry(r)) {
      this.scheduleFlowRetry(r);
      return "running";
    }

    if (mapped !== r.status) {
      const completedAt = ["completed", "failed", "cancelled"].includes(mapped)
        ? new Date() : undefined;
      const durationMs = completedAt && r.startedAt
        ? completedAt.getTime() - r.startedAt.getTime() : undefined;
      await this.deps.runs.setStatus(runId, mapped, {
        completedAt, durationMs,
        outputs: live.output,
      });
    }
    return mapped;
  }

  private shouldFlowRetry(r: Run): boolean {
    if (this.flowRetryPending.has(r.id)) return true;
    const policy = readFlowRetry(r.definitionSnapshot);
    if (!policy) return false;
    const max = policy.maxAttempts ?? 1;
    return r.attemptNumber < max;
  }

  private scheduleFlowRetry(r: Run): void {
    if (this.flowRetryPending.has(r.id)) return;
    const policy = readFlowRetry(r.definitionSnapshot);
    if (!policy) return;
    this.flowRetryPending.add(r.id);
    const delayMs = (policy.backoffSeconds ?? 0) * 1000;
    const nextAttempt = r.attemptNumber + 1;
    log.info({ runId: r.id, attempt: nextAttempt, delayMs }, "flow-retry scheduled");
    setTimeout(async () => {
      try {
        if (!r.engineWorkflowId) return;
        await this.deps.client.retryWorkflow(r.engineWorkflowId);
        await this.deps.runs.setAttemptNumber(r.id, nextAttempt);
        log.info({ runId: r.id, attempt: nextAttempt }, "flow-retry triggered");
      } catch (err) {
        log.error({ runId: r.id, err: (err as Error)?.message }, "flow-retry failed");
      } finally {
        this.flowRetryPending.delete(r.id);
      }
    }, delayMs);
  }
}

function mapConductorStatus(s: string): RunStatus {
  switch (s) {
    case "RUNNING": return "running";
    case "COMPLETED": return "completed";
    case "FAILED": case "TIMED_OUT": return "failed";
    case "PAUSED": return "paused";
    case "TERMINATED": return "cancelled";
    default: return "pending";
  }
}
