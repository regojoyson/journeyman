# Secrets & User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Land the secrets system (user/org/global scopes, AES-256-GCM, fail-fast resolver) plus the admin user-lifecycle endpoints, per [the spec](../specs/2026-04-28-secrets-and-user-management-design.md).

**Architecture:** New `@journeyman/secrets` package (crypto, db, resolver, routes). `@journeyman/identity` extended with user-lifecycle routes. New `SecretsCredentialStore` plugs into the existing `worker-harness.resolvedEnv` path.

**Tech Stack:** Postgres + `pg`, Node `crypto` (AES-256-GCM), Fastify, TypeScript, React.

**User constraints:**
- No unit tests.
- No git commits — leave changes uncommitted.
- Typecheck runs once at the end.
- Tasks organized into parallel groups; tasks in the same group can run concurrently.

---

## Parallel Execution Map

| Group | Tasks | Depends on |
|---|---|---|
| **A** (parallel) | A1, A2, A3 | — |
| **B** (parallel) | B1, B2, B3 | A2, A3 |
| **C** (single)   | C1 (resolver) | B1, B3 |
| **D** (parallel) | D1, D2, D3, D4, D5 | C1 |
| **E** (parallel) | E1 (identity user-mgmt), E2 (FlowStepDefinition field) | A2 |
| **F** (sequential) | F1 → F2 | D5, E1, E2, C1 |
| **G** (parallel) | G1, G2, G3, G4 | F1 |
| **H** (final) | H1 (typecheck) | F2, G4 |

---

## Group A — Foundations (parallel)

### Task A1: Migration `003_secrets.sql`

**Files:** Create `packages/migrations/src/sql/003_secrets.sql`.

- [ ] **Step 1:** Write file:

```sql
-- 003_secrets.sql — encrypted user/org-scope secrets.

CREATE TABLE IF NOT EXISTS jm_secrets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES jm_orgs(id)  ON DELETE CASCADE,
  user_id       UUID          REFERENCES jm_users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  ciphertext    BYTEA NOT NULL,
  iv            BYTEA NOT NULL,
  auth_tag      BYTEA NOT NULL,
  created_by    UUID NOT NULL REFERENCES jm_users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jm_secrets_scope_unique UNIQUE NULLS NOT DISTINCT (org_id, user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_jm_secrets_org_user ON jm_secrets (org_id, user_id);
```

---

### Task A2: Core types

**Files:**
- Create `packages/core/src/types/secrets.types.ts`
- Modify `packages/core/src/index.ts`

- [ ] **Step 1:** Write `packages/core/src/types/secrets.types.ts`:

```ts
export type SecretScope = "user" | "org" | "global";

export interface SecretRecord {
  id: string;
  orgId: string;
  userId: string | null;
  name: string;
  description: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export class MissingSecretsError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Missing required secrets: ${missing.join(", ")}`);
    this.name = "MissingSecretsError";
  }
}
```

- [ ] **Step 2:** Append to `packages/core/src/index.ts`:

```ts
export * from "./types/secrets.types.ts";
```

---

### Task A3: Scaffold `@journeyman/secrets`

**Files:**
- Create `packages/secrets/package.json`
- Create `packages/secrets/tsconfig.json`
- Create `packages/secrets/src/index.ts`

- [ ] **Step 1:** `packages/secrets/package.json`:

```json
{
  "name": "@journeyman/secrets",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./routes": "./src/routes/index.ts"
  },
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@journeyman/core": "*",
    "@journeyman/identity": "*",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "@types/pg": "^8.11.10",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 2:** `packages/secrets/tsconfig.json`:

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

- [ ] **Step 3:** `packages/secrets/src/index.ts` (placeholder, populated later):

```ts
export {};
```

- [ ] **Step 4:** From repo root, run `npm install` to link the workspace.

---

## Group B — Primitives (parallel after A2 + A3)

### Task B1: Crypto module

**Files:** Create `packages/secrets/src/crypto.ts`.

- [ ] **Step 1:** Write file (verbatim from spec §5):

```ts
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  const raw = process.env.JM_SECRET_ENCRYPTION_KEY;
  if (!raw) throw new Error("JM_SECRET_ENCRYPTION_KEY env var missing");
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  if (raw.length < 32) throw new Error("JM_SECRET_ENCRYPTION_KEY must be 64 hex chars or ≥32 chars");
  return createHash("sha256").update(raw).digest();
}

export interface Sealed { ciphertext: Buffer; iv: Buffer; authTag: Buffer; }

export function seal(plaintext: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function open(s: Sealed): string {
  const decipher = createDecipheriv(ALGO, key(), s.iv);
  decipher.setAuthTag(s.authTag);
  return Buffer.concat([decipher.update(s.ciphertext), decipher.final()]).toString("utf8");
}
```

---

### Task B2: Global tier reader

**Files:** Create `packages/secrets/src/global.ts`.

- [ ] **Step 1:** Write file:

```ts
const GLOBAL_PREFIX = "JM_GLOBAL_";
const NAME_RE = /^[A-Z][A-Z0-9_]*$/;

let cached: Record<string, string> | null = null;

export function readGlobalSecrets(): Record<string, string> {
  if (cached) return cached;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith(GLOBAL_PREFIX) || v == null) continue;
    const name = k.slice(GLOBAL_PREFIX.length);
    if (NAME_RE.test(name)) out[name] = v;
  }
  cached = out;
  return out;
}

export function listGlobalSecretNames(): string[] {
  return Object.keys(readGlobalSecrets()).sort();
}
```

