import { createLogger } from "@journeyman/core";
import type {
  ICredentialStore, IEventBus, IPhaseRegistry, IWorkspaceProvider,
} from "@journeyman/core";
import type { ConductorClient } from "../engines/conductor/conductor-client.ts";
import { VisitCounter } from "./visit-counter.ts";

const log = createLogger("orchestrator:worker");

export interface WorkerHarnessDeps {
  client: ConductorClient;
  registry: IPhaseRegistry;
  workspace: IWorkspaceProvider;
  credentials: ICredentialStore;
  events: IEventBus;
  workerId: string;
  pollIntervalMs?: number;
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
    await this.deps.client.ackTask(task.taskId, this.deps.workerId);

    const handler = this.deps.registry.get(phaseType);
    if (!handler) {
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
    const nodeId = task.taskDefName;
    const userId = ((task.inputData ?? {}) as { startedByUserId?: string | null }).startedByUserId ?? null;
    const ws = await this.deps.workspace.create({ runId, nodeId, userId });
    const abort = new AbortController();

    const flowId = ((task.inputData ?? {}) as { flowId?: string | null }).flowId ?? null;
    const declaredCreds = ((task.inputData ?? {}) as { credentials?: Record<string, string> }).credentials ?? {};
    let resolvedEnv: Record<string, string>;
    try {
      resolvedEnv = await this.deps.credentials.resolve(declaredCreds, { userId, flowId });
    } catch (err: any) {
      const isCredErr =
        err?.name === "CredentialNotFoundError" || err?.name === "MissingSecretsError";
      if (isCredErr) {
        const missing: string[] = err.missing ?? (err.ref ? [String(err.ref)] : []);
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
    await this.deps.events.append({
      runId, nodeId, eventType: "phase.started",
      payload: { attempt: task.retryCount + 1 },
    });

    try {
      const runInputs = ((task.inputData as { __workflowInput?: Record<string, unknown> } | undefined)?.__workflowInput) ?? {};
      const result = await handler.run(task.inputData, {
        runId, nodeId, attempt: task.retryCount + 1,
        workspaceDir: ws.path, signal: abort.signal,
        env: { ...(process.env as Record<string, string>), ...resolvedEnv },
        runInputs,
        log: (line, meta) => {
          this.deps.events.append({
            runId, nodeId, eventType: "phase.log", payload: { line, meta },
          }).catch(err => log.error(err, "log emit failed"));
        },
      });

      if (result.kind === "success") {
        await this.deps.events.append({
          runId, nodeId, eventType: "phase.completed",
          payload: { output: result.output },
        });
        await this.deps.client.completeTask({
          workflowInstanceId: runId, taskId: task.taskId,
          status: "COMPLETED", outputData: result.output,
        });
      } else {
        const retry = ((task.inputData ?? {}) as { retry?: { retryOn?: string[]; stopOn?: string[] } }).retry ?? {};
        const cls = result.failure.errorClass ?? "Error";
        const matchesAny = (patterns?: string[]) =>
          Array.isArray(patterns) && patterns.some(p => {
            try { return new RegExp(p).test(cls); } catch { return false; }
          });
        const stop = matchesAny(retry.stopOn);
        const retryable = !stop && (result.failure.retryable ?? matchesAny(retry.retryOn));

        await this.deps.events.append({
          runId, nodeId, eventType: "phase.failed",
          payload: { error: result.failure, classified: { retryable, stop } },
        });
        await this.deps.client.completeTask({
          workflowInstanceId: runId, taskId: task.taskId,
          status: retryable ? "FAILED" : "FAILED_WITH_TERMINAL_ERROR",
          reasonForIncompletion: result.failure.message,
        });
      }
    } catch (err: any) {
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
