import * as net from "node:net";
import type { FastifyInstance } from "fastify";
import type { Composition } from "@journeyman/api-context";
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
import { SESClient, GetSendQuotaCommand } from "@aws-sdk/client-ses";

function gitProviderFor(provider: string, token: string, baseUrl?: string): IGitProvider {
  if (provider === "gitlab") return new GitLabProvider({ token, baseUrl });
  return new GitHubProvider({ token });
}

async function testTicketConnection(
  provider: string,
  token: string,
  baseUrl?: string,
  config?: Record<string, unknown>,
): Promise<{ ok: boolean; note?: string; error?: string }> {
  if (provider === "jira") {
    const email = config?.email as string | undefined;
    if (!email || !baseUrl) return { ok: false, error: "Jira requires host and email" };
    const host = baseUrl.replace(/^https?:\/\//, "");
    const encoded = Buffer.from(`${email}:${token}`).toString("base64");
    try {
      const r = await fetch(`https://${host}/rest/api/3/myself`, {
        headers: { Authorization: `Basic ${encoded}`, Accept: "application/json" },
      });
      if (!r.ok) return { ok: false, error: `Jira returned ${r.status}` };
      const data = await r.json() as { displayName?: string };
      return { ok: true, note: `Connected as ${data.displayName ?? "unknown"}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "network error" };
    }
  }
  if (provider === "linear") {
    try {
      const r = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "{ viewer { name } }" }),
      });
      if (!r.ok) return { ok: false, error: `Linear returned ${r.status}` };
      const data = await r.json() as { data?: { viewer?: { name?: string } } };
      return { ok: true, note: `Connected as ${data.data?.viewer?.name ?? "unknown"}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "network error" };
    }
  }
  if (provider === "monday") {
    try {
      const r = await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "{ me { name } }" }),
      });
      if (!r.ok) return { ok: false, error: `Monday returned ${r.status}` };
      const data = await r.json() as { data?: { me?: { name?: string } }; errors?: { message: string }[] };
      if (data.errors?.length) return { ok: false, error: data.errors[0].message };
      return { ok: true, note: `Connected as ${data.data?.me?.name ?? "unknown"}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "network error" };
    }
  }
  return { ok: false, error: `unknown ticket provider: ${provider}` };
}

async function testEmailConnection(
  credential: string,
  config: Record<string, unknown>,
): Promise<{ ok: boolean; note?: string; error?: string }> {
  const method = config.method as string | undefined;
  if (!method) return { ok: false, error: "missing config.method" };

  if (method === "smtp") {
    const host = config.host as string;
    const port = Number(config.port);
    return new Promise((resolve) => {
      const sock = net.createConnection({ host, port, timeout: 5000 }, () => {
        sock.destroy();
        resolve({ ok: true, note: `Reached ${host}:${port}` });
      });
      sock.once("timeout", () => { sock.destroy(); resolve({ ok: false, error: "connection timed out" }); });
      sock.once("error", (err) => resolve({ ok: false, error: err.message }));
    });
  }

  if (method === "resend") {
    try {
      const r = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${credential}` },
      });
      if (!r.ok) return { ok: false, error: `Resend returned ${r.status}` };
      return { ok: true, note: "Resend API key valid" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "network error" };
    }
  }

  if (method === "sendgrid") {
    try {
      const r = await fetch("https://api.sendgrid.com/v3/user/profile", {
        headers: { Authorization: `Bearer ${credential}` },
      });
      if (!r.ok) return { ok: false, error: `SendGrid returned ${r.status}` };
      const data = await r.json() as { username?: string };
      return { ok: true, note: `Connected as ${data.username ?? "unknown"}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "network error" };
    }
  }

  if (method === "mailgun") {
    const domain = config.domain as string;
    const region = (config.region as string | undefined) ?? "us";
    const host = region === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";
    const auth = Buffer.from(`api:${credential}`).toString("base64");
    try {
      const r = await fetch(`https://${host}/v3/domains/${domain}`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!r.ok) return { ok: false, error: `Mailgun returned ${r.status}` };
      return { ok: true, note: `Domain ${domain} verified` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "network error" };
    }
  }

  if (method === "ses") {
    const sesRegion = config.region as string;
    const accessKeyId = config.accessKeyId as string;
    const client = new SESClient({
      region: sesRegion,
      credentials: { accessKeyId, secretAccessKey: credential },
    });
    try {
      const quota = await client.send(new GetSendQuotaCommand({})) as { Max24HourSend?: number };
      return { ok: true, note: `SES quota: ${quota.Max24HourSend ?? "unknown"}/day` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "SES error" };
    }
  }

  return { ok: false, error: `unknown email method: ${method}` };
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

  app.post("/workspaces/:wsId/connections", { ...write, config: { audit: { action: "connection.create", targetType: "connection" } } }, async (req, reply) => {
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
      req.auditTargetId = conn.id;
      req.auditDetail = { category: body.category, provider: body.provider, label: conn.label };
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

  app.patch("/workspaces/:wsId/connections/:id", { ...write, config: { audit: { action: "connection.update", targetType: "connection" } } }, async (req, reply) => {
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

  app.delete("/workspaces/:wsId/connections/:id", { ...write, config: { audit: { action: "connection.delete", targetType: "connection" } } }, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const conn = await loadConn(id, wsId);
    if (!conn) { reply.code(404); return { error: "not_found" }; }
    const using = await agentsUsingConnection(pool, id);
    if (using.length > 0) {
      reply.code(409).send({ error: "connection_in_use", agents: using });
      return;
    }
    await deleteConnection(pool, id);
    req.auditDetail = { label: conn.label };
    reply.code(204);
  });

  app.post("/workspaces/:wsId/connections/:id/test", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const conn = await loadConn(id, wsId);
    if (!conn) { reply.code(404); return { error: "not_found" }; }
    if (conn.category === "notification") {
      if (conn.provider !== "email") {
        return { ok: true, note: "Notification delivery is verified in a later phase." };
      }
      const sealed = await getConnectionSealed(pool, id);
      if (!sealed) { reply.code(404); return { error: "not_found" }; }
      return testEmailConnection(open(sealed), conn.config ?? {});
    }
    const sealed = await getConnectionSealed(pool, id);
    if (!sealed) { reply.code(404); return { error: "not_found" }; }
    if (conn.category === "ticket") {
      return testTicketConnection(conn.provider, open(sealed), conn.baseUrl, conn.config);
    }
    // git
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