---

### Task B3: DB layer

**Files:** Create `packages/secrets/src/db.ts`.

- [ ] **Step 1:** Write file:

```ts
import type { Pool } from "pg";
import type { SecretRecord } from "@journeyman/core";
import { open, seal } from "./crypto.ts";

const NAME_RE = /^[A-Z][A-Z0-9_]*$/;

export function validateName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`Invalid secret name: ${name}`);
}

function rowToRecord(r: any): SecretRecord {
  return {
    id: r.id, orgId: r.org_id, userId: r.user_id,
    name: r.name, description: r.description,
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export class DuplicateSecretError extends Error {
  constructor(name: string) { super(`Secret already exists: ${name}`); this.name = "DuplicateSecretError"; }
}

export interface InsertInput {
  orgId: string;
  userId: string | null;
  name: string;
  value: string;
  description?: string | null;
  createdBy: string;
}

async function insertSecret(pool: Pool, input: InsertInput): Promise<SecretRecord> {
  validateName(input.name);
  const sealed = seal(input.value);
  try {
    const r = await pool.query(
      `INSERT INTO jm_secrets (org_id, user_id, name, description, ciphertext, iv, auth_tag, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, org_id, user_id, name, description, created_by, created_at, updated_at`,
      [input.orgId, input.userId, input.name, input.description ?? null,
       sealed.ciphertext, sealed.iv, sealed.authTag, input.createdBy],
    );
    return rowToRecord(r.rows[0]);
  } catch (err: any) {
    if (err.code === "23505") throw new DuplicateSecretError(input.name);
    throw err;
  }
}

// --- Org-scope ---

export function insertOrgSecret(pool: Pool, input: Omit<InsertInput, "userId">): Promise<SecretRecord> {
  return insertSecret(pool, { ...input, userId: null });
}

export async function listOrgSecrets(pool: Pool, orgId: string): Promise<SecretRecord[]> {
  const r = await pool.query(
    `SELECT id, org_id, user_id, name, description, created_by, created_at, updated_at
       FROM jm_secrets WHERE org_id = $1 AND user_id IS NULL ORDER BY name`,
    [orgId],
  );
  return r.rows.map(rowToRecord);
}

// --- User-scope (always pinned to caller's userId — no foreign-userId helper exposed) ---

export function insertUserSecret(pool: Pool, input: InsertInput & { userId: string }): Promise<SecretRecord> {
  return insertSecret(pool, input);
}

export async function listUserSecrets(pool: Pool, orgId: string, userId: string): Promise<SecretRecord[]> {
  const r = await pool.query(
    `SELECT id, org_id, user_id, name, description, created_by, created_at, updated_at
       FROM jm_secrets WHERE org_id = $1 AND user_id = $2 ORDER BY name`,
    [orgId, userId],
  );
  return r.rows.map(rowToRecord);
}

// --- Updates / deletes (scope-aware: pass userId=null for org-scope) ---

export interface UpdateInput {
  id: string;
  orgId: string;
  userId: string | null;
  value?: string;
  description?: string | null;
}

export async function updateSecret(pool: Pool, input: UpdateInput): Promise<boolean> {
  const sets: string[] = [];
  const params: any[] = [input.id, input.orgId];
  const userClause = input.userId === null ? "AND user_id IS NULL" : "AND user_id = $3";
  if (input.userId !== null) params.push(input.userId);

  if (input.value !== undefined) {
    const sealed = seal(input.value);
    sets.push(`ciphertext = $${params.length + 1}`); params.push(sealed.ciphertext);
    sets.push(`iv = $${params.length + 1}`);          params.push(sealed.iv);
    sets.push(`auth_tag = $${params.length + 1}`);    params.push(sealed.authTag);
  }
  if (input.description !== undefined) {
    sets.push(`description = $${params.length + 1}`); params.push(input.description);
  }
  if (sets.length === 0) return true;
  sets.push(`updated_at = now()`);

  const r = await pool.query(
    `UPDATE jm_secrets SET ${sets.join(", ")}
      WHERE id = $1 AND org_id = $2 ${userClause}`,
    params,
  );
  return (r.rowCount ?? 0) > 0;
}

export async function deleteSecret(
  pool: Pool, id: string, orgId: string, userId: string | null,
): Promise<boolean> {
  const userClause = userId === null ? "AND user_id IS NULL" : "AND user_id = $3";
  const params: any[] = userId === null ? [id, orgId] : [id, orgId, userId];
  const r = await pool.query(
    `DELETE FROM jm_secrets WHERE id = $1 AND org_id = $2 ${userClause}`,
    params,
  );
  return (r.rowCount ?? 0) > 0;
}

// --- Resolver helper (used by Group C) ---

export interface ResolverRow { name: string; userId: string | null; value: string; }

export async function fetchForResolve(
  pool: Pool, orgId: string, userId: string, names: string[],
): Promise<ResolverRow[]> {
  if (names.length === 0) return [];
  const r = await pool.query(
    `SELECT name, user_id, ciphertext, iv, auth_tag
       FROM jm_secrets
      WHERE org_id = $1
        AND name = ANY($2::text[])
        AND (user_id = $3 OR user_id IS NULL)`,
    [orgId, names, userId],
  );
  return r.rows.map((row: any) => ({
    name: row.name,
    userId: row.user_id,
    value: open({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }),
  }));
}
```

---

## Group C — Resolver (after B1 + B3)

### Task C1: `resolveSecrets`

**Files:** Create `packages/secrets/src/resolver.ts`.

- [ ] **Step 1:** Write file:

```ts
import type { Pool } from "pg";
import { MissingSecretsError, type RunContext } from "@journeyman/core";
import { validateName, fetchForResolve } from "./db.ts";
import { readGlobalSecrets } from "./global.ts";

export interface ResolveInput {
  pool: Pool;
  ctx: RunContext;
  names: string[];
}

export interface ResolveResult { values: Record<string, string>; }

export async function resolveSecrets(input: ResolveInput): Promise<ResolveResult> {
  const names = Array.from(new Set(input.names));
  for (const n of names) validateName(n);
  if (names.length === 0) return { values: {} };

  const rows = await fetchForResolve(input.pool, input.ctx.org.id, input.ctx.user.id, names);

  // Pick: user-scope row beats org-scope row, regardless of fetch order.
  const picked: Record<string, string> = {};
  for (const row of rows) {
    const isUserScope = row.userId === input.ctx.user.id;
    if (isUserScope) picked[row.name] = row.value;
    else if (picked[row.name] === undefined) picked[row.name] = row.value;
  }

  const globals = readGlobalSecrets();
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    if (picked[name] !== undefined) values[name] = picked[name];
    else if (globals[name] !== undefined) values[name] = globals[name];
    else missing.push(name);
  }
  if (missing.length > 0) throw new MissingSecretsError(missing);
  return { values };
}
```

---

## Group D — Routes + barrel (parallel after C1)

### Task D1: Org-scope routes

**Files:** Create `packages/secrets/src/routes/org-secrets.ts`.

- [ ] **Step 1:** Write file:

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  DuplicateSecretError, deleteSecret, insertOrgSecret, listOrgSecrets, updateSecret,
} from "../db.ts";

