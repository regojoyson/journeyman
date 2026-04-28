# Identity Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the multi-tenant Identity foundation (User, Org, Membership, JWT auth, bootstrap) per [the design spec](../specs/2026-04-28-identity-foundation-design.md).

**Architecture:** New `@journeyman/identity` package owns auth provider, JWT, bootstrap, and all `/api/auth/*`, `/api/orgs/*`, `/api/users/*`, `/api/bootstrap*`, `/api/orgs/:id/api-tokens*` routes. Postgres migration `002_identity.sql` adds tables (using existing `jm_` prefix convention). `@journeyman/core` gets a `RunContext` type. `api-server` mounts new routes + `requireAuth` middleware behind an `IDENTITY_ENFORCE` flag (default `false` until cred-vault spec lands).

**Tech Stack:** Postgres + `pg`, bcrypt, `jsonwebtoken`, Fastify (existing api-server), TypeScript.

**User constraints applied:**
- No unit tests written.
- No git commits — leave changes uncommitted.
- Typecheck runs once at the end.
- Tasks organized into parallel groups; tasks within the same group can run concurrently.

---

## Parallel Execution Map

| Group | Tasks | Depends on |
|---|---|---|
| **A** (parallel) | A1, A2, A3 | — |
| **B** (parallel) | B1, B2, B3, B4 | A2, A3 |
| **C** (parallel) | C1, C2, C3, C4, C5, C6, C7 | B1–B4 |
| **D** (sequential) | D1 → D2 → D3 | C1–C7 |
| **E** (final) | E1 (typecheck) | D3 |

---

## Group A — Foundation (parallel)

### Task A1: Migration `002_identity.sql`

**Files:**
- Create: `packages/migrations/src/sql/002_identity.sql`

- [ ] **Step 1:** Create the file with full SQL.

```sql
-- 002_identity.sql — User/Org/Membership + auth tables. Uses jm_ prefix.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS jm_orgs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jm_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jm_auth_identities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES jm_users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  secret_hash  TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);

CREATE TABLE IF NOT EXISTS jm_memberships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES jm_users(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES jm_orgs(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('admin','member')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, org_id)
);

CREATE TABLE IF NOT EXISTS jm_refresh_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES jm_users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  active_org_id UUID REFERENCES jm_orgs(id),
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS jm_api_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES jm_users(id) ON DELETE CASCADE,
  org_id       UUID NOT NULL REFERENCES jm_orgs(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS jm_system_state (
  id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bootstrapped_at TIMESTAMPTZ
);
INSERT INTO jm_system_state (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_jm_memberships_org ON jm_memberships (org_id);
CREATE INDEX IF NOT EXISTS idx_jm_auth_identities_user ON jm_auth_identities (user_id);
CREATE INDEX IF NOT EXISTS idx_jm_refresh_tokens_user ON jm_refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_jm_api_tokens_user ON jm_api_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_jm_api_tokens_org  ON jm_api_tokens (org_id);
```

---

### Task A2: Add `RunContext` + identity types to `@journeyman/core`

**Files:**
- Create: `packages/core/src/types/identity.types.ts`
- Modify: `packages/core/src/index.ts` (re-export)

- [ ] **Step 1:** Create `packages/core/src/types/identity.types.ts`:

```ts
export type Role = "admin" | "member";

export interface OrgRecord {
  id: string;
  slug: string;
  name: string;
  createdAt: Date;
}

export interface UserRecord {
  id: string;
  username: string;
  displayName: string | null;
  status: "active" | "disabled" | "deleted";
  createdAt: Date;
  updatedAt: Date;
}

export interface MembershipRecord {
  id: string;
  userId: string;
  orgId: string;
  role: Role;
  createdAt: Date;
}

export interface RunContext {
  user: { id: string; username: string };
  org: { id: string; slug: string };
  membershipId: string;
  role: Role;
  tokenKind: "access-jwt" | "api-token";
  apiTokenId?: string;
}

export interface AccessTokenClaims {
  sub: string;        // userId
  org: string;        // activeOrgId
  role: Role;
  kind: "access";
  iat: number;
  exp: number;
}

export class AlreadyBootstrappedError extends Error {
  constructor() { super("System already bootstrapped"); this.name = "AlreadyBootstrappedError"; }
}
export class InvalidCredentialsError extends Error {
  constructor() { super("Invalid credentials"); this.name = "InvalidCredentialsError"; }
}
export class UnauthorizedError extends Error {
  constructor(msg = "Unauthorized") { super(msg); this.name = "UnauthorizedError"; }
}
export class ForbiddenError extends Error {
  constructor(msg = "Forbidden") { super(msg); this.name = "ForbiddenError"; }
}
```

