# MCP Management — Design

**Date:** 2026-05-03
**Status:** Design approved, pending spec review

## Problem

Users need to register and manage MCP (Model Context Protocol) server connections — both well-known ones (Jira, Slack, Filesystem, …) and fully custom ones — at user and org scope, the same way they manage secrets today. These registered MCPs must then be selectable from the flow editor on a per-phase basis, so coding-cli operations (`analyze`, `plan`, `implement`) can run with the right MCP toolset and credentials wired in.

Today, the only MCP catalog is the static in-memory `defaultMcpCatalog` in `@journeyman/flow-editor`. There is no DB-backed registration, no credential binding, no way to attach MCPs to phases, and no way to inject MCP servers into the Claude Agent SDK `query()` call.

## Goals

- DB-backed MCP instance records, scoped user/org (mirrors secrets exactly).
- Support both built-in catalog entries (Jira, Slack, …) and fully custom MCPs (any stdio command or http/sse URL the user owns).
- Each MCP instance binds zero or more env vars to existing secret records (by name) — never raw values.
- Each MCP instance carries an optional system prompt that gets appended to the coding-cli prompt when the MCP is active.
- Phase config gains a multi-select picker; chosen instance IDs are stored on the phase and resolved at run time.
- Coding-cli stays stateless and free of DB dependencies — receives already-resolved `ResolvedMcpInstance[]` and converts to SDK shapes via a pure adapter.

## Non-goals

- Building MCP servers themselves. Custom MCPs must already speak MCP protocol; wrapping a non-MCP REST API is out of scope.
- A REST-to-MCP bridge inside Journeyman.
- Per-org curated catalog management (the catalog stays static/in-memory for this iteration).
- Storing raw env values inline on MCP instances. Bindings always reference named secrets.
- Touching `git-provider`, `ticket-provider`, or `notification-provider` — REST APIs, no MCP concept.

## Architecture

New package `packages/mcp`, structurally a mirror of `packages/secrets`:

```
packages/mcp/
├── package.json           ← exports map: ".", "./sdk-adapter"
└── src/
    ├── index.ts           ← full package: db, routes, resolver
    ├── sdk-adapter.ts     ← pure transforms, no DB deps
    ├── db.ts              ← jm_mcp_instances CRUD
    ├── resolver.ts        ← resolveMcpInstances(...)
    └── routes/
        ├── index.ts
        ├── user-mcp.ts
        ├── org-mcp.ts
        ├── visible.ts
        └── catalog.ts
```

Subpath export `@journeyman/mcp/sdk-adapter` lets `coding-cli` consume only the pure transforms without pulling `pg` into a provider package.

## Data Model

### DB table: `jm_mcp_instances`

```sql
CREATE TABLE jm_mcp_instances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        TEXT NOT NULL,
  user_id       TEXT,                          -- NULL = org-level, set = user-level
  name          TEXT NOT NULL,
  description   TEXT,
  transport     TEXT NOT NULL,                 -- "stdio" | "http" | "sse"
  command       TEXT,                          -- stdio only
  args          JSONB,                         -- stdio only
  url           TEXT,                          -- http/sse only
  bindings      JSONB NOT NULL DEFAULT '[]',   -- McpBinding[]
  system_prompt TEXT,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id, name)
);

CREATE INDEX jm_mcp_instances_org_user_idx
  ON jm_mcp_instances (org_id, user_id);
```

`user_id IS NULL` ⇒ org-scope. `user_id = <id>` ⇒ user-scope. Same convention as `jm_secrets`.

### Core types — `@journeyman/core`

New file `packages/core/src/types/mcp.types.ts`:

