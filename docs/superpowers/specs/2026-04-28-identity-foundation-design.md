# Identity Foundation — Design Spec

**Date:** 2026-04-28
**Status:** Draft (pending implementation plan)
**Scope:** Spec #1 of a 4-part series migrating per-product YAML config into a multi-tenant model.

## Context

Journeyman today configures pipelines via `config/pipeline.yaml`, where each *product* embeds repos, credentials (env-var refs), ticket workflow, model selection, and webhook secrets. We want this to move toward a system where:

- **Organizations and users** own configuration.
- **Credentials** are configured at org and user scopes, with user-scope overriding org-scope at runtime by key name.
- **Flows** reference credentials by key name only — they no longer embed env-var names or repo metadata.
- **Pluggable auth**: username+password now, additive support for SSO/OIDC later.

This is too large for a single spec. The work is decomposed into:

1. **Identity foundation** *(this spec)* — User, Org, Membership, auth, JWT, bootstrap.
2. **Credential vault** — DB-backed `ICredentialStore` with org/user-scoped resolution.
3. **Resource registry** — Repos, channels, ticket repos as owned entities.
4. **Flow consolidation** — Fold `ticketWorkflow`, models, repo refs into flows; deprecate `pipeline.yaml`.

Each piece is independently shippable. This spec covers #1.

## Goals

- Add User, Organization, Membership entities with M:N membership and `admin`/`member` roles.
- Username+password auth via a pluggable `auth_identities` table that can later host OIDC/SSO rows additively.
- Stateless JWT access tokens (15 min) + opaque, rotatable refresh tokens (30 days).
- Separate, named, revocable API tokens for headless use (CLI, CI, webhooks).
- Single bootstrap path (web wizard + CLI) that creates the first org+admin and then permanently disables itself.
- A `RunContext` type carrying `{ user, org, membership, role, tokenKind }` to every authenticated handler — the bridge to specs #2–4.

## Non-Goals