- [ ] **Step 2:** Append re-export to `packages/core/src/index.ts`:

```ts
export * from "./types/identity.types.ts";
```

---

### Task A3: Scaffold `@journeyman/identity` package

**Files:**
- Create: `packages/identity/package.json`
- Create: `packages/identity/tsconfig.json`
- Create: `packages/identity/src/index.ts` (empty barrel — populated by Group B/C)

- [ ] **Step 1:** `packages/identity/package.json`:

```json
{
  "name": "@journeyman/identity",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./middleware": "./src/middleware.ts",
    "./routes": "./src/routes/index.ts"
  },
  "bin": {
    "journeyman-bootstrap": "./src/cli/bootstrap.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@journeyman/core": "*",
    "bcrypt": "^5.1.1",
    "jsonwebtoken": "^9.0.2",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/bcrypt": "^5.0.2",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^25.6.0",
    "@types/pg": "^8.11.10",
    "tsx": "^4.21.0",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 2:** `packages/identity/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3:** `packages/identity/src/index.ts` (placeholder; Group B/C tasks append):

```ts
// Public exports populated by subsequent tasks.
export {};
```

- [ ] **Step 4:** Run `npm install` from repo root to link the workspace.

```bash
npm install
```

---

## Group B — Core internals (parallel after A2 + A3)

### Task B1: JWT signing/verification

**Files:**
- Create: `packages/identity/src/jwt.ts`

- [ ] **Step 1:** Write file:

```ts
import jwt from "jsonwebtoken";
import type { AccessTokenClaims, Role } from "@journeyman/core";

const ACCESS_TTL_SECONDS = 15 * 60;

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error("JWT_SECRET env var missing or shorter than 32 chars");
  }
  return s;
}

export function signAccessToken(input: { userId: string; orgId: string; role: Role }): string {
  return jwt.sign(
    { sub: input.userId, org: input.orgId, role: input.role, kind: "access" },
    secret(),
    { algorithm: "HS256", expiresIn: ACCESS_TTL_SECONDS },
  );
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const claims = jwt.verify(token, secret(), { algorithms: ["HS256"] }) as AccessTokenClaims;
  if (claims.kind !== "access") throw new Error("Wrong token kind");
  return claims;
}

export const ACCESS_TOKEN_TTL_SECONDS = ACCESS_TTL_SECONDS;
```

---

### Task B2: Token hashing + generation

**Files:**
- Create: `packages/identity/src/tokens.ts`

- [ ] **Step 1:** Write file:

```ts
import { createHash, randomBytes } from "node:crypto";

export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
export const API_TOKEN_PREFIX = "jm_pat_";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function newRefreshToken(): { plaintext: string; hash: string } {
  const plaintext = randomBytes(32).toString("base64url");
  return { plaintext, hash: sha256(plaintext) };
}

export function newApiToken(): { plaintext: string; hash: string } {
  const plaintext = API_TOKEN_PREFIX + randomBytes(24).toString("base64url");
  return { plaintext, hash: sha256(plaintext) };
}

export function isApiToken(token: string): boolean {
  return token.startsWith(API_TOKEN_PREFIX);
}
```

---

### Task B3: Bootstrap function

**Files:**
- Create: `packages/identity/src/bootstrap.ts`

- [ ] **Step 1:** Write file:

```ts
import bcrypt from "bcrypt";
import type { Pool } from "pg";
import { AlreadyBootstrappedError, type OrgRecord, type UserRecord } from "@journeyman/core";

export interface BootstrapInput {
  orgName: string;
  orgSlug: string;
  username: string;
  password: string;
  displayName?: string;
}

export async function bootstrap(
  pool: Pool,
  input: BootstrapInput,
): Promise<{ user: UserRecord; org: OrgRecord }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const state = await client.query(
      "SELECT bootstrapped_at FROM jm_system_state WHERE id = 1 FOR UPDATE",
    );
    if (state.rows[0]?.bootstrapped_at) {
      await client.query("ROLLBACK");
      throw new AlreadyBootstrappedError();
    }

    const orgRes = await client.query(
      "INSERT INTO jm_orgs (slug, name) VALUES ($1, $2) RETURNING id, slug, name, created_at",
      [input.orgSlug, input.orgName],
    );
    const userRes = await client.query(
      `INSERT INTO jm_users (username, display_name)
       VALUES ($1, $2)
       RETURNING id, username, display_name, status, created_at, updated_at`,
      [input.username, input.displayName ?? null],
    );
    const passwordHash = await bcrypt.hash(input.password, 12);
    await client.query(
      `INSERT INTO jm_auth_identities (user_id, provider, subject, secret_hash)
       VALUES ($1, 'password', $2, $3)`,
      [userRes.rows[0].id, input.username, passwordHash],
    );
    await client.query(
      "INSERT INTO jm_memberships (user_id, org_id, role) VALUES ($1, $2, 'admin')",
      [userRes.rows[0].id, orgRes.rows[0].id],
    );
    await client.query(
      "UPDATE jm_system_state SET bootstrapped_at = now() WHERE id = 1",
    );
    await client.query("COMMIT");

    return {
      org: {
        id: orgRes.rows[0].id,
        slug: orgRes.rows[0].slug,
        name: orgRes.rows[0].name,
        createdAt: orgRes.rows[0].created_at,
      },
      user: {
        id: userRes.rows[0].id,
        username: userRes.rows[0].username,
        displayName: userRes.rows[0].display_name,
        status: userRes.rows[0].status,
        createdAt: userRes.rows[0].created_at,
        updatedAt: userRes.rows[0].updated_at,
      },
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function isBootstrapped(pool: Pool): Promise<boolean> {
  const r = await pool.query("SELECT bootstrapped_at FROM jm_system_state WHERE id = 1");
  return r.rows[0]?.bootstrapped_at != null;
}
```

