# Skills Management Design

**Date:** 2026-05-04
**Status:** Approved

## Overview

Add a skill package management system to Journeyman that lets users and org admins install Claude Code skill packages from any git URL, select which individual skills within a package are active, and have those skills automatically passed to the Claude agent SDK when workers run. The design mirrors the existing MCP management architecture.

---

## Goals

- Users can install skill packages (git repos with a `.claude-plugin/` directory) at user scope or org scope
- Per-package toggle: choose which individual skills within a package are active
- Skills are passed to `query()` as `plugins: SdkPluginConfig[]` when workers run analyze/plan/implement
- A pre-populated catalog (superpowers, agent-skills, spec-kit) plus free-form git URL input
- Self-healing local cache: if the cloned directory disappears (machine swap, volume remount), it is transparently re-cloned from the stored git URL
- Architecture is extensible to future CLIs (OpenCode, Codex) via a `cli_type` field; only `claude` is implemented now

## Out of Scope

- Remote (non-local) plugin types — SDK only supports `type: 'local'` today
- Skill version pinning beyond commit SHA
- Per-flow skill overrides (skills are resolved at user+org level, not per flow)
- OpenCode / Codex support (field reserved, not implemented)

---

## Architecture

### New Package: `@journeyman/skills`

Mirrors `@journeyman/mcp` in structure and responsibility.

```
packages/skills/
├── package.json
├── src/
│   ├── index.ts          ← exports routes, resolver, db helpers
│   ├── db.ts             ← all SQL helpers
│   ├── resolver.ts       ← resolveSkillPackages()
│   ├── installer.ts      ← git clone + skill discovery logic
│   ├── catalog.ts        ← static catalog list
│   └── routes/
│       ├── index.ts      ← registers all routes on Fastify
│       ├── user.ts       ← user-scope CRUD routes
│       ├── org.ts        ← org-scope CRUD routes
│       ├── catalog.ts    ← GET /api/skill-packages/catalog
│       └── skills.ts     ← GET /api/skill-packages/:id/skills
└── sdk-adapter/
    └── index.ts          ← toPluginConfigs(), buildSkillSystemPrompt()
```

### Data Flow

```
User adds git URL
  → POST /api/orgs/:orgId/skill-packages/me
  → insert row (status=pending)
  → 202 returned immediately
  → async: git clone → discover skills → update row (status=ready)

Worker runs analyze/plan/implement
  → resolveSkillPackages(userId, orgId, 'claude')
  → check local_path exists; re-clone if missing
  → filter: only packages with enabledSkills.length > 0
  → toPluginConfigs() → SdkPluginConfig[]
  → buildSkillSystemPrompt() → string
  → query({ plugins, prompt: originalPrompt + skillPrompt, ... })
```

---

## DB Schema

**Migration:** `packages/migrations/src/sql/010_skill_packages.sql`

```sql
CREATE TABLE skill_packages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope          text NOT NULL CHECK (scope IN ('user', 'org')),
  user_id        uuid REFERENCES users(id) ON DELETE CASCADE,
  org_id         uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  git_url        text NOT NULL,
  name           text NOT NULL,
  local_path     text,           -- cache hint; source of truth is git_url + commit_sha
  commit_sha     text,
  install_status text NOT NULL DEFAULT 'pending'
                   CHECK (install_status IN ('pending', 'installing', 'ready', 'error')),
  install_error  text,
  enabled_skills text[] NOT NULL DEFAULT '{}',
  cli_type       text NOT NULL DEFAULT 'claude'
                   CHECK (cli_type IN ('claude', 'opencode', 'codex')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (
    scope,
    COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    org_id,
    git_url
  )
);
```

**Constraints:**
- `user_id` must be non-null when `scope='user'`; null when `scope='org'`
- `enabled_skills` is a subset of the skills discovered in the cloned repo; stale names (skill deleted upstream) are silently ignored at resolution time

---

## Core Types

Added to `@journeyman/core` in `packages/core/src/types/skills.types.ts`:

```typescript
export interface SkillPackage {
  id: string;
  scope: 'user' | 'org';
  userId?: string;
  orgId: string;
  gitUrl: string;
  name: string;
  localPath?: string;
  commitSha?: string;
  installStatus: 'pending' | 'installing' | 'ready' | 'error';
  installError?: string;
  enabledSkills: string[];
  cliType: 'claude' | 'opencode' | 'codex';
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedSkillPackage {
  id: string;
  name: string;
  localPath: string;       // guaranteed valid — resolver re-clones if missing
  enabledSkills: string[];
  cliType: 'claude' | 'opencode' | 'codex';
}

export interface SkillCatalogEntry {
  name: string;
  description: string;
  gitUrl: string;
  author: string;
}
```

`AnalyzeOptions`, `PlanOptions`, `ImplementOptions` in `coding.types.ts` each gain:
```typescript
skills?: ResolvedSkillPackage[];
```

