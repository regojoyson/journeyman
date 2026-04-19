/**
 * @file pipeline.ts
 * Core pipeline orchestrator — run lifecycle, step execution, retry, resume, and recovery.
 *
 * Pipeline is the central class that turns a FlowDefinition + trigger into a PipelineRun.
 * It owns:
 * - `run()`    — start a new run, execute all steps in order, persist state after each step.
 * - `resume()` — continue a blocked run from the step after the blocked one, using the
 *                frozen flowSnapshot so the run is not sensitive to config changes after start.
 * - `cancel()` — abort an in-flight run via AbortController.
 * - `recover()` (static) — on server startup, mark any runs that were mid-execution when
 *                the process crashed as failed so they don't remain stuck in "running".
 *
 * Step execution loop:
 *   for each step → runStepWithAttempts → runPhaseSafe (catches thrown errors)
 *   → ok: continue | blocked: halt + persist | failed: apply onFailure policy
 *
 * Retry: `step.retry.attempts` controls how many total attempts are made; `backoffMs`
 * is a fixed delay between them. Exponential backoff is deferred to a future version.
 *
 * Timeouts: `step.timeoutMs` is composed with the run-level AbortSignal via `anySignal`.
 *
 * Cleanup: if `deps.cleanupOn` lists the terminal status, the workspace directory is
 * deleted after the run finishes. Artifact storage is not touched.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type {
  FlowDefinition, FlowStepDefinition, IPhase, IStateStore, ITraceLogger,
  IArtifactStore, PhaseResult, PipelineEvent, PipelineRun, PipelineTrigger,
  ProductConfig, StepRecord,
} from "@journeyman/core";
import type { PhaseRegistry } from "./registry/phase-registry.ts";
import type { ResolvedProviders } from "./registry/provider-registry.ts";
import type { EventBus } from "./event-bus.ts";
import { buildContext } from "./context.ts";
import { anySignal } from "./lib/any-signal.ts";

export type PipelineDeps = {
  phases: PhaseRegistry;
  state: IStateStore;
  trace: ITraceLogger;
  artifactStore: IArtifactStore;
  bus: EventBus;
  resolveProviders: (flow: FlowDefinition, productConfig: ProductConfig) => ResolvedProviders;
  getProductConfig: (productId: string) => ProductConfig;
  cleanupOn?: Array<PipelineRun["status"]>;
};

export type RunArgs = { trigger: PipelineTrigger; flow: FlowDefinition };

export class Pipeline {
  private aborters = new Map<string, AbortController>();

  constructor(private readonly deps: PipelineDeps) {}

  listRunning(): string[] {
    return [...this.aborters.keys()];
  }

  cancel(sessionId: string): void {
    const ac = this.aborters.get(sessionId);
    if (ac) ac.abort();
  }

  isRunning(sessionId: string): boolean {
    return this.aborters.has(sessionId);
  }

  async run({ trigger, flow }: RunArgs): Promise<PipelineRun> {
    const now = () => new Date().toISOString();
    const sessionId = randomUUID();
    const productConfig = this.deps.getProductConfig(trigger.productId);
    const workspaceDir = join(productConfig.workspace, "runs", sessionId);
    mkdirSync(workspaceDir, { recursive: true });

    const run: PipelineRun = {
      sessionId,
      productId: trigger.productId,
      ticketKey: trigger.ticketKey,
      ticketShortKey: trigger.ticketShortKey,
      flowName: flow.name,
      flowSnapshot: flow,
      status: "running",
      currentStep: null,
      steps: [],
      artifacts: {},
      createdAt: now(),
      updatedAt: now(),
    };
    await this.deps.state.save(run);
    this.emit({ type: "runStarted", sessionId, ticketKey: run.ticketKey, flowName: run.flowName, at: now() });

    const ac = new AbortController();
    this.aborters.set(sessionId, ac);

    try {
      const providers = this.deps.resolveProviders(flow, productConfig);
      const ctx = buildContext({
        run, signal: ac.signal, workspaceDir, productConfig, providers,
        trace: this.deps.trace, artifactStore: this.deps.artifactStore,
        emit: (e) => this.emit(e),
      });

      for (const step of flow.steps) {
        if (ac.signal.aborted) { await this.finish(run, "cancelled"); return run; }
        const result = await this.runStepWithAttempts(run, step, ctx, ac.signal);
        if (ac.signal.aborted) { await this.finish(run, "cancelled"); return run; }
        if (result.status === "blocked") { await this.finish(run, "blocked"); return run; }
        if (result.status === "failed") {
          const onFail = step.onFailure ?? "fail";
          if (onFail === "skip") continue;
          if (onFail === "block") { await this.finish(run, "blocked"); return run; }
          await this.finish(run, "failed");
          return run;
        }
      }
      await this.finish(run, "completed");
      return run;
    } catch (err: any) {
      // Setup-time failure (provider construction, ctx build). Convert to failed.
      if (run.status === "running") {
        run.artifacts._setupError = { message: err?.message ?? String(err) };
        await this.finish(run, "failed");
      }
      throw err;
    } finally {
      this.aborters.delete(sessionId);
      if ((this.deps.cleanupOn ?? []).includes(run.status)) {
        try { rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  }

  private async runStepWithAttempts(
    run: PipelineRun,
    step: FlowStepDefinition,
    ctx: ReturnType<typeof buildContext>,
    baseSignal: AbortSignal,
  ): Promise<PhaseResult> {
    const maxAttempts = (step.retry?.attempts ?? 0) + 1;
    let last: PhaseResult = { status: "failed", error: { message: "no attempts" } };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const rec: StepRecord = {
        id: step.id,
        phase: step.phase,
        attempt,
        status: "running",
        startedAt: new Date().toISOString(),
        input: step.config,
      };
      run.steps.push(rec);
      run.currentStep = step.id;
      run.updatedAt = new Date().toISOString();
      await this.deps.state.save(run);
      ctx.emit({
        type: "stepStarted",
        sessionId: run.sessionId,
        stepId: step.id,
        phase: step.phase,
        attempt,
        at: rec.startedAt!,
      });

      const stepSignal = step.timeoutMs
        ? anySignal([baseSignal, AbortSignal.timeout(step.timeoutMs)])
        : baseSignal;
      const stepCtx = { ...ctx, signal: stepSignal };

      last = await this.runPhaseSafe(this.deps.phases.resolve(step.phase), stepCtx, step);

      const endedAt = new Date().toISOString();
      rec.endedAt = endedAt;
      rec.durationMs = new Date(endedAt).getTime() - new Date(rec.startedAt!).getTime();

      if (last.status === "ok") {
        rec.status = "ok";
        rec.output = last.artifacts;
        Object.assign(run.artifacts, last.artifacts);
      } else if (last.status === "blocked") {
        rec.status = "blocked";
        rec.blockedReason = last.reason;
        rec.waitFor = last.waitFor;
      } else {
        rec.status = "failed";
        rec.error = last.error;
      }
      await this.deps.state.save(run);
      ctx.emit({
        type: "stepEnded",
        sessionId: run.sessionId,
        stepId: step.id,
        phase: step.phase,
        attempt,
        status: rec.status,
        durationMs: rec.durationMs,
        at: endedAt,
      });

      if (last.status === "ok" || last.status === "blocked") return last;
      if (attempt < maxAttempts) await sleep(step.retry?.backoffMs ?? 0);
    }
    return last;
  }

  private async runPhaseSafe(
    phase: IPhase,
    ctx: ReturnType<typeof buildContext>,
    step: FlowStepDefinition,
  ): Promise<PhaseResult> {
    try {
      return await phase.run(ctx, step.config ?? {});
    } catch (err: any) {
      return { status: "failed", error: { message: err?.message ?? String(err), stack: err?.stack } };
    }
  }

  private async finish(run: PipelineRun, status: PipelineRun["status"]): Promise<void> {
    const at = new Date().toISOString();
    const from = run.status;
    run.status = status;
    run.currentStep = null;
    run.updatedAt = at;
    await this.deps.state.save(run);
    this.emit({ type: "statusChanged", sessionId: run.sessionId, from, to: status, at });
    this.emit({ type: "runEnded", sessionId: run.sessionId, status, at });
  }

  private emit(e: PipelineEvent): void {
    this.deps.bus.publish(e);
  }

  /** Mark any runs that were mid-execution when the process died as failed. */
  static async recover(state: IStateStore): Promise<void> {
    const targets = [
      ...(await state.find({ status: "running" })),
      ...(await state.find({ status: "cancelling" })),
    ];
    const now = new Date().toISOString();
    for (const r of targets) {
      for (const s of r.steps) {
        if (s.status === "running") {
          s.status = "failed";
          s.endedAt = now;
          s.error = { message: "process crashed mid-step", code: "process-crash" };
        }
      }
      r.status = "failed";
      r.currentStep = null;
      r.updatedAt = now;
      await state.save(r);
    }
  }

  /** Resume a blocked run from the step after the blocked one. Uses flowSnapshot. */
  async resume(sessionId: string): Promise<PipelineRun> {
    const run = await this.deps.state.load(sessionId);
    if (!run) throw new Error(`no such run ${sessionId}`);
    if (run.status !== "blocked") throw new Error(`cannot resume ${sessionId}: status=${run.status}`);

    const productConfig = this.deps.getProductConfig(run.productId);
    const flow = run.flowSnapshot;
    const workspaceDir = join(productConfig.workspace, "runs", sessionId);
    mkdirSync(workspaceDir, { recursive: true });

    const ac = new AbortController();
    this.aborters.set(sessionId, ac);
    const providers = this.deps.resolveProviders(flow, productConfig);
    const ctx = buildContext({
      run, signal: ac.signal, workspaceDir, productConfig, providers,
      trace: this.deps.trace, artifactStore: this.deps.artifactStore,
      emit: (e) => this.emit(e),
    });

    const blockedRec = [...run.steps].reverse().find(s => s.status === "blocked");
    if (!blockedRec) throw new Error(`resume: no blocked step in run ${sessionId}`);
    const flowIdx = flow.steps.findIndex(s => s.id === blockedRec.id);
    if (flowIdx < 0) throw new Error(`resume: blocked step id "${blockedRec.id}" not in flow snapshot`);
    const remaining = flow.steps.slice(flowIdx + 1);

    const now = () => new Date().toISOString();
    const from = run.status;
    run.status = "running";
    run.updatedAt = now();
    await this.deps.state.save(run);
    this.emit({ type: "statusChanged", sessionId, from, to: "running", at: now() });

    try {
      for (const step of remaining) {
        if (ac.signal.aborted) { await this.finish(run, "cancelled"); return run; }
        const result = await this.runStepWithAttempts(run, step, ctx, ac.signal);
        if (result.status === "blocked") { await this.finish(run, "blocked"); return run; }
        if (result.status === "failed") {
          const onFail = step.onFailure ?? "fail";
          if (onFail === "skip") continue;
          if (onFail === "block") { await this.finish(run, "blocked"); return run; }
          await this.finish(run, "failed");
          return run;
        }
      }
      await this.finish(run, "completed");
      return run;
    } finally {
      this.aborters.delete(sessionId);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