export async function registerOrgSecretRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/secrets",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const rows = await listOrgSecrets(pool, orgId);
      return rows.map(r => ({
        id: r.id, name: r.name, description: r.description,
        createdBy: r.createdBy, createdAt: r.createdAt, updatedAt: r.updatedAt,
      }));
    });

  app.post("/api/orgs/:orgId/secrets",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { name?: string; value?: string; description?: string };
      if (!body?.name || !body?.value) return reply.code(400).send({ error: "Missing name or value" });
      try {
        const rec = await insertOrgSecret(pool, {
          orgId, name: body.name, value: body.value,
          description: body.description ?? null, createdBy: req.runContext!.user.id,
        });
        reply.code(201);
        return { id: rec.id, name: rec.name, description: rec.description, createdAt: rec.createdAt };
      } catch (err) {
        if (err instanceof DuplicateSecretError) return reply.code(409).send({ error: err.message });
        if (err instanceof Error && /Invalid secret name/.test(err.message)) return reply.code(400).send({ error: err.message });
        throw err;
      }
    });

  app.patch("/api/orgs/:orgId/secrets/:id",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { value?: string; description?: string | null };
      const ok = await updateSecret(pool, {
        id, orgId, userId: null,
        value: body?.value, description: body?.description,
      });
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });

  app.delete("/api/orgs/:orgId/secrets/:id",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const ok = await deleteSecret(pool, id, orgId, null);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });
}
```

---

### Task D2: User-scope routes

**Files:** Create `packages/secrets/src/routes/user-secrets.ts`.

- [ ] **Step 1:** Write file:

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  DuplicateSecretError, deleteSecret, insertUserSecret, listUserSecrets, updateSecret,
} from "../db.ts";

export async function registerUserSecretRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/users/me/secrets",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const rows = await listUserSecrets(pool, orgId, ctx.user.id);
      return rows.map(r => ({
        id: r.id, name: r.name, description: r.description,
        createdAt: r.createdAt, updatedAt: r.updatedAt,
      }));
    });

  app.post("/api/orgs/:orgId/users/me/secrets",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { name?: string; value?: string; description?: string };
      if (!body?.name || !body?.value) return reply.code(400).send({ error: "Missing name or value" });
      try {
        const rec = await insertUserSecret(pool, {
          orgId, userId: ctx.user.id, name: body.name, value: body.value,
          description: body.description ?? null, createdBy: ctx.user.id,
        });
        reply.code(201);
        return { id: rec.id, name: rec.name, description: rec.description, createdAt: rec.createdAt };
      } catch (err) {
        if (err instanceof DuplicateSecretError) return reply.code(409).send({ error: err.message });
        if (err instanceof Error && /Invalid secret name/.test(err.message)) return reply.code(400).send({ error: err.message });
        throw err;
      }
    });

  app.patch("/api/orgs/:orgId/users/me/secrets/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { value?: string; description?: string | null };
      const ok = await updateSecret(pool, {
        id, orgId, userId: ctx.user.id,
        value: body?.value, description: body?.description,
      });
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });

  app.delete("/api/orgs/:orgId/users/me/secrets/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const ok = await deleteSecret(pool, id, orgId, ctx.user.id);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });
}
```

---

### Task D3: Global secrets + resolve routes

**Files:** Create `packages/secrets/src/routes/global-secrets.ts` and `packages/secrets/src/routes/resolve.ts`.

- [ ] **Step 1:** `packages/secrets/src/routes/global-secrets.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { listGlobalSecretNames } from "../global.ts";

export async function registerGlobalSecretRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/global-secrets",
    { preHandler: requireAuth({ role: "admin" }) },
    async () => listGlobalSecretNames().map(name => ({ name, source: "env" as const })));
}
```