---

### Task B4: DB query module

**Files:**
- Create: `packages/identity/src/db.ts`

- [ ] **Step 1:** Write file:

```ts
import type { Pool } from "pg";
import type { MembershipRecord, OrgRecord, Role, UserRecord } from "@journeyman/core";

function rowToUser(r: any): UserRecord {
  return {
    id: r.id, username: r.username, displayName: r.display_name,
    status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function rowToOrg(r: any): OrgRecord {
  return { id: r.id, slug: r.slug, name: r.name, createdAt: r.created_at };
}
function rowToMembership(r: any): MembershipRecord {
  return {
    id: r.id, userId: r.user_id, orgId: r.org_id,
    role: r.role as Role, createdAt: r.created_at,
  };
}

export async function findUserByUsername(pool: Pool, username: string) {
  const r = await pool.query(
    `SELECT u.*, ai.secret_hash
       FROM jm_users u
       JOIN jm_auth_identities ai
         ON ai.user_id = u.id AND ai.provider = 'password'
      WHERE u.username = $1 AND u.status = 'active'`,
    [username],
  );
  if (!r.rows[0]) return null;
  return { user: rowToUser(r.rows[0]), passwordHash: r.rows[0].secret_hash as string };
}

export async function getUser(pool: Pool, userId: string): Promise<UserRecord | null> {
  const r = await pool.query("SELECT * FROM jm_users WHERE id = $1", [userId]);
  return r.rows[0] ? rowToUser(r.rows[0]) : null;
}

export async function getOrg(pool: Pool, orgId: string): Promise<OrgRecord | null> {
  const r = await pool.query("SELECT * FROM jm_orgs WHERE id = $1", [orgId]);
  return r.rows[0] ? rowToOrg(r.rows[0]) : null;
}

export async function findMembership(
  pool: Pool, userId: string, orgId: string,
): Promise<MembershipRecord | null> {
  const r = await pool.query(
    "SELECT * FROM jm_memberships WHERE user_id = $1 AND org_id = $2",
    [userId, orgId],
  );
  return r.rows[0] ? rowToMembership(r.rows[0]) : null;
}

export async function listMembershipsForUser(pool: Pool, userId: string) {
  const r = await pool.query(
    `SELECT m.*, o.slug AS org_slug, o.name AS org_name
       FROM jm_memberships m JOIN jm_orgs o ON o.id = m.org_id
      WHERE m.user_id = $1`,
    [userId],
  );
  return r.rows.map((row: any) => ({
    membership: rowToMembership(row),
    org: { id: row.org_id, slug: row.org_slug, name: row.org_name } as Pick<OrgRecord, "id"|"slug"|"name">,
  }));
}

export async function listMembershipsForOrg(pool: Pool, orgId: string) {
  const r = await pool.query(
    `SELECT m.*, u.username, u.display_name
       FROM jm_memberships m JOIN jm_users u ON u.id = m.user_id
      WHERE m.org_id = $1`,
    [orgId],
  );
  return r.rows.map((row: any) => ({
    membership: rowToMembership(row),
    user: { id: row.user_id, username: row.username, displayName: row.display_name },
  }));
}

export async function insertRefreshToken(
  pool: Pool, input: { userId: string; tokenHash: string; activeOrgId: string; expiresAt: Date },
) {
  await pool.query(
    `INSERT INTO jm_refresh_tokens (user_id, token_hash, active_org_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [input.userId, input.tokenHash, input.activeOrgId, input.expiresAt],
  );
}

