import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { listActiveSandboxInstances, getSandboxInstance, markSandboxInstanceDestroyed, type SandboxInstanceRecord } from "../sandbox-instance-store.ts";

export interface SandboxInstanceRoutesDeps {
  /** Destroy a sandbox's container + volume (backend-specific). */
  destroy: (sb: SandboxInstanceRecord) => Promise<void>;
  /** True while a run is still active (to detect orphans). */
  isRunActive: (runId: string) => Promise<boolean>;
}

export async function registerSandboxInstanceRoutes(app: FastifyInstance, pool: Pool, deps: SandboxInstanceRoutesDeps): Promise<void> {
  const requireAuth = makeRequireAuth({ pool });

  // List active sandboxes (admin).
  app.get("/api/sandbox-instances", { preHandler: requireAuth({ role: "admin" }) }, async () => {
    return listActiveSandboxInstances(pool);
  });

  // Force-destroy one sandbox by runId (admin).
  app.delete("/api/sandbox-instances/:runId", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const sb = await getSandboxInstance(pool, runId);
    if (!sb || sb.status !== "active") return reply.code(404).send({ error: "Not found" });
    await deps.destroy(sb);
    await markSandboxInstanceDestroyed(pool, runId);
    return { ok: true };
  });

  // Prune all orphaned sandboxes (run no longer active) (admin).
  app.post("/api/sandbox-instances/prune", { preHandler: requireAuth({ role: "admin" }) }, async () => {
    const active = await listActiveSandboxInstances(pool);
    const pruned: string[] = [];
    for (const sb of active) {
      if (await deps.isRunActive(sb.runId)) continue;
      try {
        await deps.destroy(sb);
        await markSandboxInstanceDestroyed(pool, sb.runId);
        pruned.push(sb.runId);
      } catch { /* skip; next sweep retries */ }
    }
    return { pruned };
  });
}
