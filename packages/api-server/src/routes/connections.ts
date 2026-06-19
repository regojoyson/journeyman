import type { FastifyInstance } from "fastify";
import type { Composition } from "../composition.ts";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import { seal, open } from "@journeyman/secrets";
import { GitHubProvider, GitLabProvider } from "@journeyman/git-provider";
import type { IGitProvider, ConnectionCategory } from "@journeyman/core";
import {
  insertConnection,
  getConnection,
  getConnectionSealed,
  listConnections,
  updateConnection,
  deleteConnection,
  agentsUsingConnection,
  DuplicateConnectionError,
} from "@journeyman/connections";
import { audit } from "../services/audit.ts";

function gitProviderFor(provider: string, token: string, baseUrl?: string): IGitProvider {
  if (provider === "gitlab") return new GitLabProvider({ token, baseUrl });
  return new GitHubProvider({ token });
}

export function registerConnectionRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });
  const requirePerm = makeRequireWorkspacePermission({ pool: c.pool! });
  const read = { preHandler: [requireAuth(), requirePerm("resource.read")] };
  const write = { preHandler: [requireAuth(), requirePerm("resource.write")] };
  const pool = c.pool!;

  /** Load a connection and 404 unless it belongs to the route's workspace. */
  async function loadConn(id: string, wsId: string) {
    const conn = await getConnection(pool, id);
    if (!conn || conn.workspaceId !== wsId) return null;
    return conn;
  }

  app.get("/workspaces/:wsId/connections", read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    const category = (req.query as { category?: ConnectionCategory })?.category;
    return listConnections(pool, wsId, category);
  });

  app.post("/workspaces/:wsId/connections", write, async (req, reply) => {
    const { wsId } = req.params as { wsId: string };
    const ctx = req.runContext!;
    const body = req.body as {
      category?: ConnectionCategory;
      provider?: string;
      label?: string;
      baseUrl?: string;
      credential?: string;
      config?: Record<string, unknown>;
    };
    if (!body?.category || !body?.provider || !body?.label?.trim() || !body?.credential) {
      reply.code(400).send({ error: "missing_fields" });
      return;
    }
    try {
      const conn = await insertConnection(pool, {
        workspaceId: wsId,
        orgId: ctx.workspace!.orgId,
        category: body.category,
        provider: body.provider,
        label: body.label.trim(),
        baseUrl: body.baseUrl,
        credential: seal(body.credential),
        config: body.config ?? {},
        createdBy: ctx.user.id,
      });
      await audit(pool, { orgId: ctx.workspace!.orgId, actorUserId: ctx.user.id, action: "connection.create", targetType: "connection", targetId: conn.id, detail: { category: body.category, provider: body.provider, label: conn.label } });
      reply.code(201);
      return conn;
    } catch (err) {
      if (err instanceof DuplicateConnectionError) {
        reply.code(409).send({ error: "duplicate_label" });
        return;
      }
      throw err;
    }
  });

  app.get("/workspaces/:wsId/connections/:id", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const conn = await loadConn(id, wsId);
    if (!conn) { reply.code(404); return { error: "not_found" }; }
    return conn;
  });

  app.patch("/workspaces/:wsId/connections/:id", write, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const conn = await loadConn(id, wsId);
    if (!conn) { reply.code(404); return { error: "not_found" }; }
    const body = req.body as { label?: string; baseUrl?: string; config?: Record<string, unknown>; credential?: string };
    try {
      return await updateConnection(pool, id, {
        label: body.label,
        baseUrl: body.baseUrl,
        config: body.config,
        credential: body.credential ? seal(body.credential) : undefined,
      });
    } catch (err) {
      if (err instanceof DuplicateConnectionError) {
        reply.code(409).send({ error: "duplicate_label" });
        return;
      }
      throw err;
    }
  });

  app.delete("/workspaces/:wsId/connections/:id", write, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const ctx = req.runContext!;
    const conn = await loadConn(id, wsId);
    if (!conn) { reply.code(404); return { error: "not_found" }; }
    const using = await agentsUsingConnection(pool, id);
    if (using.length > 0) {
      reply.code(409).send({ error: "connection_in_use", agents: using });
      return;
    }
    await deleteConnection(pool, id);
    await audit(pool, { orgId: conn.orgId, actorUserId: ctx.user.id, action: "connection.delete", targetType: "connection", targetId: id, detail: { label: conn.label } });
    reply.code(204);
  });

  app.post("/workspaces/:wsId/connections/:id/test", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const conn = await loadConn(id, wsId);
    if (!conn) { reply.code(404); return { error: "not_found" }; }
    if (conn.category !== "git") {
      return { ok: true, note: "Notification delivery is verified in a later phase." };
    }
    const sealed = await getConnectionSealed(pool, id);
    if (!sealed) { reply.code(404); return { error: "not_found" }; }
    const git = gitProviderFor(conn.provider, open(sealed), conn.baseUrl);
    if (!git.listRepos) return { ok: false, error: "provider does not support repo listing" };
    const res = await git.listRepos({ limit: 100 });
    if (res.error) return { ok: false, error: res.error };
    return { ok: true, repoCount: res.repos.length };
  });

  app.get("/workspaces/:wsId/connections/:id/repos", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const conn = await loadConn(id, wsId);
    if (!conn || conn.category !== "git") { reply.code(404); return { error: "not_found" }; }
    const sealed = await getConnectionSealed(pool, id);
    if (!sealed) { reply.code(404); return { error: "not_found" }; }
    const git = gitProviderFor(conn.provider, open(sealed), conn.baseUrl);
    if (!git.listRepos) return { repos: [], error: "provider does not support repo listing" };
    const search = (req.query as { search?: string })?.search;
    return git.listRepos({ search, limit: 200 });
  });
}