export async function findActiveRefreshToken(pool: Pool, tokenHash: string) {
  const r = await pool.query(
    `SELECT * FROM jm_refresh_tokens
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [tokenHash],
  );
  return r.rows[0] ?? null;
}

export async function revokeRefreshToken(pool: Pool, tokenHash: string) {
  await pool.query(
    "UPDATE jm_refresh_tokens SET revoked_at = now() WHERE token_hash = $1",
    [tokenHash],
  );
}

export async function findActiveApiToken(pool: Pool, tokenHash: string) {
  const r = await pool.query(
    `SELECT * FROM jm_api_tokens
      WHERE token_hash = $1 AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())`,
    [tokenHash],
  );
  return r.rows[0] ?? null;
}

export async function touchApiTokenLastUsed(pool: Pool, id: string) {
  await pool.query("UPDATE jm_api_tokens SET last_used_at = now() WHERE id = $1", [id]);
}

export async function insertApiToken(
  pool: Pool,
  input: { userId: string; orgId: string; name: string; tokenHash: string; expiresAt: Date | null },
) {
  const r = await pool.query(
    `INSERT INTO jm_api_tokens (user_id, org_id, name, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, created_at, expires_at, last_used_at`,
    [input.userId, input.orgId, input.name, input.tokenHash, input.expiresAt],
  );
  return r.rows[0];
}

export async function listApiTokens(pool: Pool, orgId: string, userId: string | null) {
  const sql = userId
    ? `SELECT id, name, last_used_at, expires_at, created_at, revoked_at
         FROM jm_api_tokens WHERE org_id = $1 AND user_id = $2 ORDER BY created_at DESC`
    : `SELECT id, name, last_used_at, expires_at, created_at, revoked_at
         FROM jm_api_tokens WHERE org_id = $1 ORDER BY created_at DESC`;
  const params = userId ? [orgId, userId] : [orgId];
  const r = await pool.query(sql, params);
  return r.rows;
}

export async function revokeApiToken(pool: Pool, id: string, orgId: string) {
  await pool.query(
    "UPDATE jm_api_tokens SET revoked_at = now() WHERE id = $1 AND org_id = $2",
    [id, orgId],
  );
}

export async function createInvite(
  pool: Pool,
  input: { orgId: string; username: string; role: Role; passwordHash: string; displayName?: string },
) {
  return await (async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let userRow = (await client.query("SELECT * FROM jm_users WHERE username = $1", [input.username])).rows[0];
      if (!userRow) {
        userRow = (await client.query(
          `INSERT INTO jm_users (username, display_name)
           VALUES ($1, $2) RETURNING *`,
          [input.username, input.displayName ?? null],
        )).rows[0];
        await client.query(
          `INSERT INTO jm_auth_identities (user_id, provider, subject, secret_hash)
           VALUES ($1, 'password', $2, $3)`,
          [userRow.id, input.username, input.passwordHash],
        );
      }
      await client.query(
        `INSERT INTO jm_memberships (user_id, org_id, role)
         VALUES ($1, $2, $3) ON CONFLICT (user_id, org_id) DO NOTHING`,
        [userRow.id, input.orgId, input.role],
      );
      await client.query("COMMIT");
      return rowToUser(userRow);
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      throw e;
    } finally {
      client.release();
    }
  })();
}

export async function deleteMembership(pool: Pool, orgId: string, userId: string) {
  await pool.query(
    "DELETE FROM jm_memberships WHERE org_id = $1 AND user_id = $2",
    [orgId, userId],
  );
}

export async function updateMembershipRole(
  pool: Pool, orgId: string, userId: string, role: Role,
) {
  await pool.query(
    "UPDATE jm_memberships SET role = $1 WHERE org_id = $2 AND user_id = $3",
    [role, orgId, userId],
  );
}

export async function updateUserPassword(pool: Pool, userId: string, passwordHash: string) {
  await pool.query(
    `UPDATE jm_auth_identities SET secret_hash = $1
      WHERE user_id = $2 AND provider = 'password'`,
    [passwordHash, userId],
  );
}

export async function getUserPasswordHash(pool: Pool, userId: string): Promise<string | null> {
  const r = await pool.query(
    `SELECT secret_hash FROM jm_auth_identities
      WHERE user_id = $1 AND provider = 'password'`,
    [userId],
  );
  return r.rows[0]?.secret_hash ?? null;
}

export async function updateUserProfile(pool: Pool, userId: string, displayName: string | null) {
  await pool.query(
    "UPDATE jm_users SET display_name = $1, updated_at = now() WHERE id = $2",
    [displayName, userId],
  );
}
```

---

## Group C — Middleware, CLI, routes (parallel after Group B)

### Task C1: `requireAuth` middleware

**Files:**
- Create: `packages/identity/src/middleware.ts`

- [ ] **Step 1:** Write file:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import {
  ForbiddenError, type RunContext, type Role, UnauthorizedError,
} from "@journeyman/core";
import { verifyAccessToken } from "./jwt.ts";
import { isApiToken, sha256 } from "./tokens.ts";
import { findActiveApiToken, findMembership, getOrg, getUser, touchApiTokenLastUsed } from "./db.ts";

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
          // Dev fallback: synthetic context so existing flows keep working
          req.runContext = {
            user: { id: "dev-user", username: "dev" },
            org:  { id: "dev-org",  slug: "dev" },
            membershipId: "dev-membership",
            role: "admin",
            tokenKind: "access-jwt",
          };
          return;
        }

        const tok = readToken(req);
        if (!tok) throw new UnauthorizedError("Missing token");

        let userId: string, orgId: string, role: Role;
        let tokenKind: RunContext["tokenKind"];
        let apiTokenId: string | undefined;

        if (isApiToken(tok)) {
          const row = await findActiveApiToken(deps.pool, sha256(tok));
          if (!row) throw new UnauthorizedError("Invalid api token");
          userId = row.user_id; orgId = row.org_id;
          tokenKind = "api-token"; apiTokenId = row.id;
          void touchApiTokenLastUsed(deps.pool, row.id).catch(() => {});
          const m = await findMembership(deps.pool, userId, orgId);
          if (!m) throw new ForbiddenError("Membership missing");
          role = m.role;
        } else {
          const claims = verifyAccessToken(tok);
          userId = claims.sub; orgId = claims.org; role = claims.role;
          tokenKind = "access-jwt";
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
    `jm_access=${encodeURIComponent(access)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900${secure}`,
    `jm_refresh=${encodeURIComponent(refresh)}; Path=/api/auth/refresh; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
  ]);
}

export function clearAuthCookies(reply: FastifyReply) {
  reply.header("Set-Cookie", [
    `jm_access=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    `jm_refresh=; Path=/api/auth/refresh; HttpOnly; SameSite=Lax; Max-Age=0`,
  ]);
}
```

---

### Task C2: Bootstrap CLI

**Files:**
- Create: `packages/identity/src/cli/bootstrap.ts`

- [ ] **Step 1:** Write file:

```ts
#!/usr/bin/env -S npx tsx
import { Pool } from "pg";
import { bootstrap } from "../bootstrap.ts";

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

