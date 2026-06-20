# Ticket Management Connections

**Date:** 2026-06-20
**Status:** Approved

## Summary

Add a `"ticket"` category to the connections system, supporting Jira, Linear, and Monday as providers. Each connection stores an encrypted API token plus provider-specific config. A lightweight test-connection call verifies the credential by hitting the provider's "who am I" endpoint and returning the authenticated user's display name.

## Data Model

No DB migration required. `jm_connections` is already category-agnostic.

Single type change in `@journeyman/core`:

```ts
// packages/core/src/types/connection.types.ts
export type ConnectionCategory = "git" | "notification" | "ticket";
```

Provider-specific fields map to existing `Connection` columns:

| Provider | `baseUrl`           | `config`             | credential (encrypted) |
|----------|---------------------|----------------------|------------------------|
| Jira     | `acme.atlassian.net`| `{ email: "..." }`   | API token              |
| Linear   | —                   | —                    | API key                |
| Monday   | —                   | —                    | Personal API token     |

## Backend — Route Changes

**File:** `packages/api-server/src/routes/connections.ts`

Add inline helper `testTicketConnection(provider, token, baseUrl?, config?)` — matches the existing `gitProviderFor()` pattern, no new abstraction:

- **Jira:** `GET https://{baseUrl}/rest/api/3/myself` with `Authorization: Basic base64(email:token)`. Returns `{ ok: true, note: "Connected as {displayName}" }`.
- **Linear:** `POST https://api.linear.app/graphql` with `{ viewer { name } }` and `Authorization: Bearer {token}`. Returns `{ ok: true, note: "Connected as {name}" }`.
- **Monday:** `POST https://api.monday.com/v2` with `{ me { name } }` and `Authorization: Bearer {token}`. Returns `{ ok: true, note: "Connected as {name}" }`.
- Unknown provider: `{ ok: false, error: "unknown ticket provider: {provider}" }`.

The existing `POST /workspaces/:wsId/connections/:id/test` handler gets a new `"ticket"` branch alongside the existing `"git"` branch. Notification connections keep their existing stub response.

No changes to `IIssueProvider` — test logic is intentionally kept out of the provider interface.

## Frontend — ConnectionsPage Changes

**File:** `packages/web/src/routes/ConnectionsPage.tsx`

### Category label

```ts
const CATEGORY_LABELS: Record<ConnectionCategory, string> = {
  git: "🌿 Git",
  notification: "🔔 Notification",
  ticket: "🎫 Ticket",
};
```

### AddConnectionModal

1. **Type dropdown** — add `<option value="ticket">🎫 Ticket tracker</option>`.
2. **Provider dropdown** when `category === "ticket"`: Jira, Linear, Monday.
3. **`onSelectCategory`** — sets default provider to `"jira"` when ticket is selected.
4. **Provider-specific fields:**
   - Jira only: **Host** field → `baseUrl` (placeholder `acme.atlassian.net`) and **Email** field → `config.email`.
   - All ticket providers: **API token** credential field (password input).
5. **Credential label** — shows `"API token"` for ticket category (vs `"Access token (PAT)"` for git).

No changes to `connectionsApi` — `CreateConnectionInput` already carries `config` and the test endpoint shape (`note` field) is already rendered in the test result cell.

## Out of Scope

- Implementing `LinearProvider` / `MondayProvider` operations (they remain stubs).
- Wiring ticket connections to agent steps (tracked separately).
- OAuth flows for any provider.