- [ ] **Step 2:** `packages/secrets/src/routes/resolve.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { MissingSecretsError } from "@journeyman/core";
import { makeRequireAuth } from "@journeyman/identity";
import { resolveSecrets } from "../resolver.ts";

export async function registerResolveRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/secrets/_resolve",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const q = (req.query as { names?: string }).names ?? "";
      const names = q.split(",").map(s => s.trim()).filter(Boolean);
      const out: Record<string, string | null> = {};
      for (const n of names) out[n] = null;
      if (names.length === 0) return out;
      // Resolve each name independently so missing ones return null instead of erroring.
      await Promise.all(names.map(async n => {
        try {
          const r = await resolveSecrets({ pool, ctx, names: [n] });
          out[n] = r.values[n] ?? null;
        } catch (err) {
          if (err instanceof MissingSecretsError) out[n] = null;
          else throw err;
        }
      }));
      return out;
    });
}
```

---

### Task D4: Secrets package barrel

**Files:** Create `packages/secrets/src/routes/index.ts`. Modify `packages/secrets/src/index.ts`.

- [ ] **Step 1:** `packages/secrets/src/routes/index.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerOrgSecretRoutes } from "./org-secrets.ts";
import { registerUserSecretRoutes } from "./user-secrets.ts";
import { registerGlobalSecretRoutes } from "./global-secrets.ts";
import { registerResolveRoutes } from "./resolve.ts";

export async function registerSecretsRoutes(app: FastifyInstance, pool: Pool) {
  await registerOrgSecretRoutes(app, pool);
  await registerUserSecretRoutes(app, pool);
  await registerGlobalSecretRoutes(app, pool);
  await registerResolveRoutes(app, pool);
}
```

- [ ] **Step 2:** Replace `packages/secrets/src/index.ts`:

```ts
export * from "./crypto.ts";
export * from "./global.ts";
export * from "./resolver.ts";
export { registerSecretsRoutes } from "./routes/index.ts";
```

---

### Task D5: Secrets-backed credential store

**Files:** Create `packages/secrets/src/credential-store.ts`. Append to `packages/secrets/src/index.ts`.

This adapter implements the existing `ICredentialStore` interface so the orchestrator's `worker-harness` can keep its current call site (`credentials.resolve(declared, context)`) but back it with the new resolver.

- [ ] **Step 1:** Inspect the interface:

```bash
grep -n "ICredentialStore" packages/core/src/index.ts packages/core/src/types/*.ts
```

Then read the matching type. Use it as the contract for the class below. The current method shape in code is:

```ts
resolve(declared: Record<string, string>, context: { userId: string | null; flowId: string | null }): Promise<Record<string, string>>
```

- [ ] **Step 2:** Write `packages/secrets/src/credential-store.ts`:

```ts
import type { Pool } from "pg";
import type { ICredentialStore, RunContext } from "@journeyman/core";
import { resolveSecrets } from "./resolver.ts";

export interface SecretsCredentialStoreDeps {
  pool: Pool;
  /** Resolves the RunContext for a given run/user. The orchestrator must set this. */
  getRunContext: (input: { userId: string | null; flowId: string | null }) => Promise<RunContext | null>;
}

/**
 * Plug-compatible with the existing EnvCredentialStore: input is a
 * `declared` map of envVarName -> credentialName (treated as identity here),
 * output is envVarName -> plaintext value resolved via user>org>global.
 *
 * If RunContext is unavailable (e.g. legacy run with no user), falls back to
 * env passthrough for declared names.
 */
export class SecretsCredentialStore implements ICredentialStore {
  constructor(private readonly deps: SecretsCredentialStoreDeps) {}

  async resolve(
    declared: Record<string, string>,
    context: { userId: string | null; flowId: string | null },
  ): Promise<Record<string, string>> {
    const names = Array.from(new Set(Object.values(declared))).filter(Boolean);
    if (names.length === 0) return {};

    const ctx = await this.deps.getRunContext(context);
    if (!ctx) {
      // Legacy / unauthenticated run: pass through process.env, including JM_GLOBAL_*.
      const out: Record<string, string> = {};
      for (const [envVar, credName] of Object.entries(declared)) {
        const fromGlobal = process.env[`JM_GLOBAL_${credName}`];
        const direct = process.env[credName];
        if (fromGlobal != null) out[envVar] = fromGlobal;
        else if (direct != null) out[envVar] = direct;
      }
      return out;
    }

    const { values } = await resolveSecrets({ pool: this.deps.pool, ctx, names });
    // Map credName -> envVarName.
    const out: Record<string, string> = {};
    for (const [envVar, credName] of Object.entries(declared)) {
      if (values[credName] !== undefined) out[envVar] = values[credName];
    }
    return out;
  }
}
```

- [ ] **Step 3:** Append to `packages/secrets/src/index.ts`:

```ts
export * from "./credential-store.ts";
```

---

## Group E — Identity user-management + flow types (parallel after A2)

### Task E1: User-lifecycle endpoints in identity

**Files:**
- Modify `packages/identity/src/db.ts` (add helpers)
- Create `packages/identity/src/routes/user-management.ts`
- Modify `packages/identity/src/routes/index.ts` (register)

- [ ] **Step 1:** Append to `packages/identity/src/db.ts`:

```ts
export async function listUsersInOrg(pool: Pool, orgId: string) {
  const r = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.status, u.created_at, u.updated_at,
            m.id AS membership_id, m.role, m.created_at AS joined_at
       FROM jm_memberships m
       JOIN jm_users u ON u.id = m.user_id
      WHERE m.org_id = $1
      ORDER BY u.username`,
    [orgId],
  );
  return r.rows.map((row: any) => ({
    user: {
      id: row.id, username: row.username, displayName: row.display_name,
      status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
    },
    membership: {
      id: row.membership_id, userId: row.id, orgId,
      role: row.role, createdAt: row.joined_at,
    },
  }));
}

