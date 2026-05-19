import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "../middleware.ts";
import { makePlatformAdminService } from "../platform-admin.ts";

export function registerPlatformAdminRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });
  const svc = makePlatformAdminService(pool);

  app.get("/admin/users/:id/platform-admin", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!;
    if (!ctx.isPlatformAdmin) { reply.code(403); return { error: "forbidden" }; }
    const { id } = req.params as { id: string };
    return { value: await svc.isPlatformAdmin(id) };
  });

  app.patch("/admin/users/:id/platform-admin", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!;
    if (!ctx.isPlatformAdmin) { reply.code(403); return { error: "forbidden" }; }
    const { id } = req.params as { id: string };
    const body = req.body as { value?: unknown };
    if (typeof body?.value !== "boolean") { reply.code(400); return { error: "value_must_be_boolean" }; }
    try {
      await svc.setPlatformAdmin(id, body.value);
    } catch (e: any) {
      reply.code(409); return { error: e.message ?? "conflict" };
    }
    return { value: body.value };
  });
}