- Credential vault DB tables/routes (spec #2).
- Resource registry (spec #3).
- Migration of existing `pipeline.yaml` products (spec #4).
- Email verification, password-reset-by-email, email-based invites.
- SSO/OIDC implementation (schema ready; implementation later).
- Audit log tables.
- Per-org rate limiting / quotas.

## Architecture

### Entity model

```
Org ──< Membership >── User
                ▲
                │ role: admin | member
```

| Entity | Purpose |
|---|---|
| `User` | Person. Has globally unique `username`, optional `displayName`. Auth-method-agnostic. |
| `AuthIdentity` | Pluggable login record. v1: one `provider="password"` row per user with bcrypt hash. SSO/OIDC adds new rows; no schema churn. |
| `Org` | Tenant. Slug (URL-safe) + name. Root of all ownership. |
| `Membership` | M:N join (`userId`, `orgId`, `role`). Carries the role. Spec #2 attaches user-scope credentials to this row. |
| `RefreshToken` | Sha256-hashed refresh-token row. Revoke = delete (or set `revoked_at`). |
| `ApiToken` | Headless token. Sha256-hashed, named, scoped to one org, individually revocable. |

### Invariants

- `User.username` is **globally unique** (matches GitHub model; simpler mental model than per-org usernames).
- A user can briefly exist with zero memberships (just-invited state) but cannot perform any action.
- Bootstrap is the only path that creates an org+admin without an inviter. After it runs, `system_state.bootstrapped_at` is non-null and bootstrap endpoints return 403.
- A user with no remaining memberships is soft-disabled (`status='disabled'`) but kept for audit/history reference integrity.

### Package layout

New package: **`@journeyman/identity`**.

```
packages/identity/src/
├── index.ts                       # public exports
├── auth-provider.ts               # IAuthProvider impl (replaces no-auth-provider.ts)
├── jwt.ts                         # sign/verify access JWTs (HS256)
├── tokens.ts                      # refresh-token + api-token hashing/rotation
├── bootstrap.ts                   # shared bootstrap() function
├── cli/
│   └── bootstrap.ts               # `npx journeyman-bootstrap ...`
└── routes/                        # mounted by api-server
    ├── auth.ts                    # /api/auth/*
    ├── bootstrap.ts               # /api/bootstrap*
    ├── orgs.ts                    # /api/orgs/:orgId/*
    ├── users.ts                   # /api/users/me*
    └── api-tokens.ts              # /api/orgs/:orgId/api-tokens*
```

`@journeyman/api-server` mounts these routes and wires the `requireAuth` middleware (defined in `@journeyman/identity`) onto all non-public routes.

## Data Model

Single migration: `packages/migrations/src/sql/002_identity.sql` (next number after the existing `001_initial.sql`).

```sql
create extension if not exists pgcrypto;

create table orgs (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table users (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,
  display_name  text,
  status        text not null default 'active',  -- 'active' | 'disabled' | 'deleted'
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table auth_identities (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  provider     text not null,                  -- 'password' | future: 'oidc' | 'github' | ...
  subject      text not null,                  -- password: same as username; oidc: sub claim
  secret_hash  text,                           -- bcrypt (password only); null for OAuth/OIDC
  metadata     jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  unique (provider, subject)
);

create table memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  org_id      uuid not null references orgs(id) on delete cascade,
  role        text not null check (role in ('admin','member')),
  created_at  timestamptz not null default now(),
  unique (user_id, org_id)
);

create table refresh_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  token_hash    text not null unique,         -- sha256(plaintext)
  active_org_id uuid references orgs(id),     -- captured at issuance
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz
);

create table api_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  org_id       uuid not null references orgs(id) on delete cascade,
  name         text not null,
  token_hash   text not null unique,
  last_used_at timestamptz,
  expires_at   timestamptz,                  -- null = no expiry
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);

-- Single-row latch; gates the bootstrap endpoints
create table system_state (
  id              int primary key default 1 check (id = 1),
  bootstrapped_at timestamptz
);
insert into system_state (id) values (1);

create index on memberships (org_id);
create index on auth_identities (user_id);
create index on refresh_tokens (user_id);
create index on api_tokens (user_id);
create index on api_tokens (org_id);
```

**Storage rules:**

- Plaintext tokens (refresh + API) are shown **once** at creation and never stored.
- Only sha256 hashes are persisted in `*_hash` columns.
- JWT access tokens are not stored at all (stateless).
- Bcrypt is used for passwords (cost factor 12).

## API Surface

All routes return JSON. Cookies are HTTP-only, `Secure`, `SameSite=Lax`. Cookie names: `jm_access` (max-age 900s) and `jm_refresh` (max-age 30d, path `/api/auth/refresh`).

### Bootstrap (one-shot)

```
GET  /api/bootstrap/status   → { bootstrapped: boolean }
POST /api/bootstrap          body: { orgName, orgSlug, username, password, displayName? }
                             → 201 { user, org }; sets system_state.bootstrapped_at
                             → 403 if already bootstrapped
```

### Auth

```
POST /api/auth/login         body: { username, password }
                             → 200, sets cookies (jm_access, jm_refresh)
                             → body: { user, memberships, activeOrgId }
POST /api/auth/refresh       (jm_refresh cookie required)
                             → rotates refresh row; re-issues access cookie
POST /api/auth/logout        → revokes refresh row; clears cookies
POST /api/auth/switch-org    body: { orgId }
                             → revokes current refresh; re-issues both with new activeOrgId
GET  /api/auth/me            → { user, activeOrg, role, memberships }
```

### Org admin (admin role required)

```
POST   /api/orgs/:orgId/invitations               body: { username, role, tempPassword? }
                                                   → creates user (if new) + membership
                                                   → returns { user, tempPassword }
DELETE /api/orgs/:orgId/memberships/:userId
PATCH  /api/orgs/:orgId/memberships/:userId       body: { role }
GET    /api/orgs/:orgId/memberships
```

### User self-service

```
POST  /api/users/me/password    body: { currentPassword, newPassword }
PATCH /api/users/me             body: { displayName? }
```

### API tokens (headless)

```
GET    /api/orgs/:orgId/api-tokens          (admin: all; member: own only)
POST   /api/orgs/:orgId/api-tokens          body: { name, expiresAt? }
                                             → 201 { id, plaintext } — plaintext shown once
DELETE /api/orgs/:orgId/api-tokens/:id      (admin: any; member: own only)
```

### Authorization middleware

Implemented once in `@journeyman/identity`. Pseudo-code:

```ts
async function requireAuth(req, opts: { role?: "admin" | "member" }) {
  const tok = req.cookies.jm_access ?? bearerOf(req.headers.authorization);
  if (!tok) throw 401;

  let userId: string, activeOrgId: string, tokenKind: "access-jwt" | "api-token";
  let apiTokenId: string | undefined;

  if (tok.startsWith("jm_pat_")) {
    const row = await db.apiTokens.findActiveByHash(sha256(tok));
    if (!row) throw 401;
    userId = row.user_id; activeOrgId = row.org_id;
    tokenKind = "api-token"; apiTokenId = row.id;
    void db.apiTokens.touchLastUsed(row.id);  // fire-and-forget
  } else {
    const claims = verifyJwt(tok);            // throws on bad sig / exp
    userId = claims.sub; activeOrgId = claims.org;
    tokenKind = "access-jwt";
  }

  const membership = await db.memberships.find(userId, activeOrgId);
  if (!membership) throw 403;
  if (opts.role === "admin" && membership.role !== "admin") throw 403;

  req.runContext = {
    user: { id: userId, username: ... },
    org:  { id: activeOrgId, slug: ... },
    membershipId: membership.id,
    role: membership.role,
    tokenKind,
    apiTokenId,
  };
}
```

## Bootstrap Flow

Two entry points — web wizard and CLI — share one internal `bootstrap()` function:

```ts
async function bootstrap(input: {
  orgName: string;
  orgSlug: string;
  username: string;
  password: string;
  displayName?: string;
}): Promise<{ user: User; org: Org }> {
  return await db.tx(async (tx) => {
    const state = await tx.query("select bootstrapped_at from system_state where id = 1 for update");
    if (state.rows[0].bootstrapped_at) throw new AlreadyBootstrappedError();

    const org = await tx.orgs.insert({ slug: input.orgSlug, name: input.orgName });
    const user = await tx.users.insert({ username: input.username, displayName: input.displayName });
    await tx.authIdentities.insert({
      userId: user.id, provider: "password", subject: input.username,
      secretHash: await bcrypt.hash(input.password, 12),
    });
    await tx.memberships.insert({ userId: user.id, orgId: org.id, role: "admin" });
    await tx.query("update system_state set bootstrapped_at = now() where id = 1");

    return { user, org };
  });
}
```

The `for update` lock + single-row latch makes concurrent bootstrap attempts safe: exactly one wins, the rest see `bootstrapped_at` set and throw.

**Web entry:** `POST /api/bootstrap`. The SPA detects `bootstrapped: false` from `/api/bootstrap/status` and routes the user to `/setup`; all other routes 302 there until done.

**CLI entry:** `npx journeyman-bootstrap --org "Cadmium" --slug cadmium --username admin --password '...' [--display-name 'Admin']`. Connects via the orchestrator's existing `pg` config. Useful for headless deploys and integration tests.

## JWT Specifics

- **Algorithm:** HS256 with `JWT_SECRET` env (32+ random bytes). RS256 deferred until multi-service verification is needed.
- **Access token claims:** `{ sub: userId, org: activeOrgId, role, kind: "access", iat, exp }`. TTL 15 minutes.
- **Refresh tokens:** opaque 32-byte random strings (not JWTs). Sha256 stored. Rotated on every refresh — old row marked `revoked_at`, new row inserted, atomic. TTL 30 days.
- **API tokens:** opaque random strings prefixed `jm_pat_…` (greppable in logs). Sha256 stored. Distinguished by prefix in middleware.
- **Org switch:** `/auth/switch-org` revokes the current refresh row and mints a new pair. All tabs re-establish — acceptable for a multi-tab dev tool.

## Run Context

Defined in `@journeyman/core/types/identity.types.ts`:

```ts
export interface RunContext {
  user: { id: string; username: string };
  org:  { id: string; slug: string };
  membershipId: string;
  role: "admin" | "member";
  tokenKind: "access-jwt" | "api-token";
  apiTokenId?: string;
}
```

Every authenticated handler receives a `RunContext`. The orchestrator passes it to `ICredentialStore.resolve()` (existing signature `{ userId, flowId }` widens to take a `RunContext`). The credential vault spec (#2) consumes `org.id` and `user.id` to do the user→org fallback resolution.

**Authoritatively:** after spec #2 lands, the orchestrator never reads `process.env` for user/org credentials. For this spec, `EnvCredentialStore` keeps working unchanged; we just lay the typing groundwork.

## Authorization Rules

| Action | admin | member |
|---|:-:|:-:|
| Run any flow in the org | ✅ | ✅ |
| Create / edit / delete flows | ✅ | ✅ |
| Create / edit / delete **org-level** credentials *(spec #2)* | ✅ | ❌ |
| Read org-level credentials *via runtime resolution* | ✅ | ✅ |
| Manage **own** user-level credentials *(spec #2)* | ✅ | ✅ |
| Read others' user-level credentials | ❌ | ❌ |
| Invite / remove members, change roles | ✅ | ❌ |
| Mint / revoke own API tokens | ✅ | ✅ |
| Mint / revoke others' API tokens | ✅ | ❌ |

Enforced in route handlers via `requireAuth({ role: "admin" })` where applicable.

## Testing Approach

- **Unit:** bcrypt round-trip; JWT sign/verify (good token, expired, tampered); refresh-token rotation atomicity; bootstrap latch contention (two concurrent calls → exactly one wins).
- **Integration (real Postgres):** full bootstrap → login → refresh → switch-org → logout. Invite flow. API-token mint + use + revoke. Negative cases: wrong password, expired access, revoked refresh, member hitting admin route, double-bootstrap.
- **No mocks for the DB.** Use a disposable test schema per run, matching the project's existing migration test pattern.

## Rollout

Greenfield — no existing users to migrate.

1. Land migration `002_identity.sql`.
2. Land `@journeyman/identity` package + bootstrap CLI.
3. Land auth routes + middleware in `@journeyman/api-server`.
4. Wire `requireAuth` onto all existing routes (currently unauthenticated). For the transition, add a `IDENTITY_ENFORCE` env flag — when `false`, the middleware falls back to a synthetic `RunContext` so existing flows keep working until spec #2 lands. Flip to `true` at the end of spec #2.
5. SPA: setup wizard at `/setup`, login at `/login`, org switcher in the app shell, logout.
6. Replace `packages/orchestrator/src/auth/no-auth-provider.ts` with the real provider; delete the file.

## Open Questions

- **Invite-by-username vs. invite-by-email.** v1 sticks with admin-creates-username-and-temp-password. When email is added to `users`, email-based invites become an additive change to `/api/orgs/:orgId/invitations`.
- **Username case-sensitivity.** Spec assumes case-sensitive globally-unique usernames. If we want case-insensitive (`Sam` == `sam`), use a `citext` column or a generated `lower(username)` unique index.

## Dependencies on / by Other Specs

- **Spec #2 (credential vault):** depends on `RunContext` and `memberships` table from this spec.
- **Spec #3 (resource registry):** depends on org ownership column conventions established here.
- **Spec #4 (flow consolidation):** depends on `Flow.ownerOrgId` (added by this spec — adds an `owner_org_id` column to the existing `flows` table or its DB equivalent when those tables exist; flow tables are out of scope here but the FK convention is set).