```ts
export type McpTransport = "stdio" | "http" | "sse";

export interface McpBinding {
  envVar: string;       // e.g. "JIRA_API_TOKEN"
  secretName: string;   // e.g. "MY_JIRA_TOKEN"
}

export interface McpInstanceRecord {
  id: string;
  orgId: string;
  userId: string | null;
  name: string;
  description: string | null;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  bindings: McpBinding[];
  systemPrompt: string | null;
  enabled: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResolvedMcpInstance {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env: Record<string, string>;   // resolved from secrets
  systemPrompt: string | null;
}

export class MissingMcpInstancesError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Missing or inaccessible MCP instances: ${missing.join(", ")}`);
    this.name = "MissingMcpInstancesError";
  }
}
```

Re-exported from `packages/core/src/index.ts` alongside the existing secret types.

## Three Ways to Register

All three paths produce the same `jm_mcp_instances` row shape. The differences are which fields are filled in.

1. **Pick from catalog** — UI calls `GET /api/mcp-catalog`, user picks "Jira", form pre-fills `transport`, `url`, and the list of required env vars; user maps each to a secret. Saved as a normal instance.
2. **Custom stdio** — user fills `transport: stdio`, `command`, `args`, plus optional bindings. For self-run local MCP servers.
3. **Custom http/sse** — user fills `transport: http|sse`, `url`, plus bindings. For self-hosted MCP endpoints.

There is no "source: builtin|custom" flag in the DB — that distinction lives only in the UI.

## API Routes

Mirrors `@journeyman/secrets` route patterns. All routes live in `packages/mcp/src/routes/`.

### User-scope (`user-mcp.ts`)

```
GET    /api/orgs/:orgId/users/me/mcp-instances
POST   /api/orgs/:orgId/users/me/mcp-instances
GET    /api/orgs/:orgId/users/me/mcp-instances/:id
PATCH  /api/orgs/:orgId/users/me/mcp-instances/:id
DELETE /api/orgs/:orgId/users/me/mcp-instances/:id
```

Auth: `requireAuth()`. Scope is forced to `user_id = ctx.user.id`.

### Org-scope (`org-mcp.ts`)

```
GET    /api/orgs/:orgId/mcp-instances
POST   /api/orgs/:orgId/mcp-instances
GET    /api/orgs/:orgId/mcp-instances/:id
PATCH  /api/orgs/:orgId/mcp-instances/:id
DELETE /api/orgs/:orgId/mcp-instances/:id
```

Auth: `requireAuth({ role: "admin" })` for write operations. Reads allowed to any authenticated org member. Scope forced to `user_id IS NULL`.

### Visible-list (`visible.ts`)

```
GET /api/orgs/:orgId/mcp-instances/visible
```

Returns the union of the caller's user-scope instances + the org's org-scope instances they can see (`enabled = true` only). Lightweight projection: `{ id, name, description, scope: "user" | "org", enabled }`. No transport details, no bindings — used to populate the phase picker dropdown.

### Catalog (`catalog.ts`)

```
GET /api/mcp-catalog
```

Returns the static catalog from `@journeyman/flow-editor` (`defaultMcpCatalog`) over HTTP, so the web UI can render "Add from catalog" without bundling the catalog client-side. No DB.

### Request validation

POST/PATCH body shape:

```ts
{
  name: string;                  // matches /^[a-zA-Z0-9_\-\s]+$/, 1..64 chars
  description?: string;
  transport: "stdio" | "http" | "sse";
  command?: string;              // required if transport === "stdio"
  args?: string[];               // optional if transport === "stdio"
  url?: string;                  // required if transport === "http" | "sse"
  bindings: McpBinding[];        // each: { envVar, secretName }
  systemPrompt?: string;
  enabled?: boolean;             // defaults to true
}
```

Rules:
- `transport === "stdio"` ⇒ require `command`. Reject `url`.
- `transport === "http" | "sse"` ⇒ require `url`. Reject `command`/`args`.
- Each `binding.envVar` matches `/^[A-Z][A-Z0-9_]*$/`.
- Each `binding.secretName` must exist in the caller's visible secrets at create/update time. Validation reuses a small helper over `@journeyman/secrets` (lookup by name, scoped to caller). Missing secrets ⇒ `400` with the missing names listed.
- Duplicate `(orgId, userId, name)` ⇒ `409 DuplicateMcpInstanceError` (mirrors `DuplicateSecretError`).

## Resolver

`packages/mcp/src/resolver.ts`:

```ts
export async function resolveMcpInstances(
  pool: Pool,
  ctx: { orgId: string; userId: string },
  instanceIds: string[],
): Promise<ResolvedMcpInstance[]>;
```

### Algorithm

1. Fetch instances:
   ```sql
   SELECT * FROM jm_mcp_instances
    WHERE id = ANY($1)
      AND org_id = $2
      AND (user_id = $3 OR user_id IS NULL)
      AND enabled = true
   ```
2. Any requested ID not returned ⇒ throw `MissingMcpInstancesError([...ids])`.
3. Collect deduped `secretName`s across all instances' bindings.
4. Resolve in one batch via existing `fetchForResolve(pool, orgId, userId, names)` from `@journeyman/secrets`. Any missing ⇒ throw `MissingSecretsError([...names])` (already in core).
5. For each instance, build `env: Record<string, string>` by mapping `envVar → resolvedSecrets[secretName]`.
6. Return `ResolvedMcpInstance[]` in the same order as the input `instanceIds`.

The resolver does no caching. Callers that need to memoize per-run state can wrap it.

## SDK Adapter (pure)

`packages/mcp/src/sdk-adapter.ts` — exposed via subpath `@journeyman/mcp/sdk-adapter`. Imports only `@journeyman/core` types and `@anthropic-ai/claude-agent-sdk` types. Zero DB or runtime deps.

```ts
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { ResolvedMcpInstance } from "@journeyman/core";

