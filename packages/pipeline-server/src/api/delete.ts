/**
 * @file delete.ts
 * DELETE /api/runs/:sessionId — remove a pipeline run and all its local data.
 *
 * Deletes (in order):
 *   1. Trace logs        (traceLogger.delete)
 *   2. Artifacts         (artifactStore.delete)
 *   3. Run workspace     (<productConfig.workspace>/runs/<sessionId>/)
 *   4. State record      (state.delete)
 *
 * Steps 1-3 run while the state record still exists so productId resolution works.
 *
 * Behavior for active runs:
 *   - If the run is still active (running / cancelling / blocked / queued), the API
 *     returns 409 UNLESS the caller passes `?force=true`.
 *   - With `?force=true`: cancel the run, wait up to `graceMs` (default 5s) for it
 *     to settle, then proceed with deletion even if it hasn't fully stopped.
 *
 * Does NOT touch upstream ticket state (GitHub/Jira) — this endpoint is local-only.
 * Returns 404 if no run exists, 204 on successful delete.
 */

import type { FastifyInstance } from "fastify";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { IStateStore, ITraceLogger, IArtifactStore, PipelineRun, PipelineConfig } from "@journeyman/core";

export type PipelineLike = {
  cancel(sessionId: string): void;
  isRunning(sessionId: string): boolean;
};

export type DeleteApiDeps = {
  pipeline: PipelineLike;
  state: IStateStore;
  trace: ITraceLogger;
  artifactStore: IArtifactStore;
  config: PipelineConfig;
  /** Milliseconds to wait for a cancelled run to settle before force-deleting. */
  graceMs?: number;
};

const ACTIVE: ReadonlySet<PipelineRun["status"]> = new Set(["queued", "running", "blocked", "cancelling"]);

export function registerDeleteApi(app: FastifyInstance, deps: DeleteApiDeps) {
  const graceMs = deps.graceMs ?? 5000;

  app.delete<{ Params: { sessionId: string }; Querystring: { force?: string } }>(
    "/api/runs/:sessionId",
    async (req, reply) => {
      const { sessionId } = req.params;
      const force = req.query.force === "true";

      const run = await deps.state.load(sessionId);
      if (!run) return reply.code(404).send({ error: "not_found", sessionId });

      const active = deps.pipeline.isRunning(sessionId) || ACTIVE.has(run.status);
      if (active && !force) {
        return reply.code(409).send({
          error: "run_active",
          sessionId,
          status: run.status,
          hint: "pass ?force=true to cancel and delete",
        });
      }

      if (active) {
        deps.pipeline.cancel(sessionId);
        await waitForSettled(deps.state, sessionId, graceMs);
      }

      await deps.trace.delete(sessionId).catch(() => { /* best-effort */ });
      await deps.artifactStore.delete(sessionId).catch(() => { /* best-effort */ });

      const product = deps.config.products[run.productId];
      if (product?.workspace) {
        const workspaceDir = join(product.workspace, "runs", sessionId);
        if (existsSync(workspaceDir)) {
          try { rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* best-effort */ }
        }
      }

      await deps.state.delete(sessionId);
      return reply.code(204).send();
    },
  );
}

async function waitForSettled(state: IStateStore, sessionId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await state.load(sessionId);
    if (!r || !ACTIVE.has(r.status)) return;
    await new Promise((res) => setTimeout(res, 200));
  }
}
