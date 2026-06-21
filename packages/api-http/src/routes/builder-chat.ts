import type { FastifyInstance } from "fastify";
import { makeRequireAuth } from "@journeyman/identity";

import { listVisibleSandboxes } from "@journeyman/sandbox";
import { listCustomAiSteps } from "@journeyman/custom-steps";
import { listMcpInstances } from "@journeyman/mcp";
import { listSkillPackages } from "@journeyman/skills";
import {
  PROVIDER_CATALOG, listSupportedNodeTypes, type BuildPlan,
} from "@journeyman/core";
import {
  getBuilderSession, updateBuilderSession,
  serializeStepCatalog, serializeProviders, serializeNodeTypes, serializeInventory,
  buildSystemPrompt, buildContextMessage,
  resolveBuilderModel, builderLlmEnvFromProcess, makeAiSdkCaller, runBuilderTurn,
  type ChatMessage, type InventorySummary,
} from "@journeyman/builder";
import { stepCatalog } from "@journeyman/steps/catalog";
import type { Composition } from "@journeyman/api-context";
import { openSseStream } from "@journeyman/api-context";

const PING_MS = 15_000;

async function resolveDefaultWorkspaceId(pool: import("pg").Pool, orgId: string): Promise<string | null> {
  const res = await pool.query<{ id: string }>(
    "SELECT id FROM jm_workspaces WHERE org_id = $1 AND slug = 'default' LIMIT 1",
    [orgId],
  );
  return res.rows[0]?.id ?? null;
}

async function loadInventory(c: Composition, orgId: string): Promise<InventorySummary> {
  const pool = c.pool!;
  const sandboxes = await listVisibleSandboxes(pool, orgId);
  const workspaceId = await resolveDefaultWorkspaceId(pool, orgId);
  const [skills, mcps, customSteps, webhooks] = workspaceId
    ? await Promise.all([
        listSkillPackages(pool, workspaceId),
        listMcpInstances(pool, workspaceId),
        listCustomAiSteps(pool, workspaceId),
        c.webhooks.listByWorkspace(workspaceId),
      ])
    : [[], [], [], []];
  return {
    customSteps: customSteps.map((s) => ({ id: s.id, name: s.name, description: s.description ?? "" })),
    mcps: mcps.map((m) => ({ id: m.id, name: m.name })),
    skills: skills.map((s) => ({ id: s.id, name: s.name })),
    sandboxes: sandboxes.map((s) => ({ id: s.id, name: s.name, type: s.type, tags: s.tags })),
    webhooks: webhooks.map((w) => ({ id: w.id, name: w.name ?? w.id, preset: w.preset })),
  };
}

function buildContext(inventory: InventorySummary): string {
  const catalog = serializeStepCatalog(stepCatalog.map((s) => ({
    stepType: s.stepType, label: s.label, category: s.category,
    inputs: Object.keys(s.inputFields ?? {}),
    outputs: Object.keys(s.outputSchema ?? {}),
  })));
  const providers = serializeProviders(
    PROVIDER_CATALOG.filter((p) => p.implemented).map((p) => ({ kind: p.kind, value: p.value, label: p.label })),
  );
  const nodeTypes = serializeNodeTypes(listSupportedNodeTypes());
  return buildContextMessage({ catalog, providers, nodeTypes, inventory: serializeInventory(inventory) });
}

export function registerBuilderChatRoute(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });

  app.post("/orgs/:orgId/users/me/builder/sessions/:id/messages",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { message?: string };
      if (!body?.message) return reply.code(400).send({ error: "message is required" });

      const session = await getBuilderSession(c.pool!, id, orgId, ctx.user.id);
      if (!session) return reply.code(404).send({ error: "Not found" });

      const stream = openSseStream(reply);
      const ping = setInterval(() => stream.ping(), PING_MS);
      let closed = false;
      reply.raw.on("close", () => { closed = true; clearInterval(ping); });

      try {
        const history = (session.messages as ChatMessage[]) ?? [];
        const messages: ChatMessage[] = [...history, { role: "user", content: body.message }];

        const model = await resolveBuilderModel(builderLlmEnvFromProcess());
        const inventory = await loadInventory(c, orgId);
        const system = `${buildSystemPrompt()}\n\n${buildContext(inventory)}`;

        const { assistantMessage, plan } = await runBuilderTurn(
          { caller: makeAiSdkCaller(model) },
          { system, messages },
        );
        if (closed) return;

        stream.send({ event: "assistant", data: { message: assistantMessage } });
        if (plan) stream.send({ event: "plan", data: plan as BuildPlan });

        const newMessages: ChatMessage[] = [...messages, { role: "assistant", content: assistantMessage }];
        await updateBuilderSession(c.pool!, {
          id, orgId, userId: ctx.user.id,
          messages: newMessages,
          buildPlan: plan ?? undefined,
        });
        stream.send({ event: "done", data: { ok: true } });
      } catch (err) {
        if (!closed) stream.send({ event: "error", data: { message: (err as Error).message } });
      } finally {
        clearInterval(ping);
        await stream.close();
      }
    });
}
