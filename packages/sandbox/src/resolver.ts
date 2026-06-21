import type { ResolvedSandbox, Sandbox } from "@journeyman/core";
import type { Queryable } from "./db.ts";
import { fetchSandboxById } from "./db.ts";

export class SandboxNotFoundError extends Error {}

export interface ResolveSandboxCtx {
  orgId: string;
}

function toResolved(w: Sandbox): ResolvedSandbox {
  return {
    id: w.id,
    type: w.type,
    executionMode: w.executionMode,
    connectivity: w.connectivity ?? undefined,
    config: w.config,
    imageState: w.imageState,
    imageFingerprint: w.imageFingerprint,
    imageRef: w.imageRef,
    imageError: w.imageError,
    maxConcurrentInstances: w.maxConcurrentInstances ?? null,
  };
}

/**
 * Resolve a workflow's worker at run start: an explicit `workerId` (node override
 * or flow default), or the org/user/system default when none is given.
 */
export async function resolveSandbox(
  db: Queryable,
  ctx: ResolveSandboxCtx,
  workerId: string | undefined,
): Promise<ResolvedSandbox> {
  if (!workerId) {
    throw new SandboxNotFoundError("no sandbox selected for this workflow");
  }
  const w = await fetchSandboxById(db, ctx.orgId, workerId);
  if (!w) throw new SandboxNotFoundError(`sandbox '${workerId}' not found or not visible`);
  return toResolved(w);
}
