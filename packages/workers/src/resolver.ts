import type { ResolvedWorker, WorkerRecord } from "@journeyman/core";
import type { Queryable } from "./db.ts";
import { fetchWorkerById, fetchDefaultWorker } from "./db.ts";

export class WorkerNotFoundError extends Error {}

export interface ResolveWorkerCtx {
  orgId: string;
  userId: string;
}

function toResolved(w: WorkerRecord): ResolvedWorker {
  return {
    id: w.id,
    type: w.type,
    executionMode: w.executionMode,
    connectivity: w.connectivity ?? undefined,
    config: w.config,
  };
}

/**
 * Resolve a workflow's worker at run start: an explicit `workerId` (node override
 * or flow default), or the org/user/system default when none is given.
 */
export async function resolveWorker(
  db: Queryable,
  ctx: ResolveWorkerCtx,
  workerId: string | undefined,
): Promise<ResolvedWorker> {
  if (workerId) {
    const w = await fetchWorkerById(db, ctx.orgId, ctx.userId, workerId);
    if (!w) throw new WorkerNotFoundError(`worker '${workerId}' not found or not visible`);
    return toResolved(w);
  }
  const def = await fetchDefaultWorker(db, ctx.orgId, ctx.userId);
  if (!def) throw new WorkerNotFoundError("no default worker configured");
  return toResolved(def);
}
