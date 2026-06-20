# Global MCP Instances — Design

**Date:** 2026-06-20  
**Status:** Approved

## Overview

Add a platform-level "global" scope to MCP instances. Global MCPs are created once by a platform admin (via SQL) and are automatically visible to every workspace across every org. They cannot be created, edited, or deleted through the HTTP API. They appear in all MCP pickers with a small globe icon.

## Database

### Migration: `053_global_mcp_scope.sql`

```sql
-- 1. Add scope column (defaults all existing rows to 'workspace')
ALTER TABLE jm_mcp_instances
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'workspace'
    CHECK (scope IN ('workspace', 'global'));

-- 2. Make workspace_id nullable (NULL for global MCPs)
ALTER TABLE jm_mcp_instances
  ALTER COLUMN workspace_id DROP NOT NULL;

-- 3. Coherence constraint: scope and workspace_id must agree
ALTER TABLE jm_mcp_instances
  ADD CONSTRAINT jm_mcp_instances_scope_coherence CHECK (
    (scope = 'workspace' AND workspace_id IS NOT NULL) OR
    (scope = 'global'    AND workspace_id IS NULL)
  );

-- 4. Partial unique index: global MCP names must be unique globally
CREATE UNIQUE INDEX jm_mcp_instances_global_name_unique
  ON jm_mcp_instances (name)
  WHERE scope = 'global';
```

No existing rows are affected — all current rows default to `scope = 'workspace'`.

### Admin insert example

```sql
INSERT INTO jm_mcp_instances (scope, workspace_id, name, description, transport, command, args, bindings, system_prompt, enabled, created_by)
VALUES (
  'global',
  NULL,
  'internal-docs',
  'Company internal documentation MCP',
  'stdio',
  '/opt/mcp-servers/docs-server',
  '["--mode", "read-only"]',
  '[]',
  NULL,
  true,
  '<admin-user-uuid>'
);
```

## Types

`packages/core/src/types/mcp.types.ts`:

```typescript
export type McpScope = 'workspace' | 'global';

export interface McpInstanceRecord {
  id: string;
  scope: McpScope;           // new
  workspaceId: string | null; // null for global
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
```

All other types (`ResolvedMcpInstance`, `McpBinding`) are unchanged.

## Resolver

`packages/mcp/src/resolver.ts` — change the instance fetch query:

```sql
SELECT * FROM jm_mcp_instances
WHERE id = ANY($ids)
  AND enabled = true
  AND (
    (scope = 'workspace' AND workspace_id = $workspaceId)
    OR (scope = 'global')
  )
```

Global MCPs pass the filter for any workspace. If a requested ID is global, it resolves normally.

The same WHERE clause applies to the single-instance fetch used by `GET …/:id` and the test-connection route — those queries must also include the `OR (scope = 'global')` branch so a global MCP ID is accessible from any workspace route.

**Null workspace context:** if `workspaceId` is null/undefined (no workspace context), global MCPs are still not returned — the resolver requires a workspace context to proceed. This preserves the existing early-return behaviour.

**Secret binding resolution for global MCPs:** bindings are resolved against the calling workspace's org secrets (the same fallback path the workspace resolver already uses). If the admin inserts a global MCP with no bindings, `env` is `{}`.

`MissingMcpInstancesError` still fires if an ID resolves to neither the current workspace nor global scope.

## Routes

Existing workspace CRUD routes are unchanged. The following guards are added:

| Route | Change |
|---|---|
| `GET /api/workspaces/:wsId/mcp-instances` | Query returns workspace MCPs + all global MCPs |
| `GET /api/workspaces/:wsId/mcp-instances/visible` | Same — global MCPs (enabled=true) included |
| `POST /api/workspaces/:wsId/mcp-instances` | Reject `400` if body contains `scope: 'global'` |
| `PATCH /api/workspaces/:wsId/mcp-instances/:id` | Return `403 Forbidden` if instance is global |
| `DELETE /api/workspaces/:wsId/mcp-instances/:id` | Return `403 Forbidden` if instance is global |
| `POST /api/workspaces/:wsId/mcp-instances/:id/test` | Allowed — test-connection is read-only |
| `GET /api/workspaces/:wsId/mcp-instances/:id` | Allowed — fetch by ID works for global |

Global MCPs are invisible to workspace users as writeable resources. They appear in lists but cannot be mutated via HTTP.

## UI

The MCP picker in the flow editor and agent form renders the `/visible` endpoint. Two small additions:

1. **Globe icon** — items with `scope === 'global'` render a small globe icon inline next to the name. Tooltip: `"Global MCP — managed by your platform admin"`.

2. **Detail / edit panel** — if a user opens a global MCP's detail view, all fields are read-only and a banner at the top reads: `"This is a global MCP. It cannot be edited or deleted."` The delete button is hidden entirely (not disabled).

3. **Test connection** — available on global MCPs, same as workspace MCPs.

No new pages or routes in the frontend. A dedicated global MCP admin page is out of scope for this iteration.

## Out of Scope

- Admin UI for creating/editing global MCPs (future work)
- Global secrets vault for global MCP bindings (future work)
- Per-workspace opt-out / disabling a global MCP for a specific workspace (future work)
