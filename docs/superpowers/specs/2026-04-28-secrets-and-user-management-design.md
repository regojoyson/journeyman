# Secrets & User Management Design

**Status:** Draft — design approved in brainstorming, awaiting spec review.
**Depends on:** [Identity Foundation](2026-04-28-identity-foundation-design.md) (users, orgs, memberships, `RunContext`, `requireAuth`).
**Targets:** spec #2 of the identity stack — closes the "cred-vault" placeholder referenced in the identity foundation plan.

---

## 1. Goal

Give Journeyman a place to store and resolve the credentials that coding-CLI runs and provider operations need (`GITHUB_TOKEN`, `JIRA_TOKEN`, `OPENAI_API_KEY`, …) at three scopes — **user**, **org**, and **global** (deployment env file) — and finish the admin user-management surface that the identity foundation left open (list users, disable/reactivate, admin password reset, edit profile).

A coding-CLI run resolves its required secrets immediately before subprocess spawn, fails fast if any are missing, and never persists plaintext into run records or logs.

## 2. Non-goals

- Secret versioning, rotation history, or expiry — overwrite in place; if you need to rotate, delete and recreate.
- External KMS integration (AWS KMS, Vault, …) — single app-level AES-256-GCM key, same posture as `JWT_SECRET`.
- Invitation emails or self-signup — admin still sets a temp password out-of-band, same as today.
- Cross-org sharing, secret import/export, `.env` download — by design.
- Force-logout of disabled users — they're kicked out on next access-JWT refresh (≤15 min).
- A user-facing audit log UI — `created_by` is captured in the DB but not surfaced in v1.

## 3. Architecture

**New package `@journeyman/secrets`** owns:
- AES-256-GCM seal/open primitives (`crypto.ts`).
- Secrets DB layer (`db.ts`) — only ever queries by `(orgId, userId)` pinned from `RunContext`; no foreign-userId helpers exist.
- Routes for org-scope and user-scope secrets, plus the read-only global lister.
- Run-time `resolveSecrets(...)` — in-process function the orchestrator calls before each run.
- `MissingSecretsError` (carries `{ missing: string[] }`).

**Existing package `@journeyman/identity` extended** with the user-lifecycle endpoints from §7 (list, status change, admin password reset, profile edit). These belong in identity, not secrets.

**Existing package `@journeyman/core` extended** with `SecretRecord`, `SecretScope = "user" | "org" | "global"`, and `MissingSecretsError`. (`UserStatus` already exists in identity types.)

**Migration `003_secrets.sql`** in `@journeyman/migrations` adds one table.

**`@journeyman/api-server`** registers the new routes and exposes the `pg.Pool` to the resolver.

**`@journeyman/orchestrator`** (or wherever flow steps execute) calls `resolveSecrets` before subprocess spawn / SDK call and converts `MissingSecretsError` into a structured run failure.

**`@journeyman/web`** gets three new pages: `/admin/users`, `/admin/secrets`, `/me/secrets`.

```
+------------------+         +------------------------+
|  SPA (web)       | <--->   | api-server             |
|  /admin/users    |  HTTP   |  + identity routes     |
|  /admin/secrets  |         |  + secrets routes      |
|  /me/secrets     |         |  + requireAuth mw      |
+------------------+         +-----------+------------+
                                         |
                                         v
                              +----------+-----------+
                              |  @journeyman/secrets |
                              |   crypto / db        |
                              |   resolveSecrets()   |
                              +----------+-----------+
                                         |
                          +--------------+---------------+
                          v                              v
              +-----------+----------+        +----------+----------+
              | Postgres jm_secrets  |        | process.env         |
              |  user-scope          |        |  JM_GLOBAL_*        |
              |  org-scope           |        |  (global tier only) |
              +----------------------+        +---------------------+
```

## 4. Entity model

A secret is `{ id, orgId, userId?, name, description?, ciphertext, iv, authTag, createdBy, createdAt, updatedAt }`.

- **Scope is implicit.** `userId IS NULL` → org-scope. `userId IS NOT NULL` → user-scope.
- **Org membership is required for both scopes.** `org_id` is non-null on every row, including user-scope, so a user-scope secret always belongs to a `(user, org)` pair. Active-org switching naturally re-scopes resolution.
- **Uniqueness within bucket.** A secret name is unique within `(org_id, user_id-or-null)`, enforced by `UNIQUE NULLS NOT DISTINCT (org_id, user_id, name)`.
- **Name validation.** `^[A-Z][A-Z0-9_]*$` (env-var convention). Rejects leading digits, lowercase, and accidental overlap with system envs.
- **Plaintext never persists.** Only `ciphertext`, 12-byte `iv`, and 16-byte `auth_tag` go to Postgres.

### 4.1 Migration `003_secrets.sql`