async function main() {
  const orgName = arg("org");
  const orgSlug = arg("slug");
  const username = arg("username");
  const password = arg("password");
  const displayName = arg("display-name");

  if (!orgName || !orgSlug || !username || !password) {
    console.error("Usage: journeyman-bootstrap --org <name> --slug <slug> --username <u> --password <p> [--display-name <n>]");
    process.exit(2);
  }

  const url = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/journeyman";
  const pool = new Pool({ connectionString: url });
  try {
    const { user, org } = await bootstrap(pool, { orgName, orgSlug, username, password, displayName });
    console.log(JSON.stringify({ ok: true, org, user }, null, 2));
  } catch (err: any) {
    console.error("Bootstrap failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
```

---

### Task C3: Auth routes

**Files:**
- Create: `packages/identity/src/routes/auth.ts`

- [ ] **Step 1:** Write file:

```ts
import bcrypt from "bcrypt";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { InvalidCredentialsError, UnauthorizedError } from "@journeyman/core";
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
    if (!found || !found.passwordHash) throw new InvalidCredentialsError();
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
```

---

### Task C4: Bootstrap routes

**Files:**
- Create: `packages/identity/src/routes/bootstrap.ts`

- [ ] **Step 1:** Write file:

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { AlreadyBootstrappedError } from "@journeyman/core";
import { bootstrap, isBootstrapped } from "../bootstrap.ts";

export async function registerBootstrapRoutes(app: FastifyInstance, pool: Pool) {
  app.get("/api/bootstrap/status", async () => ({ bootstrapped: await isBootstrapped(pool) }));

  app.post("/api/bootstrap", async (req, reply) => {
    const body = req.body as {
      orgName?: string; orgSlug?: string;
      username?: string; password?: string; displayName?: string;
    };
    if (!body?.orgName || !body?.orgSlug || !body?.username || !body?.password) {
      return reply.code(400).send({ error: "Missing required fields" });
    }
    try {
      const out = await bootstrap(pool, {
        orgName: body.orgName, orgSlug: body.orgSlug,
        username: body.username, password: body.password, displayName: body.displayName,
      });
      reply.code(201);
      return out;
    } catch (err) {
      if (err instanceof AlreadyBootstrappedError) {
        return reply.code(403).send({ error: err.message });
      }
      throw err;
    }
  });
}
```

---

### Task C5: Org admin routes

**Files:**
- Create: `packages/identity/src/routes/orgs.ts`

- [ ] **Step 1:** Write file:

```ts
import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { Role } from "@journeyman/core";
import { makeRequireAuth } from "../middleware.ts";
import {
  createInvite, deleteMembership, listMembershipsForOrg, updateMembershipRole,
} from "../db.ts";

export async function registerOrgRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/memberships",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listMembershipsForOrg(pool, orgId);
    });

  app.post("/api/orgs/:orgId/invitations",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { username?: string; role?: Role; tempPassword?: string; displayName?: string };
      if (!body?.username || !body?.role) return reply.code(400).send({ error: "Missing username or role" });
      if (body.role !== "admin" && body.role !== "member") return reply.code(400).send({ error: "Bad role" });

      const tempPassword = body.tempPassword ?? randomBytes(9).toString("base64url");
      const passwordHash = await bcrypt.hash(tempPassword, 12);
      const user = await createInvite(pool, {
        orgId, username: body.username, role: body.role, passwordHash, displayName: body.displayName,
      });
      reply.code(201);
      return { user, tempPassword };
    });

  app.delete("/api/orgs/:orgId/memberships/:userId",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, userId } = req.params as { orgId: string; userId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      await deleteMembership(pool, orgId, userId);
      return { ok: true };
    });

  app.patch("/api/orgs/:orgId/memberships/:userId",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, userId } = req.params as { orgId: string; userId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { role?: Role };
      if (body?.role !== "admin" && body?.role !== "member") return reply.code(400).send({ error: "Bad role" });
      await updateMembershipRole(pool, orgId, userId, body.role);
      return { ok: true };
    });
}
```

---

### Task C6: User self-service routes

**Files:**
- Create: `packages/identity/src/routes/users.ts`

- [ ] **Step 1:** Write file:

```ts
import bcrypt from "bcrypt";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "../middleware.ts";
import { getUserPasswordHash, updateUserPassword, updateUserProfile } from "../db.ts";

export async function registerUserRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.post("/api/users/me/password",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const ctx = req.runContext!;
      const body = req.body as { currentPassword?: string; newPassword?: string };
      if (!body?.currentPassword || !body?.newPassword) {
        return reply.code(400).send({ error: "Missing fields" });
      }
      const hash = await getUserPasswordHash(pool, ctx.user.id);
      if (!hash || !(await bcrypt.compare(body.currentPassword, hash))) {
        return reply.code(401).send({ error: "Wrong current password" });
      }
      await updateUserPassword(pool, ctx.user.id, await bcrypt.hash(body.newPassword, 12));
      return { ok: true };
    });

  app.patch("/api/users/me",
    { preHandler: requireAuth() },
    async (req) => {
      const ctx = req.runContext!;
      const body = req.body as { displayName?: string | null };
      await updateUserProfile(pool, ctx.user.id, body?.displayName ?? null);
      return { ok: true };
    });
}
```

---

### Task C7: API token routes + routes barrel

**Files:**
- Create: `packages/identity/src/routes/api-tokens.ts`
- Create: `packages/identity/src/routes/index.ts`

- [ ] **Step 1:** `packages/identity/src/routes/api-tokens.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "../middleware.ts";
import { newApiToken } from "../tokens.ts";
import { insertApiToken, listApiTokens, revokeApiToken } from "../db.ts";

export async function registerApiTokenRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/api-tokens",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const filterUserId = ctx.role === "admin" ? null : ctx.user.id;
      return listApiTokens(pool, orgId, filterUserId);
    });

  app.post("/api/orgs/:orgId/api-tokens",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { name?: string; expiresAt?: string };
      if (!body?.name) return reply.code(400).send({ error: "Missing name" });
      const { plaintext, hash } = newApiToken();
      const row = await insertApiToken(pool, {
        userId: ctx.user.id, orgId, name: body.name, tokenHash: hash,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      });
      reply.code(201);
      return { id: row.id, name: row.name, plaintext, createdAt: row.created_at, expiresAt: row.expires_at };
    });

  app.delete("/api/orgs/:orgId/api-tokens/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      // member can only revoke own; we filter on org+id and rely on UI to show only own;
      // for stricter check, fetch row first if member.
      if (ctx.role !== "admin") {
        const own = await listApiTokens(pool, orgId, ctx.user.id);
        if (!own.find((t: any) => t.id === id)) return reply.code(403).send({ error: "Not your token" });
      }
      await revokeApiToken(pool, id, orgId);
      return { ok: true };
    });
}
```

- [ ] **Step 2:** `packages/identity/src/routes/index.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerAuthRoutes } from "./auth.ts";
import { registerBootstrapRoutes } from "./bootstrap.ts";
import { registerOrgRoutes } from "./orgs.ts";
import { registerUserRoutes } from "./users.ts";
import { registerApiTokenRoutes } from "./api-tokens.ts";

export async function registerIdentityRoutes(app: FastifyInstance, pool: Pool) {
  await registerBootstrapRoutes(app, pool);
  await registerAuthRoutes(app, pool);
  await registerOrgRoutes(app, pool);
  await registerUserRoutes(app, pool);
  await registerApiTokenRoutes(app, pool);
}

export { makeRequireAuth } from "../middleware.ts";
```

- [ ] **Step 3:** Replace `packages/identity/src/index.ts` with public exports:

```ts
export * from "./bootstrap.ts";
export * from "./jwt.ts";
export * from "./tokens.ts";
export * from "./middleware.ts";
export { registerIdentityRoutes } from "./routes/index.ts";
```

---

## Group D — Wire it up (sequential)

### Task D1: Mount routes in `@journeyman/api-server`

**Files:**
- Modify: `packages/api-server/package.json` (add dep)
- Modify: `packages/api-server/src/composition.ts` (or `server.ts` — read first to confirm where routes get registered)
- Modify: `packages/api-server/src/server.ts`

- [ ] **Step 1:** Add dependency to `packages/api-server/package.json`:

```json
"@journeyman/identity": "*"
```

(Add under `dependencies`. Run `npm install` from repo root to relink.)

- [ ] **Step 2:** Read `packages/api-server/src/server.ts` and `composition.ts` to find where Fastify is constructed and where existing route modules (`flows.ts`, `runs.ts`, `health.ts`) are registered. Identify:
  - The `FastifyInstance` variable name.
  - The `pg.Pool` (or composition) that holds the DB connection.

- [ ] **Step 3:** In the same place existing routes are registered, add:

```ts
import { registerIdentityRoutes } from "@journeyman/identity";

// ... where other routes are registered (e.g. await app.register(flowsRoutes, ...)):
await registerIdentityRoutes(app, pool);   // `pool` = the Postgres pool from composition
```

(If `pool` is not currently exposed by `composition.ts`, expose it: add `pool: Pool` to the `Composition` type and return it from `buildComposition`.)

- [ ] **Step 4:** Apply `requireAuth()` (default opts) to existing protected routes in `routes/flows.ts` and `routes/runs.ts`:

```ts
import { makeRequireAuth } from "@journeyman/identity";
// ...
const requireAuth = makeRequireAuth({ pool });

app.get("/api/flows", { preHandler: requireAuth() }, ...);  // and the rest
```

The `IDENTITY_ENFORCE=false` (default) keeps these routes working for existing flows; flip to `true` only after spec #2.

---

### Task D2: SPA setup wizard + login page

**Files:**
- Modify: `packages/web/src/main.tsx`
- Create: `packages/web/src/pages/SetupWizardPage.tsx`
- Create: `packages/web/src/pages/LoginPage.tsx`
- Create: `packages/web/src/pages/AppShell.tsx` (or modify existing shell)

- [ ] **Step 1:** Read `packages/web/src/main.tsx` and existing routing to identify the router (likely `react-router-dom`) and where routes are declared.

- [ ] **Step 2:** `packages/web/src/pages/SetupWizardPage.tsx`:

```tsx
import { useState } from "react";

export function SetupWizardPage(props: { onDone: () => void }) {
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgName, orgSlug, username, password }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Bootstrap failed");
      props.onDone();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 420, margin: "4rem auto", display: "grid", gap: 12 }}>
      <h1>First-time setup</h1>
      <input placeholder="Organization name" value={orgName} onChange={e => setOrgName(e.target.value)} required />
      <input placeholder="Organization slug" value={orgSlug} onChange={e => setOrgSlug(e.target.value)} required />
      <input placeholder="Admin username" value={username} onChange={e => setUsername(e.target.value)} required />
      <input type="password" placeholder="Admin password" value={password} onChange={e => setPassword(e.target.value)} required />
      <button disabled={busy} type="submit">{busy ? "Creating…" : "Create"}</button>
      {error && <div style={{ color: "red" }}>{error}</div>}
    </form>
  );
}
```

- [ ] **Step 3:** `packages/web/src/pages/LoginPage.tsx`:

```tsx
import { useState } from "react";

export function LoginPage(props: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Login failed");
      props.onLoggedIn();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 360, margin: "6rem auto", display: "grid", gap: 12 }}>
      <h1>Sign in</h1>
      <input placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} required />
      <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
      <button disabled={busy} type="submit">{busy ? "Signing in…" : "Sign in"}</button>
      {error && <div style={{ color: "red" }}>{error}</div>}
    </form>
  );
}
```

- [ ] **Step 4:** Add a top-level gate in `packages/web/src/main.tsx` (or wherever the app shell mounts). Pseudocode — adapt to existing router:

```tsx
import { useEffect, useState } from "react";
import { SetupWizardPage } from "./pages/SetupWizardPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";

function AuthGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<"loading" | "setup" | "login" | "ready">("loading");

  async function check() {
    const status = await fetch("/api/bootstrap/status").then(r => r.json());
    if (!status.bootstrapped) { setPhase("setup"); return; }
    const me = await fetch("/api/auth/me", { credentials: "include" });
    setPhase(me.ok ? "ready" : "login");
  }
  useEffect(() => { check(); }, []);

  if (phase === "loading") return null;
  if (phase === "setup")   return <SetupWizardPage onDone={() => setPhase("login")} />;
  if (phase === "login")   return <LoginPage onLoggedIn={() => setPhase("ready")} />;
  return <>{children}</>;
}

// Wrap the existing app root:
// <AuthGate><ExistingApp /></AuthGate>
```

(Find the existing top-level component in `main.tsx` and wrap it.)

---

### Task D3: Replace `no-auth-provider.ts`

**Files:**
- Delete: `packages/orchestrator/src/auth/no-auth-provider.ts`
- Modify: any imports of it (search first)

- [ ] **Step 1:** Search for usages:

```bash
grep -rn "no-auth-provider" packages/ --include="*.ts"
```

- [ ] **Step 2:** For each importing file, replace the import with a synthetic `RunContext` from `@journeyman/core`, *or* delete the import entirely if the value is unused. Concretely: if a caller does

```ts
import { NoAuthProvider } from "../auth/no-auth-provider.ts";
const ctx = new NoAuthProvider().context();
```

replace with:

```ts
import type { RunContext } from "@journeyman/core";
const ctx: RunContext = {
  user: { id: "system", username: "system" },
  org:  { id: "system", slug: "system" },
  membershipId: "system",
  role: "admin",
  tokenKind: "access-jwt",
};
```

- [ ] **Step 3:** Delete `packages/orchestrator/src/auth/no-auth-provider.ts`.

- [ ] **Step 4:** Remove now-empty `packages/orchestrator/src/auth/` directory if nothing else lives there.

---

## Group E — Final check

### Task E1: Typecheck everything

- [ ] **Step 1:** From repo root:

```bash
npm run typecheck
```

Expected: every workspace passes. Fix any type errors that surface; common ones:
- Missing `@types/bcrypt` / `@types/jsonwebtoken` — already in `packages/identity/package.json` devDependencies; if missing, run `npm install` again.
- Missing `fastify` types in `@journeyman/identity` — Fastify is already a dep in `api-server`; either add it to identity's `peerDependencies` or import only the types via `import type { ... } from "fastify"` (already done in middleware/routes).
- `pool` not exposed from `composition.ts` — fix by exporting it (Task D1 step 3 covers this).

- [ ] **Step 2:** Run the migration to confirm the SQL is valid:

```bash
npm run infra:up
npm run migrate
```

Expected: `002_identity.sql` applies cleanly; tables `jm_orgs`, `jm_users`, `jm_auth_identities`, `jm_memberships`, `jm_refresh_tokens`, `jm_api_tokens`, `jm_system_state` exist.

- [ ] **Step 3:** Smoke-test bootstrap CLI (manual, optional):

```bash
JWT_SECRET=$(openssl rand -hex 32) \
  npx tsx packages/identity/src/cli/bootstrap.ts \
  --org "Cadmium" --slug cadmium --username admin --password 'change-me' \
  --display-name 'Admin'
```

Expected: prints `{ ok: true, org: {...}, user: {...} }`. Re-running prints `Bootstrap failed: System already bootstrapped`.

---

## Spec Coverage Cross-Reference

| Spec section | Task(s) |
|---|---|
| Entity model + invariants | A1, A2 |
| Package layout | A3, B*, C* |
| Migration / data model | A1 |
| API surface — bootstrap | C4 |
| API surface — auth | C3 |
| API surface — org admin | C5 |
| API surface — user self-service | C6 |
| API surface — API tokens | C7 |
| Authorization middleware | C1 |
| Bootstrap flow (web + CLI) | B3, C2, C4 |
| JWT specifics | B1 |
| Refresh + API token hashing | B2 |
| Run context | A2, C1 |
| Authorization rules table | C1, C5, C7 |
| Rollout step "wire requireAuth" | D1 |
| Rollout step "SPA setup wizard + login" | D2 |
| Rollout step "delete no-auth-provider" | D3 |