export function toMcpServerConfigs(
  resolved: ResolvedMcpInstance[],
): Record<string, McpServerConfig>;

export function mergeSystemPrompts(resolved: ResolvedMcpInstance[]): string;
```

### Transport mapping

- **stdio** ⇒ `{ type: "stdio", command, args, env }`
- **http / sse** ⇒ `{ type: "http"|"sse", url, headers }` where `headers` is built from `env`:
  - If `env.AUTHORIZATION` is set ⇒ `Authorization: Bearer <value>` (and the raw `AUTHORIZATION` is also passed through as a header).
  - All other env entries are passed as headers using their key verbatim.
- The instance `name` is used as the SDK key — collisions across instances are rejected by the resolver upstream (uniqueness is per scope + name; cross-scope collisions are resolved by suffixing `:user` / `:org` in `toMcpServerConfigs`).

### `mergeSystemPrompts`

Joins non-empty `systemPrompt` values with `\n\n`. Returns `""` if none. Order matches input order.

## Phase Config & Flow Editor

### Phase definition gains an opt-in flag

`packages/flow-editor/src/phase-definition.ts`:

```ts
export interface PhaseDefinition<TConfig> {
  // ...existing
  supportsMcp?: boolean;
}
```

Phases that wrap a coding-cli operation (`analyze`, `plan`, `implement`) set `supportsMcp: true`. Other phases ignore this field.

### Phase config schema

Phases that opt in extend their config type with:

```ts
mcpInstanceIds?: string[];
```

### Properties panel UI

When the selected node's phase definition has `supportsMcp === true`, the right-side properties panel renders:

- A multi-select dropdown labelled "MCPs", populated from `GET /api/orgs/:orgId/mcp-instances/visible`.
- Each option shows `name (scope)` plus a tooltip with `description`.
- Selected IDs are written to `node.config.mcpInstanceIds`.

No catalog UI here — adding/removing MCP instances happens in a dedicated settings page (out of scope for this spec; covered by the routes above).

## Coding-CLI Wiring

### Option types — `@journeyman/core`

Extend in `packages/core/src/types/coding.types.ts`:

```ts
import type { ResolvedMcpInstance } from "./mcp.types.ts";

export interface AnalyzeOptions extends SessionOptions {
  // ...existing fields
  mcps?: ResolvedMcpInstance[];
}

export interface PlanOptions extends SessionOptions { /* + mcps?: ResolvedMcpInstance[] */ }
export interface ImplementOptions extends SessionOptions { /* + mcps?: ResolvedMcpInstance[] */ }
```

`ICodingCLI` itself does not change.

### ClaudeProvider operations

In each of `analyze.ts`, `plan.ts`, `implement.ts`:

```ts
import { toMcpServerConfigs, mergeSystemPrompts } from "@journeyman/mcp/sdk-adapter";

const mcpServers     = opts.mcps?.length ? toMcpServerConfigs(opts.mcps) : undefined;
const promptSuffix   = opts.mcps?.length ? mergeSystemPrompts(opts.mcps) : "";
const fullPrompt     = promptSuffix ? `${basePrompt}\n\n${promptSuffix}` : basePrompt;
const allowedMcpKeys = mcpServers ? Object.keys(mcpServers) : [];
const mcpToolNames   = allowedMcpKeys.map(k => `mcp__${k}`);

