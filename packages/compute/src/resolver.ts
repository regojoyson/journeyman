import type { ResolvedComputeTarget, ComputeTarget } from "@journeyman/core";
import type { Queryable } from "./db.ts";
import { fetchComputeTargetById } from "./db.ts";

export class ComputeTargetNotFoundError extends Error {}

export interface ResolveComputeTargetCtx {
  orgId: string;
  userId: string;
}

function toResolved(w: ComputeTarget): ResolvedComputeTarget {
  return {
    id: w.id,
    type: w.type,
    executionMode: w.executionMode,
    connectivity: w.connectivity ?? undefined,
    config: w.config,
    imageState: w.imageState,
    imageRef: w.imageRef,
    imageError: w.imageError,
  };
}

/**
 * Resolve a workflow's worker at run start: an explicit `workerId` (node override
 * or flow default), or the org/user/system default when none is given.
 */
export async function resolveComputeTarget(
  db: Queryable,
  ctx: ResolveComputeTargetCtx,
  workerId: string | undefined,
): Promise<ResolvedComputeTarget> {
  if (!workerId) {
    throw new ComputeTargetNotFoundError("no compute target selected for this workflow");
  }
  const w = await fetchComputeTargetById(db, ctx.orgId, ctx.userId, workerId);
  if (!w) throw new ComputeTargetNotFoundError(`compute target '${workerId}' not found or not visible`);
  return toResolved(w);
}