---

## API Routes

All routes registered in `@journeyman/skills` and mounted in `api-server`.

### User-scope

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/orgs/:orgId/skill-packages/me` | List user's packages |
| POST | `/api/orgs/:orgId/skill-packages/me` | Add package — returns 202, triggers clone |
| PATCH | `/api/orgs/:orgId/skill-packages/me/:id` | Update `enabled_skills` |
| DELETE | `/api/orgs/:orgId/skill-packages/me/:id` | Remove package |
| POST | `/api/orgs/:orgId/skill-packages/me/:id/refresh` | Re-pull latest commit |

### Org-scope (admin only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/orgs/:orgId/skill-packages` | List org packages |
| POST | `/api/orgs/:orgId/skill-packages` | Add package — returns 202 |
| PATCH | `/api/orgs/:orgId/skill-packages/:id` | Update `enabled_skills` |
| DELETE | `/api/orgs/:orgId/skill-packages/:id` | Remove package |
| POST | `/api/orgs/:orgId/skill-packages/:id/refresh` | Re-pull latest commit |
| POST | `/api/orgs/:orgId/skill-packages/:id/promote` | Promote user→org scope |

### Utility

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/skill-packages/catalog` | Static catalog list (no org context needed) |
| GET | `/api/orgs/:orgId/skill-packages/:id/skills` | List skills discovered in cloned repo |

---

## Git Install Worker

Runs inline as a fire-and-forget async function on `POST` (no separate queue for v1).

```
SKILLS_CACHE_DIR env var (default: ~/.journeyman/skills-cache)
Clone path: <SKILLS_CACHE_DIR>/<sanitized-name>-<8-char-url-hash>/
```

**Steps:**
1. Insert row with `install_status='pending'`, return 202
2. Async: set `install_status='installing'`
3. `git clone <git_url> <clone_path>`
4. `git rev-parse HEAD` → store as `commit_sha`
5. Read `.claude-plugin/skills/` directory → collect `*.md` filenames as skill names (strip `.md`). If the directory does not exist, skill list is empty — row still transitions to `ready` (the package is valid but has no discoverable skills)
6. Update row: `local_path`, `commit_sha`, `install_status='ready'`, clear `install_error`
7. On any error: `install_status='error'`, `install_error=<stderr/message>`

**Refresh** (`POST .../refresh`):
1. `git -C <local_path> pull --ff-only`
2. Re-read skill list (new skills may have been added, old ones removed)
3. Update `commit_sha`, `install_status='ready'`

---

## Resolver

`resolveSkillPackages(userId: string, orgId: string, cliType = 'claude'): Promise<ResolvedSkillPackage[]>`

1. Fetch all rows where `(scope='user' AND user_id=userId OR scope='org' AND org_id=orgId) AND install_status='ready' AND cli_type=cliType`
2. For each row: check `fs.existsSync(local_path)` — if false, re-clone transparently (update `local_path`, `commit_sha`)
3. Filter to rows where `enabledSkills.length > 0`
4. Return `ResolvedSkillPackage[]`

---

## SDK Adapter (`@journeyman/skills/sdk-adapter`)

```typescript
import type { ResolvedSkillPackage } from '@journeyman/core';

export function toPluginConfigs(pkgs: ResolvedSkillPackage[]) {
  return pkgs.map(p => ({ type: 'local' as const, path: p.localPath }));
}

export function buildSkillSystemPrompt(pkgs: ResolvedSkillPackage[]): string {
  const skills = pkgs.flatMap(p => p.enabledSkills);
  if (!skills.length) return '';
  return `\n\nActive skills: ${skills.join(', ')}. Apply these skills when applicable.`;
}
```

---

## coding-cli Changes

Each of `analyze.ts`, `plan.ts`, `implement.ts` is updated to:

```typescript
import { toPluginConfigs, buildSkillSystemPrompt } from '@journeyman/skills/sdk-adapter';

// inside the operation function:
const skillPlugins = opts.skills?.length ? toPluginConfigs(opts.skills) : undefined;
const skillPrompt = opts.skills?.length ? buildSkillSystemPrompt(opts.skills) : '';

const response = query({
  prompt: skillPrompt ? `${buildPrompt(opts)}${skillPrompt}` : buildPrompt(opts),
  options: {
    // ... existing options ...
    ...(skillPlugins ? { plugins: skillPlugins } : {}),
  },
});
```

---

## Worker Pre-resolution

`packages/orchestrator/src/workers/phases/` — each phase handler that calls `analyze`/`plan`/`implement` gains skill resolution alongside MCP resolution:

```typescript
const [mcps, skills] = await Promise.all([
  resolveMcpInstances(userId, orgId),
  resolveSkillPackages(userId, orgId, 'claude'),
]);
await claudeProvider.analyze({ ...opts, mcps, skills });
```

The `PhaseDefinition` gains a `supportsSkills` flag (mirrors `supportsMcp`).

---

## Catalog (Static)

Three pre-populated entries in `packages/skills/src/catalog.ts`:

| Name | Git URL | Author | Description |
|------|---------|--------|-------------|
| superpowers | `https://github.com/obra/superpowers` | obra | Complete software development methodology with composable skills |
| agent-skills | `https://github.com/addyosmani/agent-skills` | addyosmani | Production-grade engineering skills for AI coding agents |
| spec-kit | `https://github.com/github/spec-kit` | github | Spec-driven development toolkit |