for await (const msg of query({
  prompt: fullPrompt,
  options: {
    tools: ["Bash", ...mcpToolNames],
    allowedTools: ["Bash", ...mcpToolNames],
    mcpServers,
    settings: { allowedMcpServers: allowedMcpKeys },
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    settingSources: [],
    ...queryOption,
  },
})) {
  /* ...existing message handling... */
}
```

When `opts.mcps` is empty/undefined, behavior is identical to today (`tools: ["Bash"]`, no MCPs, no prompt suffix). Backward compatible.

### `GeminiProvider` and `CodexProvider`

Their `analyze`/`plan`/`implement` stubs accept the new `mcps` option (it's just an extra field on the options type — TypeScript-only change, no runtime impact). They continue to throw `"<Class>.<method> not implemented"`.

## Worker Glue

The worker (api-server flow runner) sits between phase config and coding-cli. Pseudocode for one phase step:

```ts
import { resolveMcpInstances } from "@journeyman/mcp";

const ids = phase.config.mcpInstanceIds ?? [];
const mcps = ids.length
  ? await resolveMcpInstances(pool, { orgId, userId }, ids)
  : [];

await codingCli.implement({
  // ...existing options including secret-resolved env (from worker-db-secret-resolution)
  mcps,
});
```

This slots in next to the existing secret-resolution flow described in `2026-05-03-worker-db-secret-resolution-design.md`. Both run during the same pre-execution step.

## Error Handling

| Failure | Behavior |
|---|---|
| Unknown MCP instance ID at resolve time | `MissingMcpInstancesError([...ids])` — phase fails before `query()` is called. |
| Bound secret is missing | `MissingSecretsError([...names])` — same path as today's secret resolution. |
| MCP server unreachable at run time | Bubbles up from the SDK as a normal `query()` error. No retry inside coding-cli. |
| Disabled instance referenced | Treated as missing (`enabled = true` filter in resolver query). |
| Duplicate name on create/update | `409 DuplicateMcpInstanceError`. |
| Invalid binding (envVar regex / unknown secret) | `400` with the offending field. |

## Testing

### Unit tests

- `db.ts`: insert/list/update/delete for both scopes; uniqueness enforcement; `enabled = false` excluded from visible queries.
- `resolver.ts`: happy path, missing instance, missing secret, mixed user/org scope, deduped secret fetch (one DB hit for shared secret names across instances).
- `sdk-adapter.ts`: stdio mapping, http mapping with `AUTHORIZATION` header, sse mapping, empty input, system prompt merging order.

### Integration tests

- POST `/api/orgs/:orgId/users/me/mcp-instances` happy path with binding to existing secret.
- POST with binding to nonexistent secret ⇒ `400` with the missing name.
- POST `transport: stdio` without `command` ⇒ `400`.
- POST duplicate name ⇒ `409`.
- GET `/visible` returns user + org rows correctly merged and scope-tagged.

### Manual verification

- Register a stdio MCP (e.g. `@modelcontextprotocol/server-filesystem`) at user scope, no bindings. Add it to an `analyze` phase. Confirm SDK message log shows the MCP tools available and the resolved env injected.
- Register an HTTP MCP requiring an `Authorization` header. Confirm header is built from the bound secret.

## Implementation Status (post-merge)

Update `CLAUDE.md`:

| Feature | Status |
|---|---|
| `@journeyman/mcp` package (DB, routes, resolver, sdk-adapter) | Implemented |
| User/org MCP instance CRUD routes | Implemented |
| Visible-list and catalog routes | Implemented |
| `resolveMcpInstances` resolver | Implemented |
| `toMcpServerConfigs` / `mergeSystemPrompts` (subpath export) | Implemented |
| Phase definition `supportsMcp` flag + properties panel picker | Implemented |
| `analyze` / `plan` / `implement` accept `mcps?: ResolvedMcpInstance[]` | Implemented |
| Worker resolves `mcpInstanceIds` before coding-cli call | Implemented |
| Custom REST-to-MCP bridge | Out of scope |
