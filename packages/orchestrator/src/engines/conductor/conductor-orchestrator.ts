import type {
  IOrchestratorEngine, IRunStore, Run, RunStatus, SubmitRunArgs,
} from "@journeyman/core";
import type { ConductorClient } from "./conductor-client.ts";
import type { IFlowJsonConverter } from "@journeyman/core";
import type { ConductorWorkflowDef } from "../../flow-json/conductor-converter.ts";

export interface ConductorOrchestratorDeps {
  client: ConductorClient;
  converter: IFlowJsonConverter<ConductorWorkflowDef>;
  runs: IRunStore;
}

export class ConductorOrchestrator implements IOrchestratorEngine {
  constructor(private deps: ConductorOrchestratorDeps) {}

  async submit(args: SubmitRunArgs): Promise<{ runId: string; engineWorkflowId: string }> {
    const wfName = `journeyman_v${args.flowVersionId.replace(/-/g, "_")}`;
    const wfDef = this.deps.converter.toEngineJson(args.flowDefinition, {
      workflowName: wfName, workflowVersion: 1,
    });

    await this.deps.client.putWorkflowDef(wfDef);

    const run = await this.deps.runs.create({
      flowVersionId: args.flowVersionId,
      triggerSource: "api",
      startedByUserId: args.startedByUserId,
      inputs: args.inputs,
    });

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

  async syncStatus(runId: string): Promise<RunStatus> {
    const r = await this.deps.runs.getById(runId);
    if (!r?.engineWorkflowId) return r?.status ?? "pending";
    const live = await this.deps.client.getWorkflow(r.engineWorkflowId);
    const mapped = mapConductorStatus(live.status);
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
