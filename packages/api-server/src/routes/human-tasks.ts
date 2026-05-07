import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import {
  resolveHumanTask,
  HumanTaskNotWaitingError,
  HumanTaskMissingValueError,
} from "../services/resolve-human-task.ts";
import { reconcileRun } from "../services/engine-reconciler.ts";

export function registerHumanTaskRoutes(app: FastifyInstance, c: Composition): void {
  app.post("/runs/:runId/human-tasks/:nodeId/resolve", async (req, reply) => {
    const { runId, nodeId } = req.params as { runId: string; nodeId: string };
    const body = (req.body ?? {}) as {
      values?: Record<string, unknown>;
      data?: unknown;
      comment?: string;
    };

    // Make sure DB reflects current Conductor state before we try to resolve.
    await reconcileRun(c, runId);

    const session = (req as unknown as { session?: { userId?: string | null } }).session;
    const actor = session?.userId ?? null;

    const values: Record<string, unknown> = { ...(body.values ?? {}) };
    // Convenience: if the caller passes top-level `comment` / `data`, fold them
    // into the payload object even if the human-task didn't declare them as
    // outputs — keeps the manual form compatible with simple "comment-only" use.
    const payload: Record<string, unknown> = {
      ...(body.values ?? {}),
      ...(body.comment !== undefined ? { comment: body.comment } : {}),
      ...(body.data !== undefined ? { data: body.data } : {}),
    };

    try {
      await resolveHumanTask(c, {
        runId,
        nodeId,
        values,
        payload,
        actor,
        source: "manual",
      });
    } catch (err) {
      if (err instanceof HumanTaskMissingValueError) {
        reply.code(400);
        return { error: "missing_required_values", missing: err.missing };
      }
      if (err instanceof HumanTaskNotWaitingError) {
        reply.code(409);
        return { error: "not_waiting" };
      }
      throw err;
    }

    reply.code(200);
    return { status: "resolved" };
  });
}
