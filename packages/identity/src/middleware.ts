import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import {
  ForbiddenError, type RunContext, type Role, UnauthorizedError,
} from "@journeyman/core";
import { verifyAccessToken, ACCESS_TOKEN_TTL_SECONDS } from "./jwt.ts";
import { isApiToken, REFRESH_TTL_SECONDS, sha256 } from "./tokens.ts";
import { findActiveApiToken, findMembership, getOrg, getUser, isUserPlatformAdmin, touchApiTokenLastUsed } from "./db.ts";

declare module "fastify" {
  interface FastifyRequest { runContext?: RunContext; }
}

export interface RequireAuthDeps { pool: Pool; }

export function makeRequireAuth(deps: RequireAuthDeps) {
  return function requireAuth(opts: { role?: Role } = {}) {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const enforce = process.env.IDENTITY_ENFORCE !== "false";
        if (!enforce) {
          req.runContext = {
            user: { id: "dev-user", username: "dev" },
            org:  { id: "dev-org",  slug: "dev" },
            membershipId: "dev-membership",
            role: "admin",
            isPlatformAdmin: true,
            tokenKind: "access-jwt",
          };
          return;
        }

        const tok = readToken(req);
        if (!tok) throw new UnauthorizedError("Missing token");

        let userId: string, orgId: string, role: Role;
        let tokenKind: RunContext["tokenKind"];
        let apiTokenId: string | undefined;
        let isPlatformAdmin = false;

        if (isApiToken(tok)) {
          const row = await findActiveApiToken(deps.pool, sha256(tok));
          if (!row) throw new UnauthorizedError("Invalid api token");
          userId = row.user_id; orgId = row.org_id;
          tokenKind = "api-token"; apiTokenId = row.id;
          void touchApiTokenLastUsed(deps.pool, row.id).catch(() => {});
          const m = await findMembership(deps.pool, userId, orgId);
          if (!m) throw new ForbiddenError("Membership missing");
          role = m.role;
          // For api tokens, look up the flag fresh.
          isPlatformAdmin = await isUserPlatformAdmin(deps.pool, userId);
        } else {
          const claims = verifyAccessToken(tok);
          userId = claims.sub; orgId = claims.org; role = claims.role;
          tokenKind = "access-jwt";
          isPlatformAdmin = !!claims.pa;
        }

        if (opts.role === "admin" && role !== "admin") {
          throw new ForbiddenError("Admin role required");
        }

        const m = await findMembership(deps.pool, userId, orgId);
        if (!m) throw new ForbiddenError("Membership missing");
        const u = await getUser(deps.pool, userId);
        const o = await getOrg(deps.pool, orgId);
        if (!u || !o) throw new ForbiddenError("Stale token");

        req.runContext = {
          user: { id: u.id, username: u.username },
          org:  { id: o.id, slug: o.slug },
          membershipId: m.id,
          role,
          isPlatformAdmin,
          tokenKind,
          apiTokenId,
        };
      } catch (err: any) {
        if (err instanceof UnauthorizedError) return reply.code(401).send({ error: err.message });
        if (err instanceof ForbiddenError)    return reply.code(403).send({ error: err.message });
        return reply.code(401).send({ error: "Auth failed" });
      }
    };
  };
}

function readToken(req: FastifyRequest): string | null {
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const m = /(?:^|;\s*)jm_access=([^;]+)/.exec(cookieHeader);
    if (m) return decodeURIComponent(m[1]);
  }
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

export function readRefreshCookie(req: FastifyRequest): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const m = /(?:^|;\s*)jm_refresh=([^;]+)/.exec(cookieHeader);
  return m ? decodeURIComponent(m[1]) : null;
}

export function setAuthCookies(reply: FastifyReply, access: string, refresh: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header("Set-Cookie", [
    `jm_access=${encodeURIComponent(access)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ACCESS_TOKEN_TTL_SECONDS}${secure}`,
    `jm_refresh=${encodeURIComponent(refresh)}; Path=/api/auth/refresh; HttpOnly; SameSite=Lax; Max-Age=${REFRESH_TTL_SECONDS}${secure}`,
  ]);
}

export function clearAuthCookies(reply: FastifyReply) {
  reply.header("Set-Cookie", [
    `jm_access=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    `jm_refresh=; Path=/api/auth/refresh; HttpOnly; SameSite=Lax; Max-Age=0`,
  ]);
}