```sql
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

### 4.2 Core types

```ts
// packages/core/src/types/secrets.types.ts
export type SecretScope = "user" | "org" | "global";

export interface SecretRecord {
  id: string;
  orgId: string;
  userId: string | null;     // null => org-scope
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

## 5. Encryption

**Algorithm:** AES-256-GCM. **Key source:** `process.env.JM_SECRET_ENCRYPTION_KEY`.

- Preferred form: 64 hex chars (real 32-byte key, `openssl rand -hex 32`).
- Fallback: any string ≥32 chars → SHA-256'd to a 32-byte key. Documented for dev, not recommended for production.
- Missing or shorter than 32 chars → throw on first `seal`/`open` (not on module load — keeps tests and migrations from needing the key).

**Per-row layout:** independent 12-byte random `iv` and the GCM `authTag` are stored alongside `ciphertext`. No custom envelope format.

**No key-version column in v1.** When key rotation lands, add `key_version SMALLINT NOT NULL DEFAULT 1` and a re-encrypt job. Schema is forward-compatible.

```ts
// packages/secrets/src/crypto.ts
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

## 6. API surface

All routes mount on the existing Fastify app and use the existing `requireAuth` middleware. Org match (`ctx.org.id === params.orgId`) is enforced in every handler — wrong org → `403`.

### 6.1 Org-scope secrets — admin only

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET`    | `/api/orgs/:orgId/secrets`     | — | `[{ id, name, description, createdBy, createdAt, updatedAt }]` (no plaintext, ever) |
| `POST`   | `/api/orgs/:orgId/secrets`     | `{ name, value, description? }` | `201 { id, name, description, createdAt }` |
| `PATCH`  | `/api/orgs/:orgId/secrets/:id` | `{ value?, description? }` | `{ ok: true }` |
| `DELETE` | `/api/orgs/:orgId/secrets/:id` | — | `{ ok: true }` |

### 6.2 User-scope secrets — self only

`:userId` is **not** a route parameter. The path uses `me` and the handler uses `ctx.user.id` exclusively.

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET`    | `/api/orgs/:orgId/users/me/secrets`     | — | `[{ id, name, description, createdAt, updatedAt }]` |
| `POST`   | `/api/orgs/:orgId/users/me/secrets`     | `{ name, value, description? }` | `201 { id, name, description, createdAt }` |
| `PATCH`  | `/api/orgs/:orgId/users/me/secrets/:id` | `{ value?, description? }` | `{ ok: true }` |
| `DELETE` | `/api/orgs/:orgId/users/me/secrets/:id` | — | `{ ok: true }` |

There is **no** route for reading another user's secrets. Admins cannot list, read, or modify another user's user-scope secrets — even names. The DB layer does not expose a "by foreign userId" helper.

### 6.3 Resolver helper (HTTP) — caller-self only

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/orgs/:orgId/secrets/_resolve?names=A,B,C` | `{ A: "...", B: "...", C: null }` |

Returns merged plaintext (user > org > global) for the **calling user**. Same-org check applies. This is the only read path that returns plaintext, and it is always self-scoped.

In practice, the orchestrator calls the in-process function (§8) rather than this HTTP endpoint. The HTTP form exists for future external runners.

### 6.4 Global secrets — admin-readable names only

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/global-secrets` | `[{ name, source: "env" }]` |

Lists names of `process.env.JM_GLOBAL_*` secrets. Values are never returned. Members do not see this list.

### 6.5 Update / rename rules

- `PATCH` allows changing `value` and/or `description` independently. Either field omitted → unchanged.
- Renaming (`name`) is not allowed on `PATCH` — delete + recreate.
- Duplicate name within bucket → `409 Conflict`.

## 7. Authorization

Single combined table covering every route × role combo (post-`requireAuth`, caller is a member of `:orgId`):

| Route | `member` | `admin` |
|---|---|---|
| `GET    /api/orgs/:orgId/secrets`                 | 403 | ✅ |
| `POST   /api/orgs/:orgId/secrets`                 | 403 | ✅ |
| `PATCH  /api/orgs/:orgId/secrets/:id`             | 403 | ✅ |
| `DELETE /api/orgs/:orgId/secrets/:id`             | 403 | ✅ |
| `GET    /api/orgs/:orgId/users/me/secrets`        | ✅ | ✅ |
| `POST   /api/orgs/:orgId/users/me/secrets`        | ✅ | ✅ |
| `PATCH  /api/orgs/:orgId/users/me/secrets/:id`    | ✅ | ✅ |
| `DELETE /api/orgs/:orgId/users/me/secrets/:id`    | ✅ | ✅ |
| `GET    /api/orgs/:orgId/secrets/_resolve`        | ✅ | ✅ |
| `GET    /api/global-secrets`                      | 403 | ✅ |
| `GET    /api/orgs/:orgId/users`                   | 403 | ✅ |
| `PATCH  /api/orgs/:orgId/users/:userId/status`    | 403 | ✅ |
| `POST   /api/orgs/:orgId/users/:userId/reset-password` | 403 | ✅ |
| `PATCH  /api/orgs/:orgId/users/:userId/profile`   | 403 | ✅ |

**Cross-cutting invariants enforced in handlers:**

1. **Org match.** Every handler asserts `ctx.org.id === params.orgId`; mismatch → `403 Wrong org`.
2. **Row ownership on user-scope writes.** `PATCH`/`DELETE` lookups use `WHERE id = $1 AND org_id = $2 AND user_id = $3` with the caller's `ctx.user.id`. A row that doesn't match returns `404` (not `403`) — don't leak existence.
3. **Admin cannot read user-scope plaintext.** No DB helper accepts a foreign `userId`. The only callers that pass `userId` use `ctx.user.id`.
4. **`_resolve` is always self-scoped.** Uses `ctx.user.id` and `ctx.org.id` exclusively; no input that can redirect to another user/org.
5. **API-token callers** inherit the role of the membership they were minted under. A member's API token has member privileges; an admin's API token has admin privileges. Same rules above apply.
6. **Last-admin guard.** Disabling the membership of the only remaining `admin` of an org → `409 Conflict`. (Applies to the user-lifecycle endpoints in §9.1.) An admin cannot disable their own account or reset their own password through admin endpoints — they must use the existing `/api/users/me/password` self-service route.

**Failure-mode summary:** missing/invalid auth → `401`; wrong role → `403`; row not found → `404`; bad input → `400`; duplicate within scope → `409`.

## 8. Run-time injection

### 8.1 Three-tier precedence

`user > org > global`. First match wins; missing at all three → `MissingSecretsError`.

### 8.2 Global tier — `.env` only

Convention: any `process.env.JM_GLOBAL_<NAME>` becomes global secret `<NAME>`.

```bash
# .env
JM_GLOBAL_GITHUB_TOKEN=ghp_...
JM_GLOBAL_JIRA_TOKEN=...
```

- Read once at api-server boot, memoized. Restart to pick up changes.
- Names not matching `^[A-Z][A-Z0-9_]*$` after the prefix are ignored.
- Never persisted to Postgres, never encrypted by us — `.env` is the storage boundary.
- No write API. Deployment owners manage these out-of-band.

```ts
// packages/secrets/src/global.ts
const GLOBAL_PREFIX = "JM_GLOBAL_";

export function readGlobalSecrets(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith(GLOBAL_PREFIX) || v == null) continue;
    const name = k.slice(GLOBAL_PREFIX.length);
    if (/^[A-Z][A-Z0-9_]*$/.test(name)) out[name] = v;
  }
  return out;
}
```

### 8.3 Step declares its required set

`FlowStepDefinition` gains one optional field:

```ts
// @journeyman/core
export interface FlowStepDefinition {
  // ...existing fields...
  requiredSecrets?: string[];   // env-var names, e.g. ["GITHUB_TOKEN", "JIRA_TOKEN"]
}
```

A flow's effective required set = union of `requiredSecrets` across its steps, computed once at flow load.

### 8.4 In-process resolver

```ts
// packages/secrets/src/resolver.ts
export interface ResolveInput {
  pool: Pool;
  ctx: RunContext;       // pins orgId + userId
  names: string[];        // step's requiredSecrets
}
export interface ResolveResult { values: Record<string, string>; }

