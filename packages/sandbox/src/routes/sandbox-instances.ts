import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { listActiveSandboxes, getSandbox, markSandboxDestroyed, type SandboxRecord } from "../sandbox-store.ts";

export interface SandboxRoutesDeps {
  /** Destroy a sandbox's container + volume (backend-specific). */
  destroy: (sb: SandboxRecord) => Promise<void>;
  /** True while a run is still active (to detect orphans). */
  isRunActive: (runId: string) => Promise<boolean>;
}

export async function registerSandboxRoutes(app: FastifyInstance, pool: Pool, deps: SandboxRoutesDeps): Promise<void> {
  const requireAuth = makeRequireAuth({ pool });

  // List active sandboxes (admin).
  app.get("/api/sandboxes", { preHandler: requireAuth({ role: "admin" }) }, async () => {
    return listActiveSandboxes(pool);
  });

  // Force-destroy one sandbox by runId (admin).
  app.delete("/api/sandboxes/:runId", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const sb = await getSandbox(pool, runId);
    if (!sb || sb.status !== "active") return reply.code(404).send({ error: "Not found" });
    await deps.destroy(sb);
    await markSandboxDestroyed(pool, runId);
    return { ok: true };
  });

  // Prune all orphaned sandboxes (run no longer active) (admin).
  app.post("/api/sandboxes/prune", { preHandler: requireAuth({ role: "admin" }) }, async () => {
    const active = await listActiveSandboxes(pool);
    const pruned: string[] = [];
    for (const sb of active) {
      if (await deps.isRunActive(sb.runId)) continue;
      try {
        await deps.destroy(sb);
        await markSandboxDestroyed(pool, sb.runId);
        pruned.push(sb.runId);
      } catch { /* skip; next sweep retries */ }
    }
    return { pruned };
  });
}
