import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Composition } from "../composition.ts";
import { makeRequireAuth } from "@journeyman/identity";
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

function ctxOf(req: FastifyRequest) {
  return req.runContext!;
}

function gitProviderFor(provider: string, token: string, baseUrl?: string): IGitProvider {
  if (provider === "gitlab") return new GitLabProvider({ token, baseUrl });
  return new GitHubProvider({ token });
}

export function registerConnectionRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });
  const pool = c.pool!;

  const wrongOrg = (ctx: { org: { id: string } }, orgId: string, reply: FastifyReply) => {
    if (ctx.org.id !== orgId) {
      reply.code(403).send({ error: "wrong_org" });
      return true;
    }
    return false;
  };

  // List
  app.get("/api/orgs/:orgId/users/me/connections", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
    const category = (req.query as { category?: ConnectionCategory })?.category;
    return listConnections(pool, orgId, ctx.user.id, category);
  });

  app.get("/api/orgs/:orgId/connections", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
    const category = (req.query as { category?: ConnectionCategory })?.category;
    return listConnections(pool, orgId, null, category);
  });

  const createHandler = (scope: "user" | "org") => async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
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
        scope,
        userId: scope === "user" ? ctx.user.id : null,
        orgId,
        category: body.category,
        provider: body.provider,
        label: body.label.trim(),
        baseUrl: body.baseUrl,
        credential: seal(body.credential),
        config: body.config ?? {},
        createdBy: ctx.user.id,
      });
      await audit(pool, { orgId, actorUserId: ctx.user.id, action: "connection.create", targetType: "connection", targetId: conn.id, detail: { category: body.category, provider: body.provider, label: conn.label } });
      reply.code(201);
      return conn;
    } catch (err) {
      if (err instanceof DuplicateConnectionError) {
        reply.code(409).send({ error: "duplicate_label" });
        return;
      }
      throw err;
    }
  };

  app.post("/api/orgs/:orgId/users/me/connections", { preHandler: requireAuth() }, createHandler("user"));
  app.post("/api/orgs/:orgId/connections", { preHandler: requireAuth() }, createHandler("org"));

  app.get("/api/orgs/:orgId/connections/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
    const conn = await getConnection(pool, id);
    if (!conn || conn.orgId !== orgId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    return conn;
  });

  app.patch("/api/orgs/:orgId/connections/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
    const conn = await getConnection(pool, id);
    if (!conn || conn.orgId !== orgId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
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

  // Delete — §7.5 in-use guard
  app.delete("/api/orgs/:orgId/connections/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
    const conn = await getConnection(pool, id);
    if (!conn || conn.orgId !== orgId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    const using = await agentsUsingConnection(pool, id);
    if (using.length > 0) {
      reply.code(409).send({ error: "connection_in_use", agents: using });
      return;
    }
    await deleteConnection(pool, id);
    await audit(pool, { orgId, actorUserId: ctx.user.id, action: "connection.delete", targetType: "connection", targetId: id, detail: { label: conn.label } });
    reply.code(204);
  });

  // Test connection — git: whoami via listRepos; notification: stored-only ack (delivery in Phase 4).
  app.post("/api/orgs/:orgId/connections/:id/test", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
    const conn = await getConnection(pool, id);
    if (!conn || conn.orgId !== orgId) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    if (conn.category !== "git") {
      return { ok: true, note: "Notification delivery is verified in a later phase." };
    }
    const sealed = await getConnectionSealed(pool, id);
    if (!sealed) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    const git = gitProviderFor(conn.provider, open(sealed), conn.baseUrl);
    if (!git.listRepos) return { ok: false, error: "provider does not support repo listing" };
    const res = await git.listRepos({ limit: 100 });
    if (res.error) return { ok: false, error: res.error };
    return { ok: true, repoCount: res.repos.length };
  });

  // List repos reachable by a git connection.
  app.get("/api/orgs/:orgId/connections/:id/repos", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = ctxOf(req);
    if (wrongOrg(ctx, orgId, reply)) return;
    const conn = await getConnection(pool, id);
    if (!conn || conn.orgId !== orgId || conn.category !== "git") {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    const sealed = await getConnectionSealed(pool, id);
    if (!sealed) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    const git = gitProviderFor(conn.provider, open(sealed), conn.baseUrl);
    if (!git.listRepos) return { repos: [], error: "provider does not support repo listing" };
    const search = (req.query as { search?: string })?.search;
    return git.listRepos({ search, limit: 200 });
  });
}