export async function resolveSecrets(input: ResolveInput): Promise<ResolveResult>;
```

Algorithm:
1. Validate every `name` matches `^[A-Z][A-Z0-9_]*$` — invalid names are a programming error; throw immediately.
2. Single round trip:
   ```sql
   SELECT name, ciphertext, iv, auth_tag, user_id
     FROM jm_secrets
    WHERE org_id = $1
      AND name = ANY($2)
      AND (user_id = $3 OR user_id IS NULL)
   ```
3. Group by name; choose user-scope row over org-scope row.
4. For names still missing, fall back to the memoized global map.
5. Anything still missing → `throw new MissingSecretsError(missing)`. Run never starts.

The orchestrator catches `MissingSecretsError` and emits a structured run failure: `status: "failed"`, `reason: "missing_secrets"`, `details: { missing: [...] }`. The SPA renders this with deep links to `/me/secrets`.

### 8.5 Subprocess injection

```ts
const child = spawn(cmd, args, {
  ...,
  env: { ...process.env, ...resolved.values },
});
```

`...process.env` first so resolved values override stale ambient env vars. `resolved.values` is dropped after spawn; nothing is logged.

### 8.6 Claude Agent SDK calls

The SDK runs inside the api-server process and inherits its env. To avoid leaking plaintext into long-lived `process.env`:

- **Preferred:** pass per-call env override if the SDK exposes one. (Verify against `.claude/sdk.d.ts` `Options` shape during implementation.)
- **Fallback:** spawn the SDK call in a child process with a curated env, parent process's `process.env` untouched.

Implementation will pick whichever the SDK actually supports. Documenting this here as a known integration point — not a blocker for the spec.

## 9. User management — closing the identity-foundation gap

### 9.1 New endpoints in `@journeyman/identity`

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| `GET`    | `/api/orgs/:orgId/users`                          | admin | — | `[{ user, membership }]` for the org, with `user.status` |
| `PATCH`  | `/api/orgs/:orgId/users/:userId/status`           | admin | `{ status: "active" \| "disabled" }` | `{ ok: true }` |
| `POST`   | `/api/orgs/:orgId/users/:userId/reset-password`   | admin | `{ tempPassword? }` | `{ tempPassword }` (server-generated if omitted) |
| `PATCH`  | `/api/orgs/:orgId/users/:userId/profile`          | admin | `{ displayName?: string \| null }` | `{ ok: true }` |

**Behaviors:**
- `GET /users` is the admin-friendly listing (joins users + memberships + status). It supersedes the existing `/api/orgs/:orgId/memberships` for SPA use; the older endpoint stays but is deprecated.
- Disabling sets `jm_users.status = 'disabled'`. The login route already filters `WHERE status = 'active'`, so the user can't log in. Active access-JWTs remain valid until expiry (≤15 min) — acceptable for v1; a force-logout endpoint can be added later.
- `reset-password` accepts an optional `tempPassword`; if omitted, a 12-char `randomBytes(9).toString("base64url")` password is generated and returned to the admin. Admin shares it out-of-band. No email.
- `PATCH /profile` lets admins fix display names. Self-edits go through the existing `/api/users/me`.
- Last-admin guard returns `409` for any operation that would leave an org with zero active admins.
- Admins cannot use these endpoints on themselves to disable or reset their own password — those would self-lock and must go through self-service routes.

### 9.2 SPA pages

Three new pages, all behind `AuthGate`:

1. **`/admin/users`** *(admin only)* — table with username, display name, role, status, joined. Row actions: change role, disable / reactivate, reset password, edit profile, remove from org. Top-bar "Invite user" button (existing endpoint).
2. **`/admin/secrets`** *(admin only)* — three sections:
   - **Global** (read-only, names + `source: "env"`) — fetched from `GET /api/global-secrets`.
   - **Organization** — full CRUD on org-scope. Create form shows the entered value once; after submit the plaintext is gone.
3. **`/me/secrets`** *(every user)* — full CRUD on user-scope, same UX.

**Navigation:** an "Admin" menu (visible only when `ctx.role === "admin"`) links to Users + Org Secrets. A "My Secrets" link lives in the user menu for everyone.

**Run-failure UX:** the run-detail page renders `missing_secrets` failures with deep links to `/me/secrets`, suggesting user-scope as the recommended place to add the missing secrets (since user > org > global).

## 10. Failure modes & invariants — quick reference

| Situation | HTTP / behavior |
|---|---|
| Auth missing or invalid | `401` |
| Authenticated, wrong role | `403` |
| Authenticated, right role, row not for caller | `404` (don't leak existence) |
| Bad input (invalid name, missing value) | `400` |
| Duplicate name in same bucket | `409` |
| Last admin would be removed/disabled | `409` |
| Resolver: any required name missing across all 3 tiers | `MissingSecretsError` → run fails before subprocess spawn |
| Decryption fails (corruption / wrong key) | `500` with generic message; details only in server logs |

## 11. Rollout

1. Land migration `003_secrets.sql` and `@journeyman/secrets` package skeleton.
2. Encryption + DB layer + resolver (no API yet) — covered by typecheck.
3. HTTP routes (org / user / global / resolver) wired into `api-server`. Admin can manage org secrets via `curl`.
4. Identity user-lifecycle endpoints (§9.1).
5. SPA pages (§9.2).
6. Wire `requiredSecrets` into orchestrator step execution.
7. Update `coding-cli` providers to receive resolved env (subprocess + SDK paths).
8. Document `.env` conventions: `JWT_SECRET`, `JM_SECRET_ENCRYPTION_KEY`, `JM_GLOBAL_*`.

Implementation plan (task ordering, parallel groups, file-by-file steps) is produced separately by the writing-plans skill — this spec only sets the design contract.

## 12. Open implementation questions

- **SDK env override.** The Claude Agent SDK call path needs verification: does `query()`'s `Options` accept a per-call env override, or do we need the child-process fallback (§8.6)? Decide during implementation.
- **`/api/orgs/:orgId/memberships` vs `/api/orgs/:orgId/users`.** Both exist after this spec. We can either deprecate-and-keep the old one for one release or rename in place. Pick during implementation.

---