export async function setUserStatus(
  pool: Pool, userId: string, status: "active" | "disabled",
) {
  await pool.query(
    "UPDATE jm_users SET status = $1, updated_at = now() WHERE id = $2",
    [status, userId],
  );
}

export async function countActiveAdminsInOrg(pool: Pool, orgId: string): Promise<number> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM jm_memberships m JOIN jm_users u ON u.id = m.user_id
      WHERE m.org_id = $1 AND m.role = 'admin' AND u.status = 'active'`,
    [orgId],
  );
  return r.rows[0].n;
}

export async function isOrgAdmin(pool: Pool, orgId: string, userId: string): Promise<boolean> {
  const r = await pool.query(
    "SELECT 1 FROM jm_memberships WHERE org_id = $1 AND user_id = $2 AND role = 'admin'",
    [orgId, userId],
  );
  return r.rows.length > 0;
}

export async function adminUpdateUserProfile(
  pool: Pool, userId: string, displayName: string | null,
) {
  await pool.query(
    "UPDATE jm_users SET display_name = $1, updated_at = now() WHERE id = $2",
    [displayName, userId],
  );
}
```

- [ ] **Step 2:** Create `packages/identity/src/routes/user-management.ts`:

```ts
import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "../middleware.ts";
import {
  adminUpdateUserProfile, countActiveAdminsInOrg, findMembership, isOrgAdmin,
  listUsersInOrg, setUserStatus, updateUserPassword,
} from "../db.ts";

export async function registerUserManagementRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/users",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listUsersInOrg(pool, orgId);
    });

  app.patch("/api/orgs/:orgId/users/:userId/status",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, userId } = req.params as { orgId: string; userId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      if (ctx.user.id === userId) return reply.code(400).send({ error: "Cannot change your own status" });
      const body = req.body as { status?: "active" | "disabled" };
      if (body?.status !== "active" && body?.status !== "disabled") {
        return reply.code(400).send({ error: "Bad status" });
      }
      const m = await findMembership(pool, userId, orgId);
      if (!m) return reply.code(404).send({ error: "Not a member" });
      if (body.status === "disabled" && await isOrgAdmin(pool, orgId, userId)) {
        const remaining = await countActiveAdminsInOrg(pool, orgId);
        if (remaining <= 1) return reply.code(409).send({ error: "Cannot disable last admin" });
      }
      await setUserStatus(pool, userId, body.status);
      return { ok: true };
    });

  app.post("/api/orgs/:orgId/users/:userId/reset-password",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, userId } = req.params as { orgId: string; userId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      if (ctx.user.id === userId) return reply.code(400).send({ error: "Use self-service to change your own password" });
      const m = await findMembership(pool, userId, orgId);
      if (!m) return reply.code(404).send({ error: "Not a member" });
      const body = (req.body ?? {}) as { tempPassword?: string };
      const tempPassword = body.tempPassword ?? randomBytes(9).toString("base64url");
      await updateUserPassword(pool, userId, await bcrypt.hash(tempPassword, 12));
      return { tempPassword };
    });

  app.patch("/api/orgs/:orgId/users/:userId/profile",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, userId } = req.params as { orgId: string; userId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const m = await findMembership(pool, userId, orgId);
      if (!m) return reply.code(404).send({ error: "Not a member" });
      const body = req.body as { displayName?: string | null };
      await adminUpdateUserProfile(pool, userId, body?.displayName ?? null);
      return { ok: true };
    });
}
```

- [ ] **Step 3:** Modify `packages/identity/src/routes/index.ts` to register the new module. Add the import and call:

```ts
import { registerUserManagementRoutes } from "./user-management.ts";
// ... inside registerIdentityRoutes(app, pool):
await registerUserManagementRoutes(app, pool);
```

Also add the last-admin guard to the existing `DELETE /api/orgs/:orgId/memberships/:userId` and `PATCH .../memberships/:userId` (role change) handlers in `routes/orgs.ts`. For each, before mutating, check:

```ts
if (await isOrgAdmin(pool, orgId, userId)) {
  const remaining = await countActiveAdminsInOrg(pool, orgId);
  if (remaining <= 1) return reply.code(409).send({ error: "Cannot remove last admin" });
}
```

Place this check after the same-org assertion and before the mutation in both handlers.

---

### Task E2: Add `requiredSecrets` to FlowStepDefinition

**Files:** Modify `packages/core/src/types/pipeline.types.ts`.

- [ ] **Step 1:** Locate the `FlowStepDefinition` type (around line 74) and add the optional field:

```ts
export type FlowStepDefinition = {
  id: string;
  phase: string;
  config?: Record<string, unknown>;
  retry?: { attempts: number; backoffMs: number };
  timeoutMs?: number;
  onFailure?: "fail" | "skip" | "retry" | "block";
  retryable?: boolean;
  requiredSecrets?: string[];  // env-var names; resolved before step exec
};
```

---

## Group F — Wire it up (sequential)

### Task F1: Mount routes + plug credential store in `api-server`

**Files:**
- Modify `packages/api-server/package.json` (add deps)
- Modify `packages/api-server/src/composition.ts`
- Modify `packages/api-server/src/server.ts` (route registration)

- [ ] **Step 1:** Add to `packages/api-server/package.json` `dependencies`:

```json
"@journeyman/secrets": "*"
```

Then run `npm install` from repo root.

- [ ] **Step 2:** Modify `packages/api-server/src/composition.ts` to use `SecretsCredentialStore` when running on Postgres:

```ts
import { SecretsCredentialStore } from "@journeyman/secrets";
import { findMembership, getOrg, getUser } from "@journeyman/identity";
// ...inside buildComposition, after `pool` is created and before `credentials =`:

let credentials: ICredentialStore;
if (pool) {
  credentials = new SecretsCredentialStore({
    pool,
    // RunContext lookup: resolves user's first/active membership for credential calls.
    // For per-run context with org switch, the orchestrator should set this from the run's
    // recorded userId+orgId; here we use the legacy-friendly fallback when only userId is known.
    async getRunContext(input) {
      if (!input.userId) return null;
      // Best-effort: pick the user's first membership.
      const u = await getUser(pool!, input.userId);
      if (!u) return null;
      const memQ = await pool!.query(
        "SELECT org_id, role, id FROM jm_memberships WHERE user_id = $1 ORDER BY created_at LIMIT 1",
        [input.userId],
      );
      const m = memQ.rows[0]; if (!m) return null;
      const o = await getOrg(pool!, m.org_id); if (!o) return null;
      return {
        user: { id: u.id, username: u.username },
        org: { id: o.id, slug: o.slug },
        membershipId: m.id,
        role: m.role,
        tokenKind: "access-jwt",
      };
    },
  });
} else {
  credentials = new EnvCredentialStore();
}
```

(Remove the existing single-line `const credentials = new EnvCredentialStore();` and replace with the block above. Keep `EnvCredentialStore` as the memory fallback.)

- [ ] **Step 3:** In `packages/api-server/src/server.ts`, find where existing route modules (including `registerIdentityRoutes`) are registered and add:

```ts
import { registerSecretsRoutes } from "@journeyman/secrets";
// ... after registerIdentityRoutes:
if (composition.pool) {
  await registerSecretsRoutes(app, composition.pool);
}
```

---

### Task F2: Pass `requiredSecrets` through Conductor flow conversion

**Files:** Modify `packages/orchestrator/src/flow-json/conductor-converter.ts` and `packages/orchestrator/src/workers/worker-harness.ts`.

The worker harness already calls `credentials.resolve(declaredCreds, ctx)` with `declaredCreds = task.inputData.credentials`. We need step `requiredSecrets` to flow into that map.

- [ ] **Step 1:** In `conductor-converter.ts`, find where `FlowStepDefinition` is converted to a Conductor task definition and where `inputData` is built. Add `requiredSecrets` propagation:

```bash
grep -n "credentials\|requiredSecrets\|inputData" packages/orchestrator/src/flow-json/conductor-converter.ts
```

For each step, when assembling its `inputData`, merge:

```ts
const declared: Record<string, string> = { ...(step.config?.credentials as Record<string,string> | undefined ?? {}) };
for (const name of step.requiredSecrets ?? []) {
  declared[name] = name; // identity mapping: env var = secret name
}
inputData.credentials = declared;
```

Place this where the converter currently writes `inputData.credentials` (or, if no such write exists today, add it next to the rest of the per-step input wiring).

- [ ] **Step 2:** In `packages/orchestrator/src/workers/worker-harness.ts`, the existing line:

```ts
const resolvedEnv = await this.deps.credentials
  .resolve(declaredCreds, { userId: null, flowId: null })
  .catch(() => ({}));
```

Replace `userId: null` with the run's `startedByUserId` (already extracted as `userId` on line 79) and pass `flowId` from the task input:

```ts
const flowId = ((task.inputData ?? {}) as { flowId?: string }).flowId ?? null;
const resolvedEnv = await this.deps.credentials
  .resolve(declaredCreds, { userId, flowId })
  .catch(err => {
    // Fail the run on missing-secrets so the SPA can show actionable info.
    if (err && err.name === "MissingSecretsError") {
      void this.deps.events.append({
        runId, nodeId, eventType: "phase.failed",
        payload: { reason: "missing_secrets", missing: err.missing ?? [] },
      });
      return null;
    }
    return {};
  });
if (resolvedEnv === null) {
  await this.deps.client.updateTask({
    workflowInstanceId: runId, taskId: task.taskId,
    status: "FAILED_WITH_TERMINAL_ERROR",
    reasonForIncompletion: "missing_secrets",
  });
  return;
}
```

This swaps the silent `.catch(() => ({}))` for a typed-error handler that surfaces missing secrets as a structured run failure, matching spec §8.4.

---

## Group G — SPA pages (parallel after F1)

### Task G1: My Secrets page

**Files:** Create `packages/web/src/routes/MySecretsPage.tsx`.

- [ ] **Step 1:** Write file:

