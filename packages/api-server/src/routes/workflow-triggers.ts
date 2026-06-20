import type { FastifyInstance } from "fastify";
import { makeRequireAuth } from "@journeyman/identity";
import { isTriggerNode } from "@journeyman/core";
import type { Composition } from "../composition.ts";

interface TriggerSummary {
  id: string;
  type: "trigger-manual" | "trigger-webhook" | "trigger-human";
  webhook?: { id: string; name: string } | null;
}

export function registerWorkflowTriggersRoute(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });

  app.get("/workflows/:id/triggers", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const wf = await c.workflows.getById(id);
    if (!wf) { reply.code(404); return { error: "not_found" }; }

    // Editor shows the draft, so reflect the draft's trigger nodes here.
    const triggers = (wf.draftDefinition.nodes ?? []).filter(isTriggerNode);

    const summaries: TriggerSummary[] = await Promise.all(triggers.map(async (t): Promise<TriggerSummary> => {
      const base = { id: t.id, type: t.type as TriggerSummary["type"] };
      if (t.type === "trigger-webhook") {
        const cfg = (t.config ?? {}) as { webhookId?: string };
        const wh = cfg.webhookId ? await c.webhooks.getById(cfg.webhookId) : null;
        return { ...base, webhook: wh ? { id: wh.id, name: wh.name } : null };
      }
      return base;
    }));

    return { triggers: summaries };
  });
}
