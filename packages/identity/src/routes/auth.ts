import bcrypt from "bcrypt";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { signAccessToken } from "../jwt.ts";
import {
  newRefreshToken, sha256, REFRESH_TTL_SECONDS,
} from "../tokens.ts";
import {
  clearAuthCookies, makeRequireAuth, readRefreshCookie, setAuthCookies,
} from "../middleware.ts";
import {
  findActiveRefreshToken, findMembership, findUserByUsername,
  getOrg, getUser, insertRefreshToken, listMembershipsForUser, revokeRefreshToken,
} from "../db.ts";

export async function registerAuthRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.post("/api/auth/login", async (req, reply) => {
    const body = req.body as { username?: string; password?: string };
    if (!body?.username || !body?.password) return reply.code(400).send({ error: "Missing credentials" });

    const found = await findUserByUsername(pool, body.username);
    if (!found || !found.passwordHash) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }
    const ok = await bcrypt.compare(body.password, found.passwordHash);
    if (!ok) return reply.code(401).send({ error: "Invalid credentials" });

    const memberships = await listMembershipsForUser(pool, found.user.id);
    if (memberships.length === 0) return reply.code(403).send({ error: "No org memberships" });

    const active = memberships[0];
    const access = signAccessToken({
      userId: found.user.id, orgId: active.membership.orgId, role: active.membership.role,
    });
    const { plaintext: refresh, hash } = newRefreshToken();
    await insertRefreshToken(pool, {
      userId: found.user.id, tokenHash: hash, activeOrgId: active.membership.orgId,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    });
    setAuthCookies(reply, access, refresh);
    return {
      user: found.user,
      memberships,
      activeOrgId: active.membership.orgId,
    };
  });

  app.post("/api/auth/refresh", async (req, reply) => {
    const refresh = readRefreshCookie(req);
    if (!refresh) return reply.code(401).send({ error: "Missing refresh token" });
    const row = await findActiveRefreshToken(pool, sha256(refresh));
    if (!row) return reply.code(401).send({ error: "Invalid refresh token" });

    const m = await findMembership(pool, row.user_id, row.active_org_id);
    if (!m) return reply.code(403).send({ error: "Membership missing" });

    await revokeRefreshToken(pool, row.token_hash);
    const access = signAccessToken({ userId: row.user_id, orgId: row.active_org_id, role: m.role });
    const { plaintext: newRefresh, hash } = newRefreshToken();
    await insertRefreshToken(pool, {
      userId: row.user_id, tokenHash: hash, activeOrgId: row.active_org_id,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    });
    setAuthCookies(reply, access, newRefresh);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const refresh = readRefreshCookie(req);
    if (refresh) await revokeRefreshToken(pool, sha256(refresh));
    clearAuthCookies(reply);
    return { ok: true };
  });

  app.post("/api/auth/switch-org", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!;
    const body = req.body as { orgId?: string };
    if (!body?.orgId) return reply.code(400).send({ error: "Missing orgId" });
    const m = await findMembership(pool, ctx.user.id, body.orgId);
    if (!m) return reply.code(403).send({ error: "Not a member of that org" });

    const refresh = readRefreshCookie(req);
    if (refresh) await revokeRefreshToken(pool, sha256(refresh));

    const access = signAccessToken({ userId: ctx.user.id, orgId: body.orgId, role: m.role });
    const { plaintext: newRefresh, hash } = newRefreshToken();
    await insertRefreshToken(pool, {
      userId: ctx.user.id, tokenHash: hash, activeOrgId: body.orgId,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    });
    setAuthCookies(reply, access, newRefresh);
    return { activeOrgId: body.orgId };
  });

  app.get("/api/auth/me", { preHandler: requireAuth() }, async (req) => {
    const ctx = req.runContext!;
    const u = await getUser(pool, ctx.user.id);
    const o = await getOrg(pool, ctx.org.id);
    const memberships = await listMembershipsForUser(pool, ctx.user.id);
    return { user: u, activeOrg: o, role: ctx.role, memberships };
  });
}