```tsx
import { useEffect, useState } from "react";

interface SecretRow { id: string; name: string; description: string | null; createdAt: string; updatedAt: string; }

export function MySecretsPage(props: { orgId: string }) {
  const [rows, setRows] = useState<SecretRow[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const base = `/api/orgs/${props.orgId}/users/me/secrets`;

  async function refresh() {
    const r = await fetch(base, { credentials: "include" });
    if (r.ok) setRows(await r.json());
  }
  useEffect(() => { refresh(); }, [props.orgId]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const r = await fetch(base, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, value, description: description || undefined }),
    });
    if (!r.ok) { setError((await r.json()).error ?? "Failed"); return; }
    setName(""); setValue(""); setDescription("");
    refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this secret?")) return;
    const r = await fetch(`${base}/${id}`, { method: "DELETE", credentials: "include" });
    if (r.ok) refresh();
  }

  return (
    <div style={{ maxWidth: 720, margin: "2rem auto" }}>
      <h1>My Secrets</h1>
      <form onSubmit={create} style={{ display: "grid", gap: 8, marginBottom: 24 }}>
        <input placeholder="NAME (e.g. GITHUB_TOKEN)" value={name} onChange={e => setName(e.target.value)} required />
        <input placeholder="value" type="password" value={value} onChange={e => setValue(e.target.value)} required />
        <input placeholder="description (optional)" value={description} onChange={e => setDescription(e.target.value)} />
        <button type="submit">Add</button>
        {error && <div style={{ color: "red" }}>{error}</div>}
      </form>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th align="left">Name</th><th align="left">Description</th><th align="left">Updated</th><th></th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td><code>{r.name}</code></td>
              <td>{r.description ?? ""}</td>
              <td>{new Date(r.updatedAt).toLocaleString()}</td>
              <td><button onClick={() => remove(r.id)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

---

### Task G2: Admin Secrets page

**Files:** Create `packages/web/src/routes/AdminSecretsPage.tsx`.

- [ ] **Step 1:** Write file:

```tsx
import { useEffect, useState } from "react";

interface OrgSecretRow { id: string; name: string; description: string | null; createdBy: string; createdAt: string; updatedAt: string; }
interface GlobalRow { name: string; source: "env"; }