---

## Web UI

### New Files

| Path | Responsibility |
|------|----------------|
| `packages/web/src/api/skills.ts` | Typed fetch wrappers for all skills endpoints |
| `packages/web/src/routes/MySkillsPage.tsx` | User-scope skills management page |
| `packages/web/src/routes/AdminSkillsPage.tsx` | Org-scope skills management page |
| `packages/web/src/components/skills/AddFromCatalogModal.tsx` | Catalog table with Install per row |
| `packages/web/src/components/skills/AddCustomModal.tsx` | Git URL + name form |
| `packages/web/src/components/skills/EditSkillsModal.tsx` | Per-skill toggle list |
| `packages/web/src/components/skills/PromoteSkillDialog.tsx` | Admin promote user→org |

### Modified Files

| Path | Change |
|------|--------|
| `packages/web/src/App.tsx` | Add `/me/skills` and `/admin/skills` routes |
| `packages/web/src/components/AppShell.tsx` | Add "My Skills" and "Skills" nav links |

### Page Layout (both pages follow same pattern)

```
[My Skills]                               [+ Add from catalog]  [+ Add custom]

┌─────────────────────────────────────────────────────────────────────────────┐
│ Your skill packages (N)                                                     │
├──────────────┬────────────────────────────┬──────────┬───────────┬─────────┤
│ Name         │ Git URL                    │ Status   │ Skills    │ Actions │
├──────────────┼────────────────────────────┼──────────┼───────────┼─────────┤
│ superpowers  │ github.com/obra/superpowers │ ● ready  │ 3 of 14   │ Edit    │
│              │                            │          │           │ Refresh │
│              │                            │          │           │ Delete  │
└──────────────┴────────────────────────────┴──────────┴───────────┴─────────┘
```

Status badge colours: `pending` = yellow, `installing` = blue (animated), `ready` = green, `error` = red.
Polling: while any row is `pending` or `installing`, the page polls `GET .../me` every 3 seconds.

### Add from Catalog Modal

- Table: Name | Description | Author | Git URL | Action
- Already-installed rows show a disabled "Installed" chip instead of "Install" button
- Clicking "Install" calls `POST .../me` and closes the modal; row appears in main table with `pending` badge

### Edit Skills Modal

- Loads `GET /api/orgs/:orgId/skill-packages/:id/skills` → list of discovered skill names
- Checkbox list, pre-checked with current `enabled_skills`
- "Select all" / "Deselect all" shortcuts
- Save calls `PATCH .../me/:id` with updated `enabled_skills`

---

## File Structure Summary

### New

| Path | Package |
|------|---------|
| `packages/skills/` | `@journeyman/skills` (entire new package) |
| `packages/migrations/src/sql/010_skill_packages.sql` | migrations |
| `packages/core/src/types/skills.types.ts` | core |
| `packages/web/src/api/skills.ts` | web |
| `packages/web/src/routes/MySkillsPage.tsx` | web |
| `packages/web/src/routes/AdminSkillsPage.tsx` | web |
| `packages/web/src/components/skills/` (5 files) | web |

### Modified

| Path | Change |
|------|--------|
| `packages/core/src/index.ts` | Export skills types |
| `packages/core/src/types/coding.types.ts` | Add `skills?` to Analyze/Plan/ImplementOptions |
| `packages/coding-cli/src/providers/claude/operations/analyze.ts` | Consume skills |
| `packages/coding-cli/src/providers/claude/operations/plan.ts` | Consume skills |
| `packages/coding-cli/src/providers/claude/operations/implement.ts` | Consume skills |
| `packages/orchestrator/src/workers/phases/analyze-repo-phase-handler.ts` | Resolve + pass skills |
| `packages/orchestrator/src/workers/phases/plan-implementation-phase-handler.ts` | Resolve + pass skills |
| `packages/orchestrator/src/workers/phases/implement-changes-phase-handler.ts` | Resolve + pass skills |
| `packages/flow-editor/src/phase-definition.ts` | Add `supportsSkills` flag |
| `packages/api-server/src/server.ts` | Mount skills routes |
| `packages/web/src/App.tsx` | Add new routes |
| `packages/web/src/components/AppShell.tsx` | Add nav links |
