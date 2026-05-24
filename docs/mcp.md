# MCP (Model Context Protocol) Servers

## Overview

MCP servers are external tool servers that extend what AI phases can do. For example, a GitHub MCP server gives the AI agent direct access to GitHub APIs without any custom integration code. Journeyman manages MCP instances so flows can reference them by ID rather than by inline configuration. At runtime the worker resolves those IDs to full server configs before spawning the AI agent.

## Scopes

| Scope | Who can see it | Managed at |
|---|---|---|
| **User-scoped** | Your flows only (personal) | `/me/mcps` |
| **Org-scoped** | All org members | `/admin/mcps` |

Org admins can promote a user-scoped instance to org scope, making it available to all members without the user having to re-create it.

## Managing MCP Instances

### Via UI

- User instances: `/me/mcps`
- Org instances: `/admin/mcps`

### API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/me/mcps` | List your MCP instances |
| `POST` | `/me/mcps` | Create a user-scoped MCP instance |
| `PUT` | `/me/mcps/:id` | Update a user-scoped instance |
| `DELETE` | `/me/mcps/:id` | Delete a user-scoped instance |
| `POST` | `/me/mcps/:id/promote` | Promote to org scope |
| `GET` | `/orgs/:orgId/mcps` | List org MCP instances |
| `POST` | `/orgs/:orgId/mcps` | Create an org-scoped instance |
| `PUT` | `/orgs/:orgId/mcps/:id` | Update an org instance |
| `DELETE` | `/orgs/:orgId/mcps/:id` | Delete an org instance |
| `GET` | `/mcps/visible` | List all MCP instances visible to current user (user + org combined) |
| `GET` | `/mcps/catalog` | Browse the static MCP server catalog |

A static catalog of well-known MCP servers is bundled with the package. Instances from the catalog can be added directly to your user or org scope.

## Using MCPs in Flows

1. Open the flow editor and select a step node on the canvas.
2. In the properties panel, open the **MCP Tools** tab.
3. Check the MCP instances you want available to that step. The visible list is fetched from `/api/orgs/{orgId}/mcp-instances/visible`, which merges your user-scoped and org-scoped instances.
4. Save the node. The selected instance IDs are stored as `mcpInstanceIds` in the node config.

At runtime the worker resolves those IDs to full `ResolvedMcpInstance[]` before spawning the AI agent.

## Runtime Resolution

`resolveMcpInstances(ids, userId, orgId)` in `@journeyman/mcp`:

1. Accepts an array of MCP instance IDs plus the current user and org identifiers.
2. Looks up each ID across user-scoped and org-scoped instances.
3. Returns a `ResolvedMcpInstance[]` array containing full server configs.

The `@journeyman/mcp/sdk-adapter` subpath export provides two helpers for passing those configs into the Claude Agent SDK `query()` call:

- **`toMcpServerConfigs(instances)`** — converts `ResolvedMcpInstance[]` to the shape expected by the SDK's `mcpServers` option.
- **`mergeSystemPrompts(instances)`** — collects any system prompt extensions declared by each MCP server and merges them into a single string to prepend to the step prompt.

## Package Reference

| Export | Source file | Description |
|---|---|---|
| `resolveMcpInstances` | `resolver.ts` | Resolve an array of instance IDs to full configs |
| `userMcpRoutes` | `routes/user-mcp.ts` | Express router for `/me/mcps` CRUD |
| `orgMcpRoutes` | `routes/org-mcp.ts` | Express router for `/orgs/:orgId/mcps` CRUD |
| `promotableRoutes` | `routes/promotable.ts` | Router for listing promotable instances |
| `promoteRoutes` | `routes/promote.ts` | Router for `POST /me/mcps/:id/promote` |
| `visibleRoutes` | `routes/visible.ts` | Router for `GET /mcps/visible` |
| `catalogRoutes` | `routes/catalog.ts` | Router for `GET /mcps/catalog` |
| `toMcpServerConfigs` | `sdk-adapter.ts` (subpath) | Convert resolved instances to SDK server config shape |
| `mergeSystemPrompts` | `sdk-adapter.ts` (subpath) | Merge system prompt extensions from all resolved instances |
| DB helpers | `db.ts` | Low-level database access for MCP instance records |