export function AdminSecretsPage(props: { orgId: string }) {
  const [orgRows, setOrgRows] = useState<OrgSecretRow[]>([]);
  const [globalRows, setGlobalRows] = useState<GlobalRow[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const orgBase = `/api/orgs/${props.orgId}/secrets`;

  async function refresh() {
    const [a, b] = await Promise.all([
      fetch(orgBase, { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch("/api/global-secrets", { credentials: "include" }).then(r => r.ok ? r.json() : []),
    ]);
    setOrgRows(a); setGlobalRows(b);
  }
  useEffect(() => { refresh(); }, [props.orgId]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const r = await fetch(orgBase, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, value, description: description || undefined }),
    });
    if (!r.ok) { setError((await r.json()).error ?? "Failed"); return; }
    setName(""); setValue(""); setDescription("");
    refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this secret?")) return;
    const r = await fetch(`${orgBase}/${id}`, { method: "DELETE", credentials: "include" });
    if (r.ok) refresh();
  }

  return (
    <div style={{ maxWidth: 800, margin: "2rem auto" }}>
      <h1>Organization Secrets</h1>

      <h2 style={{ marginTop: 24 }}>Global (server config)</h2>
      <p style={{ color: "#666" }}>Read-only, set via <code>JM_GLOBAL_*</code> env vars.</p>
      <ul>{globalRows.map(g => <li key={g.name}><code>{g.name}</code></li>)}</ul>

      <h2 style={{ marginTop: 24 }}>Organization</h2>
      <form onSubmit={create} style={{ display: "grid", gap: 8, marginBottom: 24 }}>
        <input placeholder="NAME" value={name} onChange={e => setName(e.target.value)} required />
        <input placeholder="value" type="password" value={value} onChange={e => setValue(e.target.value)} required />
        <input placeholder="description (optional)" value={description} onChange={e => setDescription(e.target.value)} />
        <button type="submit">Add</button>
        {error && <div style={{ color: "red" }}>{error}</div>}
      </form>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th align="left">Name</th><th align="left">Description</th><th align="left">Updated</th><th></th></tr></thead>
        <tbody>
          {orgRows.map(r => (
            <tr key={r.id}>
              <td><code>{r.name}</code></td>
              <td>{r.description ?? ""}</td>
              <td>{new Date(r.updatedAt).toLocaleString()}</td>
              <td><button onClick={() => remove(r.id)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

---

### Task G3: Admin Users page

**Files:** Create `packages/web/src/routes/AdminUsersPage.tsx`.

- [ ] **Step 1:** Write file:

```tsx
import { useEffect, useState } from "react";

interface UserRow {
  user: { id: string; username: string; displayName: string | null; status: string };
  membership: { id: string; role: "admin" | "member"; createdAt: string };
}

export function AdminUsersPage(props: { orgId: string }) {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/orgs/${props.orgId}`;

  async function refresh() {
    const r = await fetch(`${base}/users`, { credentials: "include" });
    if (r.ok) setRows(await r.json());
  }
  useEffect(() => { refresh(); }, [props.orgId]);

  async function invite(e: React.FormEvent) {
    e.preventDefault(); setError(null); setInfo(null);
    const r = await fetch(`${base}/invitations`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: inviteUsername, role: inviteRole }),
    });
    if (!r.ok) { setError((await r.json()).error ?? "Failed"); return; }
    const body = await r.json();
    setInfo(`Invited ${inviteUsername}. Temp password: ${body.tempPassword}`);
    setInviteUsername("");
    refresh();
  }

  async function setRole(userId: string, role: "admin" | "member") {
    await fetch(`${base}/memberships/${userId}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }),
    });
    refresh();
  }

  async function setStatus(userId: string, status: "active" | "disabled") {
    const r = await fetch(`${base}/users/${userId}/status`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    if (!r.ok) setError((await r.json()).error ?? "Failed"); else refresh();
  }

  async function reset(userId: string) {
    const r = await fetch(`${base}/users/${userId}/reset-password`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (!r.ok) { setError((await r.json()).error ?? "Failed"); return; }
    const body = await r.json();
    setInfo(`Temp password: ${body.tempPassword}`);
  }

  async function remove(userId: string) {
    if (!confirm("Remove user from org?")) return;
    const r = await fetch(`${base}/memberships/${userId}`, { method: "DELETE", credentials: "include" });
    if (!r.ok) setError((await r.json()).error ?? "Failed"); else refresh();
  }

  return (
    <div style={{ maxWidth: 960, margin: "2rem auto" }}>
      <h1>Users</h1>

      <form onSubmit={invite} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input placeholder="username" value={inviteUsername} onChange={e => setInviteUsername(e.target.value)} required />
        <select value={inviteRole} onChange={e => setInviteRole(e.target.value as any)}>
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
        <button type="submit">Invite</button>
      </form>
      {info && <div style={{ background: "#eef", padding: 8, marginBottom: 8 }}>{info}</div>}
      {error && <div style={{ color: "red", marginBottom: 8 }}>{error}</div>}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <th align="left">Username</th><th align="left">Display</th>
          <th align="left">Role</th><th align="left">Status</th><th></th>
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.user.id}>
              <td>{r.user.username}</td>
              <td>{r.user.displayName ?? ""}</td>
              <td>
                <select value={r.membership.role} onChange={e => setRole(r.user.id, e.target.value as any)}>
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </td>
              <td>{r.user.status}</td>
              <td style={{ display: "flex", gap: 4 }}>
                {r.user.status === "active"
                  ? <button onClick={() => setStatus(r.user.id, "disabled")}>Disable</button>
                  : <button onClick={() => setStatus(r.user.id, "active")}>Enable</button>}
                <button onClick={() => reset(r.user.id)}>Reset password</button>
                <button onClick={() => remove(r.user.id)}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

---

### Task G4: Wire pages into routing + admin nav

**Files:** Modify `packages/web/src/main.tsx` (or wherever the router/shell lives — read first).

- [ ] **Step 1:** Find the router and the place where `/api/auth/me` result is held (the auth gate already fetches it; reuse the `activeOrg.id` and `role` fields). Reading `main.tsx` and `AuthGate.tsx`:

```bash
grep -n "Routes\|Route\|activeOrg\|role" packages/web/src/main.tsx packages/web/src/AuthGate.tsx
```

- [ ] **Step 2:** Add three routes (using existing routing primitive — likely `react-router-dom`):

```tsx
import { MySecretsPage } from "./routes/MySecretsPage.tsx";
import { AdminSecretsPage } from "./routes/AdminSecretsPage.tsx";
import { AdminUsersPage } from "./routes/AdminUsersPage.tsx";

// inside <Routes>:
<Route path="/me/secrets" element={<MySecretsPage orgId={activeOrgId} />} />
<Route path="/admin/secrets" element={role === "admin" ? <AdminSecretsPage orgId={activeOrgId} /> : <Navigate to="/" />} />
<Route path="/admin/users" element={role === "admin" ? <AdminUsersPage orgId={activeOrgId} /> : <Navigate to="/" />} />
```

- [ ] **Step 3:** Add nav links to the existing top-bar / user-menu component (whatever renders the current navigation). The "Admin" group is gated on `role === "admin"`:

```tsx
<a href="/me/secrets">My Secrets</a>
{role === "admin" && (
  <>
    <a href="/admin/users">Users</a>
    <a href="/admin/secrets">Org Secrets</a>
  </>
)}
```

If there is no shared shell yet, add the links directly into the page that hosts the main app frame.

---

## Group H — Final check

### Task H1: Typecheck

- [ ] **Step 1:** From repo root:

```bash
npm run typecheck
```

Expected: every workspace passes. Common fixes:
- `@journeyman/secrets` missing from `api-server`'s deps → already added in F1; rerun `npm install`.
- `ICredentialStore` shape mismatch → re-read its declaration in `@journeyman/core` and align `SecretsCredentialStore.resolve` signature exactly.
- Fastify type augmentation `req.runContext` already declared by `@journeyman/identity/middleware` — don't re-declare in secrets routes.
- `MissingSecretsError` not exported from `@journeyman/core` index → confirm A2 step 2 exported `secrets.types.ts`.

- [ ] **Step 2:** Apply the migration manually to confirm SQL is valid:

```bash
npm run infra:up
npm run migrate
```

Expected: `003_secrets.sql` applies; table `jm_secrets` exists with the unique constraint and index.

---

## Spec Coverage Cross-Reference

| Spec section | Task(s) |
|---|---|
| §3 Architecture (new packages, touched packages) | A3, D1–D5, E1, F1 |
| §4 Entity model + migration | A1, A2 |
| §5 Encryption | B1 |
| §6.1 Org-scope routes | D1 |
| §6.2 User-scope routes | D2 |
| §6.3 Resolver HTTP | D3 (resolve.ts) |
| §6.4 Global names listing | D3 (global-secrets.ts) |
| §7 Authorization rules + last-admin guard | D1, D2, E1 |
| §8.1–8.2 3-tier precedence + global env | B2, C1 |
| §8.3 `requiredSecrets` field | E2 |
| §8.4 In-process resolver + MissingSecretsError | C1 |
| §8.5 Subprocess injection | F2 (worker-harness uses `resolvedEnv`) |
| §8.6 SDK env override | F2 (note in worker-harness; deeper SDK-side change is separate) |
| §9.1 User-lifecycle endpoints | E1 |
| §9.2 SPA pages | G1, G2, G3, G4 |
| §11 Rollout | A → H ordering |
