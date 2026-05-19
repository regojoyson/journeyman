# Secrets

## Overview

Secrets are encrypted key-value pairs used to pass sensitive credentials (API keys, tokens, passwords) into flow phases without embedding them in flow definitions. Secrets are scoped to a user, an org, or the global platform. At runtime, `@journeyman/secrets` resolves the bindings declared on each phase node, decrypts the values, and injects them as environment variables — the plaintext never appears in flow definitions or run records.

## Scopes

| Scope | Who owns it | Who can read it |
|---|---|---|
| **User** | Individual user | That user only |
| **Org** | Org admins | All members of the org |
| **Global** | Platform admins | All users on the platform |

**Resolution order** — when a binding is set to **auto**, the resolver walks user → org → global and returns the first secret whose name matches. A **pinned** binding bypasses resolution order and targets one specific secret directly.

## Managing Secrets

### UI

| Scope | Location |
|---|---|
| User secrets | `/me/secrets` |
| Org secrets | `/admin/secrets` |
| Global secrets | Platform admin panel |

### API

| Method | Path | Description |
|---|---|---|
| `GET` | `/secrets` | List your user secrets (names only — values are never returned) |
| `POST` | `/secrets` | Create a user secret |
| `PUT` | `/secrets/:id` | Update a user secret |
| `DELETE` | `/secrets/:id` | Delete a user secret |
| `GET` | `/orgs/:orgId/secrets` | List org secrets |
| `POST` | `/orgs/:orgId/secrets` | Create an org secret |
| `PUT` | `/orgs/:orgId/secrets/:id` | Update an org secret |
| `DELETE` | `/orgs/:orgId/secrets/:id` | Delete an org secret |

Secret values are **AES-encrypted at rest**. The API never returns plaintext values after creation — listing endpoints return names and metadata only.

## Secret Bindings in Flows

Each phase node can declare a set of required secrets. In the flow editor, select a node and open the **Required Secrets** tab to configure bindings.

For each required secret you choose a binding mode:

- **Auto** — resolved at runtime by scanning user → org → global for a secret whose name matches the declared key. Requires no further configuration.
- **Pinned** — you explicitly select a specific secret from a particular scope. The editor shows a warning when the pinned secret's scope is broader than the flow's effective scope (e.g. pinning an org secret in a user-scoped flow) to surface potential access issues at design time.

The **Required Secrets** tab groups available secrets by scope and shows a live resolution preview so you can confirm which secret value will be injected before you run the flow.

## Runtime Resolution

Just before a phase executes, `resolveBindings(bindings, userId, orgId)` in `@journeyman/secrets`:

1. Iterates each declared binding on the node.
2. For **pinned** bindings, fetches the targeted secret directly.
3. For **auto** bindings, walks user → org → global and returns the first match.
4. Decrypts each value using the platform AES key.
5. Passes plaintext values to the phase as environment variables.

Plaintext values are **never logged** and are **not stored in the run record**. Only the binding configuration (name + scope + mode) is persisted.

## Package Reference

`@journeyman/secrets` exports:

| Export | Description |
|---|---|
| `crypto` | AES encrypt/decrypt helpers used internally |
| `resolveBindings` | Resolves an array of `SecretBinding[]` to plaintext key-value pairs at runtime |
| `SecretBinding` | Type: `{ name: string; scope: 'user' \| 'org' \| 'global' }` |
| `routes/user-secrets` | Express router for `/secrets` (user-scoped CRUD) |
| `routes/org-secrets` | Express router for `/orgs/:orgId/secrets` (org-scoped CRUD) |
| `routes/global-secrets` | Express router for global secrets (platform admin only) |
| `routes/resolve` | Express router exposing the runtime resolution endpoint |
| `routes/visible-names` | Express router returning the names of secrets visible to the caller |
| `db` | Knex-based data access layer for secrets storage |
| `visibility` | Helpers that determine which secrets are visible to a given user/org |
