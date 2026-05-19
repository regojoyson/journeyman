# Skills Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**User overrides for this plan:** No commits during implementation. No unit tests. Run `npm run typecheck` once at the end.

**Goal:** Build a skill package management system — new `@journeyman/skills` package with DB, routes, resolver, and SDK adapter — plus web UI pages mirroring the MCP pattern, wired into `coding-cli` phase operations.

**Architecture:** New `@journeyman/skills` package mirrors `@journeyman/mcp` exactly. DB table `jm_skill_packages` stores git URL + cloned local path (self-healing cache). Resolver fetches ready packages, re-clones if path missing. SDK adapter produces `SdkPluginConfig[]` + system prompt fragment. coding-cli operations and orchestrator phase handlers gain `skills?` alongside existing `mcps?`. Web UI adds "My Skills" and "Admin Skills" pages.

**Tech Stack:** TypeScript, Fastify, pg, React, react-router, Tailwind utility classes (`admin-styles.ts`), `child_process.execSync` for git clone.

**Spec:** [`docs/superpowers/specs/2026-05-04-skills-management-design.md`](../specs/2026-05-04-skills-management-design.md)

---

## File Structure

### Created

| Path | Responsibility |
|------|----------------|
| `packages/migrations/src/sql/010_skill_packages.sql` | DB schema |
| `packages/core/src/types/skills.types.ts` | `SkillPackage`, `ResolvedSkillPackage`, `SkillCatalogEntry` types |
| `packages/skills/package.json` | Package manifest with exports |
| `packages/skills/tsconfig.json` | TypeScript config (mirrors `@journeyman/mcp`) |
| `packages/skills/src/db.ts` | All SQL helpers (insert, list, get, update, delete, listForResolver) |
| `packages/skills/src/installer.ts` | `clonePackage()`, `discoverSkills()`, `refreshPackage()` |
| `packages/skills/src/resolver.ts` | `resolveSkillPackages()` with self-healing re-clone |
| `packages/skills/src/catalog.ts` | Static `SKILL_CATALOG` constant |
| `packages/skills/src/routes/user-skills.ts` | User-scope CRUD routes |
| `packages/skills/src/routes/org-skills.ts` | Org-scope CRUD routes + promote |
| `packages/skills/src/routes/catalog.ts` | `GET /api/skill-packages/catalog` |
| `packages/skills/src/routes/skills-discovery.ts` | `GET /api/orgs/:orgId/skill-packages/:id/skills` |
| `packages/skills/src/routes/index.ts` | Route barrel |
| `packages/skills/src/index.ts` | Package barrel |
| `packages/skills/src/sdk-adapter.ts` | `toPluginConfigs()`, `buildSkillSystemPrompt()` |
| `packages/web/src/api/skills.ts` | Typed fetch wrappers |
| `packages/web/src/routes/MySkillsPage.tsx` | User-scope skills page |
| `packages/web/src/routes/AdminSkillsPage.tsx` | Org-scope skills page |
| `packages/web/src/components/skills/AddFromCatalogModal.tsx` | Catalog install modal |
| `packages/web/src/components/skills/AddCustomModal.tsx` | Custom git URL modal |
| `packages/web/src/components/skills/EditSkillsModal.tsx` | Per-skill toggle modal |
| `packages/web/src/components/skills/PromoteSkillDialog.tsx` | Admin promote dialog |

### Modified

| Path | Change |
|------|--------|
| `packages/core/src/index.ts` | Export skills types |
| `packages/core/src/types/coding.types.ts` | Add `skills?: ResolvedSkillPackage[]` to Analyze/Plan/ImplementOptions |
| `packages/coding-cli/src/providers/claude/operations/analyze.ts` | Import + consume skills |
| `packages/coding-cli/src/providers/claude/operations/plan.ts` | Import + consume skills |
| `packages/coding-cli/src/providers/claude/operations/implement.ts` | Import + consume skills |
| `packages/orchestrator/src/workers/phases/analyze-repo-phase-handler.ts` | Pass skills from input |
| `packages/orchestrator/src/workers/phases/plan-implementation-phase-handler.ts` | Pass skills from input |
| `packages/orchestrator/src/workers/phases/implement-changes-phase-handler.ts` | Pass skills from input |
| `packages/flow-editor/src/phase-definition.ts` | Add `supportsSkills?: boolean` to `PhaseDefinition` |
| `packages/api-server/src/server.ts` | Mount `registerSkillRoutes` |
| `packages/web/src/App.tsx` | Add `/me/skills` and `/admin/skills` routes |
| `packages/web/src/components/AppShell.tsx` | Add nav links |

---

## Tasks

### Task 1: DB Migration

**Files:**
- Create: `packages/migrations/src/sql/010_skill_packages.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 010_skill_packages.sql — user/org-scope skill package registry.

CREATE TABLE IF NOT EXISTS jm_skill_packages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope          TEXT NOT NULL CHECK (scope IN ('user', 'org')),
  user_id        UUID          REFERENCES jm_users(id) ON DELETE CASCADE,
  org_id         UUID NOT NULL REFERENCES jm_orgs(id)  ON DELETE CASCADE,
  git_url        TEXT NOT NULL,
  name           TEXT NOT NULL,
  local_path     TEXT,
  commit_sha     TEXT,
  install_status TEXT NOT NULL DEFAULT 'pending'
                   CHECK (install_status IN ('pending', 'installing', 'ready', 'error')),
  install_error  TEXT,
  enabled_skills TEXT[] NOT NULL DEFAULT '{}',
  cli_type       TEXT NOT NULL DEFAULT 'claude'
                   CHECK (cli_type IN ('claude', 'opencode', 'codex')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jm_skill_packages_scope_unique UNIQUE NULLS NOT DISTINCT (scope, user_id, org_id, git_url)
);

CREATE INDEX IF NOT EXISTS idx_jm_skill_packages_org_user ON jm_skill_packages (org_id, user_id);
```

---

### Task 2: Core Types

**Files:**
- Create: `packages/core/src/types/skills.types.ts`
- Modify: `packages/core/src/types/coding.types.ts` (lines 28–41, 88–100, 148–160)
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create `skills.types.ts`**

```typescript
export type SkillInstallStatus = 'pending' | 'installing' | 'ready' | 'error';
export type SkillCliType = 'claude' | 'opencode' | 'codex';

export interface SkillPackage {
  id: string;
  scope: 'user' | 'org';
  userId?: string;
  orgId: string;
  gitUrl: string;
  name: string;
  localPath?: string;
  commitSha?: string;
  installStatus: SkillInstallStatus;
  installError?: string;
  enabledSkills: string[];
  cliType: SkillCliType;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedSkillPackage {
  id: string;
  name: string;
  localPath: string;
  enabledSkills: string[];
  cliType: SkillCliType;
}

export interface SkillCatalogEntry {
  name: string;
  description: string;
  gitUrl: string;
  author: string;
}
```

- [ ] **Step 2: Add `skills?` to `AnalyzeOptions`, `PlanOptions`, `ImplementOptions` in `coding.types.ts`**

In `packages/core/src/types/coding.types.ts`, add the import at the top and the field to each options type.

After the existing imports, add:
```typescript
import type { ResolvedSkillPackage } from "./skills.types.ts";
```

In `AnalyzeOptions` (around line 28), add after the `mcps?` line:
```typescript
  /** Resolved skill packages to load as plugins for the SDK query. */
  skills?: ResolvedSkillPackage[];
```

In `PlanOptions` (the second options type, around line 88), add after `mcps?`:
```typescript
  skills?: ResolvedSkillPackage[];
```

In `ImplementOptions` (around line 148), add after `mcps?`:
```typescript
  skills?: ResolvedSkillPackage[];
```

- [ ] **Step 3: Export skills types from `packages/core/src/index.ts`**

Add after the existing type exports block:
```typescript
export type * from "./types/skills.types.ts";
```

---

### Task 3: `@journeyman/skills` Package Scaffold

**Files:**
- Create: `packages/skills/package.json`
- Create: `packages/skills/tsconfig.json`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@journeyman/skills",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./sdk-adapter": "./src/sdk-adapter.ts"
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

- [ ] **Step 2: Create `tsconfig.json`**

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

---

### Task 4: DB Helpers

**Files:**
- Create: `packages/skills/src/db.ts`

- [ ] **Step 1: Create `packages/skills/src/db.ts`**

```typescript
import type { Pool } from "pg";
import type { SkillPackage, SkillInstallStatus } from "@journeyman/core";

export class DuplicateSkillPackageError extends Error {
  constructor(gitUrl: string) {
    super(`Skill package already added: ${gitUrl}`);
    this.name = "DuplicateSkillPackageError";
  }
}

function rowToPackage(r: any): SkillPackage {
  return {
    id: r.id,
    scope: r.scope,
    userId: r.user_id ?? undefined,
    orgId: r.org_id,
    gitUrl: r.git_url,
    name: r.name,
    localPath: r.local_path ?? undefined,
    commitSha: r.commit_sha ?? undefined,
    installStatus: r.install_status,
    installError: r.install_error ?? undefined,
    enabledSkills: r.enabled_skills ?? [],
    cliType: r.cli_type,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function insertSkillPackage(
  pool: Pool,
  input: {
    orgId: string;
    userId: string | null;
    scope: 'user' | 'org';
    gitUrl: string;
    name: string;
    cliType?: string;
  },
): Promise<SkillPackage> {
  try {
    const { rows } = await pool.query(
      `INSERT INTO jm_skill_packages (scope, user_id, org_id, git_url, name, cli_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [input.scope, input.userId, input.orgId, input.gitUrl, input.name, input.cliType ?? 'claude'],
    );
    return rowToPackage(rows[0]);
  } catch (err: any) {
    if (err.code === '23505') throw new DuplicateSkillPackageError(input.gitUrl);
    throw err;
  }
}

export async function listSkillPackages(
  pool: Pool,
  orgId: string,
  userId: string | null,
): Promise<SkillPackage[]> {
  const { rows } = userId
    ? await pool.query(
        `SELECT * FROM jm_skill_packages WHERE org_id = $1 AND user_id = $2 ORDER BY created_at`,
        [orgId, userId],
      )
    : await pool.query(
        `SELECT * FROM jm_skill_packages WHERE org_id = $1 AND user_id IS NULL ORDER BY created_at`,
        [orgId],
      );
  return rows.map(rowToPackage);
}

export async function getSkillPackage(
  pool: Pool,
  id: string,
  orgId: string,
  userId: string | null,
): Promise<SkillPackage | null> {
  const { rows } = userId
    ? await pool.query(
        `SELECT * FROM jm_skill_packages WHERE id = $1 AND org_id = $2 AND user_id = $3`,
        [id, orgId, userId],
      )
    : await pool.query(
        `SELECT * FROM jm_skill_packages WHERE id = $1 AND org_id = $2 AND user_id IS NULL`,
        [id, orgId],
      );
  return rows[0] ? rowToPackage(rows[0]) : null;
}

export async function updateSkillPackageStatus(
  pool: Pool,
  id: string,
  patch: {
    installStatus: SkillInstallStatus;
    localPath?: string;
    commitSha?: string;
    installError?: string;
  },
): Promise<void> {
  await pool.query(
    `UPDATE jm_skill_packages
     SET install_status = $2, local_path = COALESCE($3, local_path),
         commit_sha = COALESCE($4, commit_sha), install_error = $5, updated_at = now()
     WHERE id = $1`,
    [id, patch.installStatus, patch.localPath ?? null, patch.commitSha ?? null, patch.installError ?? null],
  );
}

export async function updateEnabledSkills(
  pool: Pool,
  id: string,
  orgId: string,
  userId: string | null,
  enabledSkills: string[],
): Promise<boolean> {
  const { rowCount } = userId
    ? await pool.query(
        `UPDATE jm_skill_packages SET enabled_skills = $1, updated_at = now()
         WHERE id = $2 AND org_id = $3 AND user_id = $4`,
        [enabledSkills, id, orgId, userId],
      )
    : await pool.query(
        `UPDATE jm_skill_packages SET enabled_skills = $1, updated_at = now()
         WHERE id = $2 AND org_id = $3 AND user_id IS NULL`,
        [enabledSkills, id, orgId],
      );
  return (rowCount ?? 0) > 0;
}

export async function deleteSkillPackage(
  pool: Pool,
  id: string,
  orgId: string,
  userId: string | null,
): Promise<boolean> {
  const { rowCount } = userId
    ? await pool.query(
        `DELETE FROM jm_skill_packages WHERE id = $1 AND org_id = $2 AND user_id = $3`,
        [id, orgId, userId],
      )
    : await pool.query(
        `DELETE FROM jm_skill_packages WHERE id = $1 AND org_id = $2 AND user_id IS NULL`,
        [id, orgId],
      );
  return (rowCount ?? 0) > 0;
}

export async function listSkillPackagesForResolver(
  pool: Pool,
  orgId: string,
  userId: string,
  cliType: string,
): Promise<SkillPackage[]> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_skill_packages
     WHERE org_id = $1
       AND cli_type = $2
       AND install_status = 'ready'
       AND (
         (scope = 'org' AND user_id IS NULL)
         OR (scope = 'user' AND user_id = $3)
       )`,
    [orgId, cliType, userId],
  );
  return rows.map(rowToPackage);
}

export interface PromotableSkillRow {
  id: string;
  name: string;
  gitUrl: string;
  ownerId: string;
  ownerEmail: string;
  enabledSkillCount: number;
  updatedAt: string;
}

export async function listPromotableSkillPackages(
  pool: Pool,
  orgId: string,
): Promise<PromotableSkillRow[]> {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.git_url, s.user_id, s.enabled_skills, s.updated_at,
            u.username AS owner_email
       FROM jm_skill_packages s
       JOIN jm_users u ON u.id = s.user_id
      WHERE s.org_id = $1 AND s.user_id IS NOT NULL
      ORDER BY u.username, s.name`,
    [orgId],
  );
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    gitUrl: r.git_url,
    ownerId: r.user_id,
    ownerEmail: r.owner_email,
    enabledSkillCount: (r.enabled_skills ?? []).length,
    updatedAt: r.updated_at,
  }));
}

export async function promoteSkillPackage(
  pool: Pool,
  id: string,
  orgId: string,
): Promise<SkillPackage | null> {
  const pkg = await pool.query(
    `SELECT * FROM jm_skill_packages WHERE id = $1 AND org_id = $2 AND scope = 'user'`,
    [id, orgId],
  );
  if (!pkg.rows[0]) return null;
  const src = rowToPackage(pkg.rows[0]);
  await deleteSkillPackage(pool, id, orgId, src.userId ?? null);
  return insertSkillPackage(pool, {
    orgId,
    userId: null,
    scope: 'org',
    gitUrl: src.gitUrl,
    name: src.name,
    cliType: src.cliType,
  });
}
```

---

### Task 5: Git Installer

**Files:**
- Create: `packages/skills/src/installer.ts`

- [ ] **Step 1: Create `packages/skills/src/installer.ts`**

```typescript
import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";

function cacheDir(): string {
  return process.env.SKILLS_CACHE_DIR ?? join(homedir(), ".journeyman", "skills-cache");
}

function clonePath(gitUrl: string, name: string): string {
  const hash = createHash("sha256").update(gitUrl).digest("hex").slice(0, 8);
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40);
  return join(cacheDir(), `${safe}-${hash}`);
}

export function discoverSkills(localPath: string): string[] {
  const skillsDir = join(localPath, ".claude-plugin", "skills");
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3));
}

export function clonePackage(gitUrl: string, name: string): { localPath: string; commitSha: string } {
  const dest = clonePath(gitUrl, name);
  execSync(`git clone --depth 1 ${JSON.stringify(gitUrl)} ${JSON.stringify(dest)}`, {
    stdio: "pipe",
    timeout: 120_000,
  });
  const commitSha = execSync(`git -C ${JSON.stringify(dest)} rev-parse HEAD`, { stdio: "pipe" })
    .toString()
    .trim();
  return { localPath: dest, commitSha };
}

export function refreshPackage(localPath: string): string {
  execSync(`git -C ${JSON.stringify(localPath)} pull --ff-only`, {
    stdio: "pipe",
    timeout: 60_000,
  });
  return execSync(`git -C ${JSON.stringify(localPath)} rev-parse HEAD`, { stdio: "pipe" })
    .toString()
    .trim();
}

export function ensureCloned(gitUrl: string, name: string): { localPath: string; commitSha: string } {
  const dest = clonePath(gitUrl, name);
  if (existsSync(dest)) {
    const commitSha = execSync(`git -C ${JSON.stringify(dest)} rev-parse HEAD`, { stdio: "pipe" })
      .toString()
      .trim();
    return { localPath: dest, commitSha };
  }
  return clonePackage(gitUrl, name);
}
```

---

### Task 6: Resolver

**Files:**
- Create: `packages/skills/src/resolver.ts`

- [ ] **Step 1: Create `packages/skills/src/resolver.ts`**

```typescript
import { existsSync } from "node:fs";
import type { Pool } from "pg";
import type { ResolvedSkillPackage, SkillCliType } from "@journeyman/core";
import { listSkillPackagesForResolver, updateSkillPackageStatus } from "./db.ts";
import { ensureCloned } from "./installer.ts";

export async function resolveSkillPackages(
  pool: Pool,
  orgId: string,
  userId: string,
  cliType: SkillCliType = 'claude',
): Promise<ResolvedSkillPackage[]> {
  const packages = await listSkillPackagesForResolver(pool, orgId, userId, cliType);
  const resolved: ResolvedSkillPackage[] = [];

  for (const pkg of packages) {
    if (!pkg.enabledSkills.length) continue;

    let localPath = pkg.localPath;
    let commitSha = pkg.commitSha;

    if (!localPath || !existsSync(localPath)) {
      try {
        const result = ensureCloned(pkg.gitUrl, pkg.name);
        localPath = result.localPath;
        commitSha = result.commitSha;
        await updateSkillPackageStatus(pool, pkg.id, {
          installStatus: 'ready',
          localPath,
          commitSha,
        });
      } catch {
        continue;
      }
    }

    resolved.push({
      id: pkg.id,
      name: pkg.name,
      localPath,
      enabledSkills: pkg.enabledSkills,
      cliType: pkg.cliType,
    });
  }

  return resolved;
}
```

---

### Task 7: Catalog

**Files:**
- Create: `packages/skills/src/catalog.ts`

- [ ] **Step 1: Create `packages/skills/src/catalog.ts`**

```typescript
import type { SkillCatalogEntry } from "@journeyman/core";

export const SKILL_CATALOG: SkillCatalogEntry[] = [
  {
    name: "superpowers",
    description: "Complete software development methodology with composable skills for brainstorming, TDD, debugging, and more.",
    gitUrl: "https://github.com/obra/superpowers",
    author: "obra",
  },
  {
    name: "agent-skills",
    description: "Production-grade engineering skills for AI coding agents covering define, plan, build, verify, review, simplify, and ship.",
    gitUrl: "https://github.com/addyosmani/agent-skills",
    author: "addyosmani",
  },
  {
    name: "spec-kit",
    description: "Spec-driven development toolkit — specifications become executable implementations.",
    gitUrl: "https://github.com/github/spec-kit",
    author: "github",
  },
];
```

---

### Task 8: SDK Adapter

**Files:**
- Create: `packages/skills/src/sdk-adapter.ts`

- [ ] **Step 1: Create `packages/skills/src/sdk-adapter.ts`**

```typescript
import type { ResolvedSkillPackage } from "@journeyman/core";

export function toPluginConfigs(
  pkgs: ResolvedSkillPackage[],
): Array<{ type: 'local'; path: string }> {
  return pkgs.map((p) => ({ type: 'local' as const, path: p.localPath }));
}

export function buildSkillSystemPrompt(pkgs: ResolvedSkillPackage[]): string {
  const skills = pkgs.flatMap((p) => p.enabledSkills);
  if (!skills.length) return '';
  return `\n\nActive skills: ${skills.join(', ')}. Apply these skills when applicable.`;
}
```

---

### Task 9: Routes — User Scope

**Files:**
- Create: `packages/skills/src/routes/user-skills.ts`

- [ ] **Step 1: Create `packages/skills/src/routes/user-skills.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  DuplicateSkillPackageError,
  deleteSkillPackage,
  getSkillPackage,
  insertSkillPackage,
  listSkillPackages,
  updateEnabledSkills,
  updateSkillPackageStatus,
} from "../db.ts";
import { clonePackage, discoverSkills, refreshPackage } from "../installer.ts";

export async function registerUserSkillRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/skill-packages/me",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listSkillPackages(pool, orgId, ctx.user.id);
    });

  app.post("/api/orgs/:orgId/skill-packages/me",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { gitUrl: string; name?: string };
      if (!body.gitUrl) return reply.code(400).send({ error: "gitUrl is required" });
      const name = body.name?.trim() || body.gitUrl.split("/").pop()?.replace(/\.git$/, "") || "skill";
      let pkg;
      try {
        pkg = await insertSkillPackage(pool, {
          orgId, userId: ctx.user.id, scope: 'user', gitUrl: body.gitUrl, name,
        });
      } catch (err) {
        if (err instanceof DuplicateSkillPackageError) return reply.code(409).send({ error: err.message });
        throw err;
      }
      reply.code(202);
      setImmediate(() => {
        (async () => {
          await updateSkillPackageStatus(pool, pkg.id, { installStatus: 'installing' });
          try {
            const { localPath, commitSha } = clonePackage(body.gitUrl, name);
            await updateSkillPackageStatus(pool, pkg.id, { installStatus: 'ready', localPath, commitSha });
          } catch (err: any) {
            await updateSkillPackageStatus(pool, pkg.id, {
              installStatus: 'error',
              installError: err.message ?? String(err),
            });
          }
        })();
      });
      return pkg;
    });

  app.patch("/api/orgs/:orgId/skill-packages/me/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { enabledSkills: string[] };
      if (!Array.isArray(body.enabledSkills)) return reply.code(400).send({ error: "enabledSkills must be an array" });
      const ok = await updateEnabledSkills(pool, id, orgId, ctx.user.id, body.enabledSkills);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });

  app.delete("/api/orgs/:orgId/skill-packages/me/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const ok = await deleteSkillPackage(pool, id, orgId, ctx.user.id);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });

  app.post("/api/orgs/:orgId/skill-packages/me/:id/refresh",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const pkg = await getSkillPackage(pool, id, orgId, ctx.user.id);
      if (!pkg) return reply.code(404).send({ error: "Not found" });
      if (!pkg.localPath) return reply.code(400).send({ error: "Package not yet installed" });
      reply.code(202);
      setImmediate(() => {
        (async () => {
          await updateSkillPackageStatus(pool, id, { installStatus: 'installing' });
          try {
            const commitSha = refreshPackage(pkg.localPath!);
            await updateSkillPackageStatus(pool, id, { installStatus: 'ready', commitSha });
          } catch (err: any) {
            await updateSkillPackageStatus(pool, id, {
              installStatus: 'error',
              installError: err.message ?? String(err),
            });
          }
        })();
      });
      return { ok: true };
    });
}
```

---

### Task 10: Routes — Org Scope

**Files:**
- Create: `packages/skills/src/routes/org-skills.ts`

- [ ] **Step 1: Create `packages/skills/src/routes/org-skills.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  DuplicateSkillPackageError,
  deleteSkillPackage,
  getSkillPackage,
  insertSkillPackage,
  listSkillPackages,
  listPromotableSkillPackages,
  promoteSkillPackage,
  updateEnabledSkills,
  updateSkillPackageStatus,
} from "../db.ts";
import { clonePackage, refreshPackage } from "../installer.ts";

export async function registerOrgSkillRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/skill-packages",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listSkillPackages(pool, orgId, null);
    });

  app.post("/api/orgs/:orgId/skill-packages",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { gitUrl: string; name?: string };
      if (!body.gitUrl) return reply.code(400).send({ error: "gitUrl is required" });
      const name = body.name?.trim() || body.gitUrl.split("/").pop()?.replace(/\.git$/, "") || "skill";
      let pkg;
      try {
        pkg = await insertSkillPackage(pool, {
          orgId, userId: null, scope: 'org', gitUrl: body.gitUrl, name,
        });
      } catch (err) {
        if (err instanceof DuplicateSkillPackageError) return reply.code(409).send({ error: err.message });
        throw err;
      }
      reply.code(202);
      setImmediate(() => {
        (async () => {
          await updateSkillPackageStatus(pool, pkg.id, { installStatus: 'installing' });
          try {
            const { localPath, commitSha } = clonePackage(body.gitUrl, name);
            await updateSkillPackageStatus(pool, pkg.id, { installStatus: 'ready', localPath, commitSha });
          } catch (err: any) {
            await updateSkillPackageStatus(pool, pkg.id, {
              installStatus: 'error',
              installError: err.message ?? String(err),
            });
          }
        })();
      });
      return pkg;
    });

  app.patch("/api/orgs/:orgId/skill-packages/:id",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { enabledSkills: string[] };
      if (!Array.isArray(body.enabledSkills)) return reply.code(400).send({ error: "enabledSkills must be an array" });
      const ok = await updateEnabledSkills(pool, id, orgId, null, body.enabledSkills);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });

  app.delete("/api/orgs/:orgId/skill-packages/:id",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const ok = await deleteSkillPackage(pool, id, orgId, null);
      if (!ok) return reply.code(404).send({ error: "Not found" });
      return { ok: true };
    });

  app.post("/api/orgs/:orgId/skill-packages/:id/refresh",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const pkg = await getSkillPackage(pool, id, orgId, null);
      if (!pkg) return reply.code(404).send({ error: "Not found" });
      if (!pkg.localPath) return reply.code(400).send({ error: "Package not yet installed" });
      reply.code(202);
      setImmediate(() => {
        (async () => {
          await updateSkillPackageStatus(pool, id, { installStatus: 'installing' });
          try {
            const commitSha = refreshPackage(pkg.localPath!);
            await updateSkillPackageStatus(pool, id, { installStatus: 'ready', commitSha });
          } catch (err: any) {
            await updateSkillPackageStatus(pool, id, {
              installStatus: 'error',
              installError: err.message ?? String(err),
            });
          }
        })();
      });
      return { ok: true };
    });

  app.get("/api/orgs/:orgId/skill-packages/promotable",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listPromotableSkillPackages(pool, orgId);
    });

  app.post("/api/orgs/:orgId/skill-packages/:id/promote",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const promoted = await promoteSkillPackage(pool, id, orgId);
      if (!promoted) return reply.code(404).send({ error: "Not found or not user-scoped" });
      return promoted;
    });
}
```

---

### Task 11: Routes — Catalog and Skill Discovery

**Files:**
- Create: `packages/skills/src/routes/catalog.ts`
- Create: `packages/skills/src/routes/skills-discovery.ts`
- Create: `packages/skills/src/routes/index.ts`

- [ ] **Step 1: Create `packages/skills/src/routes/catalog.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import { SKILL_CATALOG } from "../catalog.ts";

export async function registerSkillCatalogRoute(app: FastifyInstance) {
  app.get("/api/skill-packages/catalog", async () => SKILL_CATALOG);
}
```

- [ ] **Step 2: Create `packages/skills/src/routes/skills-discovery.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { getSkillPackage } from "../db.ts";
import { discoverSkills } from "../installer.ts";

export async function registerSkillDiscoveryRoute(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get("/api/orgs/:orgId/skill-packages/:id/skills",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const pkg = await getSkillPackage(pool, id, orgId, ctx.user.id)
        ?? await getSkillPackage(pool, id, orgId, null);
      if (!pkg) return reply.code(404).send({ error: "Not found" });
      if (!pkg.localPath) return { skills: [] };
      return { skills: discoverSkills(pkg.localPath) };
    });
}
```

- [ ] **Step 3: Create `packages/skills/src/routes/index.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerUserSkillRoutes } from "./user-skills.ts";
import { registerOrgSkillRoutes } from "./org-skills.ts";
import { registerSkillCatalogRoute } from "./catalog.ts";
import { registerSkillDiscoveryRoute } from "./skills-discovery.ts";

export async function registerSkillRoutes(app: FastifyInstance, pool: Pool) {
  await registerUserSkillRoutes(app, pool);
  await registerOrgSkillRoutes(app, pool);
  await registerSkillCatalogRoute(app);
  await registerSkillDiscoveryRoute(app, pool);
}
```

---

### Task 12: Package Barrel

**Files:**
- Create: `packages/skills/src/index.ts`

- [ ] **Step 1: Create `packages/skills/src/index.ts`**

```typescript
export { DuplicateSkillPackageError } from "./db.ts";
export {
  insertSkillPackage,
  listSkillPackages,
  getSkillPackage,
  updateSkillPackageStatus,
  updateEnabledSkills,
  deleteSkillPackage,
  listSkillPackagesForResolver,
  listPromotableSkillPackages,
  promoteSkillPackage,
} from "./db.ts";
export type { PromotableSkillRow } from "./db.ts";
export { resolveSkillPackages } from "./resolver.ts";
export { registerSkillRoutes } from "./routes/index.ts";
export { SKILL_CATALOG } from "./catalog.ts";
```

---

### Task 13: coding-cli — Consume Skills

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/operations/analyze.ts`
- Modify: `packages/coding-cli/src/providers/claude/operations/plan.ts`
- Modify: `packages/coding-cli/src/providers/claude/operations/implement.ts`

- [ ] **Step 1: Update `analyze.ts`**

Open `packages/coding-cli/src/providers/claude/operations/analyze.ts`.

Add import after the existing MCP sdk-adapter import (line 3):
```typescript
import { toPluginConfigs, buildSkillSystemPrompt } from "@journeyman/skills/sdk-adapter";
```

Find the block where `mcpServers` and `mcpPromptSuffix` are computed (around line 200). After those lines, add:
```typescript
  const skillPlugins = opts.skills?.length ? toPluginConfigs(opts.skills) : undefined;
  const skillPrompt = opts.skills?.length ? buildSkillSystemPrompt(opts.skills) : "";
```

Find the `query({ prompt: ..., options: { ... } })` call. Update the prompt line to append `skillPrompt`:
```typescript
    prompt: (mcpPromptSuffix || skillPrompt)
      ? `${buildPrompt(opts)}${mcpPromptSuffix ? "\n\n" + mcpPromptSuffix : ""}${skillPrompt}`
      : buildPrompt(opts),
```

Inside the `options` object, add `plugins` after the `mcpServers` spread:
```typescript
      ...(skillPlugins ? { plugins: skillPlugins } : {}),
```

- [ ] **Step 2: Update `plan.ts`**

Open `packages/coding-cli/src/providers/claude/operations/plan.ts`.

Add import after the MCP sdk-adapter import:
```typescript
import { toPluginConfigs, buildSkillSystemPrompt } from "@journeyman/skills/sdk-adapter";
```

After the `mcpServers`/`mcpPromptSuffix` block (around line 200), add:
```typescript
  const skillPlugins = opts.skills?.length ? toPluginConfigs(opts.skills) : undefined;
  const skillPrompt = opts.skills?.length ? buildSkillSystemPrompt(opts.skills) : "";
```

Update the `query()` prompt line:
```typescript
    prompt: (mcpPromptSuffix || skillPrompt)
      ? `${buildPrompt(opts)}${mcpPromptSuffix ? "\n\n" + mcpPromptSuffix : ""}${skillPrompt}`
      : buildPrompt(opts),
```

Inside `options`, add after the mcpServers spread:
```typescript
      ...(skillPlugins ? { plugins: skillPlugins } : {}),
```

- [ ] **Step 3: Update `implement.ts`**

Open `packages/coding-cli/src/providers/claude/operations/implement.ts`.

Apply the same three changes as steps 1 and 2 — add the import, compute `skillPlugins`/`skillPrompt` after the MCP block, update the prompt construction, and add `plugins` to options.

---

### Task 14: Orchestrator Phase Handlers — Pass Skills

**Files:**
- Modify: `packages/orchestrator/src/workers/phases/analyze-repo-phase-handler.ts`
- Modify: `packages/orchestrator/src/workers/phases/plan-implementation-phase-handler.ts`
- Modify: `packages/orchestrator/src/workers/phases/implement-changes-phase-handler.ts`

- [ ] **Step 1: Update `analyze-repo-phase-handler.ts`**

Open the file. Find the existing import of `ResolvedMcpInstance` from `@journeyman/core` (line 4). Add `ResolvedSkillPackage` to the same import:
```typescript
import type {
  ICodingCLI, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory,
  ResolvedMcpInstance, ResolvedSkillPackage,
} from "@journeyman/core";
```

Find the line that reads the `mcps` from input (around line 40):
```typescript
    const mcps = Array.isArray(input.mcps) ? (input.mcps as ResolvedMcpInstance[]) : undefined;
```

After it, add:
```typescript
    const skills = Array.isArray(input.skills) ? (input.skills as ResolvedSkillPackage[]) : undefined;
```

Find the `coding.analyze({ ... })` call. Add `skills` alongside `mcps`:
```typescript
    const result = await coding.analyze({
      workspaceDir,
      issue,
      sessionId: ctx.runId,
      signal: ctx.signal,
      ...(mcps ? { mcps } : {}),
      ...(skills ? { skills } : {}),
    });
```

- [ ] **Step 2: Update `plan-implementation-phase-handler.ts`**

Apply the same pattern: add `ResolvedSkillPackage` to the import, read `skills` from `input.skills`, pass `...(skills ? { skills } : {})` to `coding.plan(...)`.

- [ ] **Step 3: Update `implement-changes-phase-handler.ts`**

Apply the same pattern to `implement-changes-phase-handler.ts`: import, read, spread into `coding.implement(...)`.

---

### Task 15: flow-editor Phase Definition

**Files:**
- Modify: `packages/flow-editor/src/phase-definition.ts`

- [ ] **Step 1: Add `supportsSkills` to `PhaseDefinition`**

Open `packages/flow-editor/src/phase-definition.ts`. Find the `PhaseDefinition` interface (search for `supportsMcp`). Add after `supportsMcp`:
```typescript
  /** When true, the phase picker shows the skills tab in flow configuration. */
  supportsSkills?: boolean;
```

---

### Task 16: API Server — Mount Skills Routes

**Files:**
- Modify: `packages/api-server/src/server.ts`

- [ ] **Step 1: Add import and registration**

Open `packages/api-server/src/server.ts`.

Add import after the `registerMcpRoutes` import (line 14):
```typescript
import { registerSkillRoutes } from "@journeyman/skills";
```

Inside the `if (c.pool)` block (around line 32–34), add after `registerMcpRoutes`:
```typescript
    await registerSkillRoutes(app, c.pool);
```

---

### Task 17: Web API Client

**Files:**
- Create: `packages/web/src/api/skills.ts`

- [ ] **Step 1: Create `packages/web/src/api/skills.ts`**

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
  cliType: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillCatalogEntry {
  name: string;
  description: string;
  gitUrl: string;
  author: string;
}

export interface PromotableSkillRow {
  id: string;
  name: string;
  gitUrl: string;
  ownerId: string;
  ownerEmail: string;
  enabledSkillCount: number;
  updatedAt: string;
}

const userBase = (orgId: string) => `/api/orgs/${orgId}/skill-packages/me`;
const orgBase = (orgId: string) => `/api/orgs/${orgId}/skill-packages`;

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (r.ok) return r.json() as Promise<T>;
  const body = await r.json().catch(() => ({}));
  throw new Error((body as any)?.error ?? `HTTP ${r.status}`);
}

export const skillsApi = {
  listMy: (orgId: string) =>
    fetch(userBase(orgId), { credentials: "include" }).then(jsonOrThrow<SkillPackage[]>),

  listOrg: (orgId: string) =>
    fetch(orgBase(orgId), { credentials: "include" }).then(jsonOrThrow<SkillPackage[]>),

  catalog: () =>
    fetch("/api/skill-packages/catalog", { credentials: "include" }).then(jsonOrThrow<SkillCatalogEntry[]>),

  listPromotable: (orgId: string) =>
    fetch(`${orgBase(orgId)}/promotable`, { credentials: "include" }).then(jsonOrThrow<PromotableSkillRow[]>),

  discoverSkills: (orgId: string, id: string) =>
    fetch(`/api/orgs/${orgId}/skill-packages/${id}/skills`, { credentials: "include" })
      .then(jsonOrThrow<{ skills: string[] }>)
      .then((r) => r.skills),

  addMy: (orgId: string, body: { gitUrl: string; name?: string }) =>
    fetch(userBase(orgId), {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<SkillPackage>),

  addOrg: (orgId: string, body: { gitUrl: string; name?: string }) =>
    fetch(orgBase(orgId), {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<SkillPackage>),

  updateEnabledMy: (orgId: string, id: string, enabledSkills: string[]) =>
    fetch(`${userBase(orgId)}/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabledSkills }),
    }).then(jsonOrThrow<{ ok: true }>),

  updateEnabledOrg: (orgId: string, id: string, enabledSkills: string[]) =>
    fetch(`${orgBase(orgId)}/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabledSkills }),
    }).then(jsonOrThrow<{ ok: true }>),

  removeMy: (orgId: string, id: string) =>
    fetch(`${userBase(orgId)}/${id}`, { method: "DELETE", credentials: "include" })
      .then(jsonOrThrow<{ ok: true }>),

  removeOrg: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}`, { method: "DELETE", credentials: "include" })
      .then(jsonOrThrow<{ ok: true }>),

  refreshMy: (orgId: string, id: string) =>
    fetch(`${userBase(orgId)}/${id}/refresh`, { method: "POST", credentials: "include" })
      .then(jsonOrThrow<{ ok: true }>),

  refreshOrg: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}/refresh`, { method: "POST", credentials: "include" })
      .then(jsonOrThrow<{ ok: true }>),

  promote: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}/promote`, { method: "POST", credentials: "include" })
      .then(jsonOrThrow<SkillPackage>),
};
```

---

### Task 18: Web Components

**Files:**
- Create: `packages/web/src/components/skills/AddFromCatalogModal.tsx`
- Create: `packages/web/src/components/skills/AddCustomModal.tsx`
- Create: `packages/web/src/components/skills/EditSkillsModal.tsx`
- Create: `packages/web/src/components/skills/PromoteSkillDialog.tsx`

- [ ] **Step 1: Create `AddFromCatalogModal.tsx`**

```tsx
import { useEffect, useState } from "react";
import { skillsApi, type SkillCatalogEntry, type SkillPackage } from "../../api/skills.ts";
import { btnPrimary, btnGhost, card } from "../../routes/admin-styles.ts";

interface Props {
  orgId: string;
  scope: 'user' | 'org';
  installed: SkillPackage[];
  onDone: () => void;
  onClose: () => void;
}

export function AddFromCatalogModal({ orgId, scope, installed, onDone, onClose }: Props) {
  const [catalog, setCatalog] = useState<SkillCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    skillsApi.catalog().then(setCatalog).finally(() => setLoading(false));
  }, []);

  const installedUrls = new Set(installed.map((p) => p.gitUrl));

  async function install(entry: SkillCatalogEntry) {
    setAdding(entry.gitUrl);
    try {
      scope === 'user'
        ? await skillsApi.addMy(orgId, { gitUrl: entry.gitUrl, name: entry.name })
        : await skillsApi.addOrg(orgId, { gitUrl: entry.gitUrl, name: entry.name });
      onDone();
      onClose();
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className={`${card} w-full max-w-2xl mx-4`}>
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">Add from catalog</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-xl leading-none">&times;</button>
        </div>
        <div className="p-6">
          {loading ? (
            <p className="text-sm text-slate-500 text-center py-4">Loading…</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left py-2 pr-4">Name</th>
                  <th className="text-left py-2 pr-4">Author</th>
                  <th className="text-left py-2 pr-4">Description</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((entry) => (
                  <tr key={entry.gitUrl} className="border-t border-slate-800">
                    <td className="py-3 pr-4 font-medium text-slate-200">{entry.name}</td>
                    <td className="py-3 pr-4 text-slate-400">{entry.author}</td>
                    <td className="py-3 pr-4 text-slate-400">{entry.description}</td>
                    <td className="py-3">
                      {installedUrls.has(entry.gitUrl) ? (
                        <span className="text-xs text-slate-500 border border-slate-700 px-2 py-1 rounded">Installed</span>
                      ) : (
                        <button
                          onClick={() => install(entry)}
                          disabled={adding === entry.gitUrl}
                          className={btnPrimary}
                        >
                          {adding === entry.gitUrl ? "Installing…" : "Install"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-800 flex justify-end">
          <button onClick={onClose} className={btnGhost}>Close</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `AddCustomModal.tsx`**

```tsx
import { useState } from "react";
import { skillsApi } from "../../api/skills.ts";
import { btnPrimary, btnGhost, card } from "../../routes/admin-styles.ts";

interface Props {
  orgId: string;
  scope: 'user' | 'org';
  onDone: () => void;
  onClose: () => void;
}

export function AddCustomModal({ orgId, scope, onDone, onClose }: Props) {
  const [gitUrl, setGitUrl] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      scope === 'user'
        ? await skillsApi.addMy(orgId, { gitUrl, name: name || undefined })
        : await skillsApi.addOrg(orgId, { gitUrl, name: name || undefined });
      onDone();
      onClose();
    } catch (err: any) {
      setError(err.message ?? "Failed to add package");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className={`${card} w-full max-w-md mx-4`}>
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">Add custom skill package</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit}>
          <div className="p-6 space-y-4">
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Git URL <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                placeholder="https://github.com/org/repo.git"
                required
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-slate-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Display name <span className="text-slate-600">(optional)</span></label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Defaults to repo name"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-slate-500"
              />
            </div>
          </div>
          <div className="px-6 py-4 border-t border-slate-800 flex justify-end gap-2">
            <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
            <button type="submit" disabled={saving || !gitUrl} className={btnPrimary}>
              {saving ? "Adding…" : "Add package"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `EditSkillsModal.tsx`**

```tsx
import { useEffect, useState } from "react";
import { skillsApi, type SkillPackage } from "../../api/skills.ts";
import { btnPrimary, btnGhost, card } from "../../routes/admin-styles.ts";

interface Props {
  orgId: string;
  pkg: SkillPackage;
  scope: 'user' | 'org';
  onDone: () => void;
  onClose: () => void;
}

export function EditSkillsModal({ orgId, pkg, scope, onDone, onClose }: Props) {
  const [available, setAvailable] = useState<string[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set(pkg.enabledSkills));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    skillsApi.discoverSkills(orgId, pkg.id)
      .then((skills) => {
        setAvailable(skills);
        if (skills.length > 0 && enabled.size === 0) setEnabled(new Set(skills));
      })
      .finally(() => setLoading(false));
  }, [orgId, pkg.id]);

  function toggle(skill: string) {
    setEnabled((prev) => {
      const next = new Set(prev);
      next.has(skill) ? next.delete(skill) : next.add(skill);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      scope === 'user'
        ? await skillsApi.updateEnabledMy(orgId, pkg.id, [...enabled])
        : await skillsApi.updateEnabledOrg(orgId, pkg.id, [...enabled]);
      onDone();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className={`${card} w-full max-w-md mx-4`}>
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">Skills in <span className="text-blue-400">{pkg.name}</span></h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-xl leading-none">&times;</button>
        </div>
        <div className="p-6">
          {loading ? (
            <p className="text-sm text-slate-500 text-center py-4">Discovering skills…</p>
          ) : available.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">No discoverable skills found in this package.</p>
          ) : (
            <>
              <div className="flex gap-3 mb-4">
                <button onClick={() => setEnabled(new Set(available))} className="text-xs text-blue-400 hover:text-blue-300">Select all</button>
                <button onClick={() => setEnabled(new Set())} className="text-xs text-slate-400 hover:text-slate-300">Deselect all</button>
              </div>
              <ul className="space-y-2 max-h-72 overflow-y-auto">
                {available.map((skill) => (
                  <li key={skill} className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id={`skill-${skill}`}
                      checked={enabled.has(skill)}
                      onChange={() => toggle(skill)}
                      className="accent-blue-500"
                    />
                    <label htmlFor={`skill-${skill}`} className="text-sm text-slate-200 cursor-pointer">{skill}</label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-800 flex justify-end gap-2">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={save} disabled={saving || loading} className={btnPrimary}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `PromoteSkillDialog.tsx`**

```tsx
import { useState } from "react";
import { skillsApi, type PromotableSkillRow } from "../../api/skills.ts";
import { btnPrimary, btnGhost, card } from "../../routes/admin-styles.ts";

interface Props {
  orgId: string;
  pkg: PromotableSkillRow;
  onDone: () => void;
  onClose: () => void;
}

export function PromoteSkillDialog({ orgId, pkg, onDone, onClose }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function promote() {
    setSaving(true);
    setError(null);
    try {
      await skillsApi.promote(orgId, pkg.id);
      onDone();
      onClose();
    } catch (err: any) {
      setError(err.message ?? "Failed to promote");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className={`${card} w-full max-w-sm mx-4`}>
        <div className="px-6 py-4 border-b border-slate-800">
          <h2 className="text-base font-semibold text-slate-100">Promote to org</h2>
        </div>
        <div className="p-6 space-y-3">
          {error && <p className="text-sm text-red-400">{error}</p>}
          <p className="text-sm text-slate-300">
            Promote <span className="font-medium text-slate-100">{pkg.name}</span> from personal to org-wide? The personal copy will be removed.
          </p>
        </div>
        <div className="px-6 py-4 border-t border-slate-800 flex justify-end gap-2">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={promote} disabled={saving} className={btnPrimary}>
            {saving ? "Promoting…" : "Promote"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

### Task 19: Web Pages

**Files:**
- Create: `packages/web/src/routes/MySkillsPage.tsx`
- Create: `packages/web/src/routes/AdminSkillsPage.tsx`

- [ ] **Step 1: Create `MySkillsPage.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { btnDanger, btnGhost, btnPrimary, card, codePill } from "./admin-styles.ts";
import { skillsApi, type SkillPackage } from "../api/skills.ts";
import { AddFromCatalogModal } from "../components/skills/AddFromCatalogModal.tsx";
import { AddCustomModal } from "../components/skills/AddCustomModal.tsx";
import { EditSkillsModal } from "../components/skills/EditSkillsModal.tsx";

const statusColors: Record<string, string> = {
  ready: "text-green-400",
  pending: "text-yellow-400",
  installing: "text-blue-400 animate-pulse",
  error: "text-red-400",
};

export function MySkillsPage(props: { orgId: string }) {
  const [rows, setRows] = useState<SkillPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"catalog" | "custom" | null>(null);
  const [editing, setEditing] = useState<SkillPackage | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh() {
    setLoading(true);
    try { setRows(await skillsApi.listMy(props.orgId)); } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, [props.orgId]);

  useEffect(() => {
    const busy = rows.some((r) => r.installStatus === "pending" || r.installStatus === "installing");
    if (busy && !pollingRef.current) {
      pollingRef.current = setInterval(() => refresh(), 3000);
    } else if (!busy && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [rows]);

  async function remove(row: SkillPackage) {
    if (!confirm(`Delete skill package "${row.name}"?`)) return;
    await skillsApi.removeMy(props.orgId, row.id);
    refresh();
  }

  async function refresh1(row: SkillPackage) {
    await skillsApi.refreshMy(props.orgId, row.id);
    refresh();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">My Skills</h1>
            <p className="mt-1 text-sm text-slate-400">Personal skill packages available to your runs.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setModal("catalog")} className={btnGhost}>+ Add from catalog</button>
            <button onClick={() => setModal("custom")} className={btnPrimary}>+ Add custom</button>
          </div>
        </header>

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="text-base font-medium text-slate-100">
              Your skill packages <span className="text-slate-500 font-normal">({rows.length})</span>
            </h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No skill packages yet. Use "Add from catalog" or "Add custom" above.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-900/40 text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Git URL</th>
                  <th className="text-left font-medium px-6 py-3">Status</th>
                  <th className="text-left font-medium px-6 py-3">Skills</th>
                  <th className="text-left font-medium px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-800/30">
                    <td className="px-6 py-4 font-medium text-slate-200">{row.name}</td>
                    <td className="px-6 py-4">
                      <span className={codePill}>{row.gitUrl}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={statusColors[row.installStatus] ?? "text-slate-400"}>
                        ● {row.installStatus}
                      </span>
                      {row.installError && (
                        <p className="text-xs text-red-400 mt-1">{row.installError}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-400">
                      {row.installStatus === 'ready' ? `${row.enabledSkills.length} enabled` : "—"}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditing(row)}
                          disabled={row.installStatus !== 'ready'}
                          className={btnGhost}
                        >
                          Edit skills
                        </button>
                        <button onClick={() => refresh1(row)} className={btnGhost}>Refresh</button>
                        <button onClick={() => remove(row)} className={btnDanger}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {modal === "catalog" && (
          <AddFromCatalogModal
            orgId={props.orgId}
            scope="user"
            installed={rows}
            onDone={refresh}
            onClose={() => setModal(null)}
          />
        )}
        {modal === "custom" && (
          <AddCustomModal
            orgId={props.orgId}
            scope="user"
            onDone={refresh}
            onClose={() => setModal(null)}
          />
        )}
        {editing && (
          <EditSkillsModal
            orgId={props.orgId}
            pkg={editing}
            scope="user"
            onDone={refresh}
            onClose={() => setEditing(null)}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `AdminSkillsPage.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { btnDanger, btnGhost, btnPrimary, card, codePill } from "./admin-styles.ts";
import { skillsApi, type PromotableSkillRow, type SkillPackage } from "../api/skills.ts";
import { AddFromCatalogModal } from "../components/skills/AddFromCatalogModal.tsx";
import { AddCustomModal } from "../components/skills/AddCustomModal.tsx";
import { EditSkillsModal } from "../components/skills/EditSkillsModal.tsx";
import { PromoteSkillDialog } from "../components/skills/PromoteSkillDialog.tsx";

const statusColors: Record<string, string> = {
  ready: "text-green-400",
  pending: "text-yellow-400",
  installing: "text-blue-400 animate-pulse",
  error: "text-red-400",
};

export function AdminSkillsPage(props: { orgId: string }) {
  const [rows, setRows] = useState<SkillPackage[]>([]);
  const [promotable, setPromotable] = useState<PromotableSkillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"catalog" | "custom" | null>(null);
  const [editing, setEditing] = useState<SkillPackage | null>(null);
  const [promoting, setPromoting] = useState<PromotableSkillRow | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        skillsApi.listOrg(props.orgId),
        skillsApi.listPromotable(props.orgId),
      ]);
      setRows(a);
      setPromotable(b);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [props.orgId]);

  useEffect(() => {
    const busy = rows.some((r) => r.installStatus === "pending" || r.installStatus === "installing");
    if (busy && !pollingRef.current) {
      pollingRef.current = setInterval(() => refresh(), 3000);
    } else if (!busy && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [rows]);

  async function remove(row: SkillPackage) {
    if (!confirm(`Delete org skill package "${row.name}"?`)) return;
    await skillsApi.removeOrg(props.orgId, row.id);
    refresh();
  }

  async function refresh1(row: SkillPackage) {
    await skillsApi.refreshOrg(props.orgId, row.id);
    refresh();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">Org Skills</h1>
            <p className="mt-1 text-sm text-slate-400">Org-wide skill packages available to all runs.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setModal("catalog")} className={btnGhost}>+ Add from catalog</button>
            <button onClick={() => setModal("custom")} className={btnPrimary}>+ Add custom</button>
          </div>
        </header>

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="text-base font-medium text-slate-100">
              Org skill packages <span className="text-slate-500 font-normal">({rows.length})</span>
            </h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No org skill packages yet. Use "Add from catalog" or "Add custom" above.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-900/40 text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Git URL</th>
                  <th className="text-left font-medium px-6 py-3">Status</th>
                  <th className="text-left font-medium px-6 py-3">Skills</th>
                  <th className="text-left font-medium px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-800/30">
                    <td className="px-6 py-4 font-medium text-slate-200">{row.name}</td>
                    <td className="px-6 py-4">
                      <span className={codePill}>{row.gitUrl}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={statusColors[row.installStatus] ?? "text-slate-400"}>
                        ● {row.installStatus}
                      </span>
                      {row.installError && (
                        <p className="text-xs text-red-400 mt-1">{row.installError}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-400">
                      {row.installStatus === 'ready' ? `${row.enabledSkills.length} enabled` : "—"}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditing(row)}
                          disabled={row.installStatus !== 'ready'}
                          className={btnGhost}
                        >
                          Edit skills
                        </button>
                        <button onClick={() => refresh1(row)} className={btnGhost}>Refresh</button>
                        <button onClick={() => remove(row)} className={btnDanger}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {promotable.length > 0 && (
          <section className={`${card} overflow-hidden`}>
            <div className="px-6 py-4 border-b border-slate-800">
              <h2 className="text-base font-medium text-slate-100">
                Promotable <span className="text-slate-500 font-normal">({promotable.length})</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">User-scoped packages that can be promoted org-wide.</p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-900/40 text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Owner</th>
                  <th className="text-left font-medium px-6 py-3">Skills enabled</th>
                  <th className="text-left font-medium px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {promotable.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-800/30">
                    <td className="px-6 py-4 font-medium text-slate-200">{row.name}</td>
                    <td className="px-6 py-4 text-slate-400">{row.ownerEmail}</td>
                    <td className="px-6 py-4 text-slate-400">{row.enabledSkillCount}</td>
                    <td className="px-6 py-4">
                      <button onClick={() => setPromoting(row)} className={btnGhost}>Promote to org</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {modal === "catalog" && (
          <AddFromCatalogModal
            orgId={props.orgId}
            scope="org"
            installed={rows}
            onDone={refresh}
            onClose={() => setModal(null)}
          />
        )}
        {modal === "custom" && (
          <AddCustomModal
            orgId={props.orgId}
            scope="org"
            onDone={refresh}
            onClose={() => setModal(null)}
          />
        )}
        {editing && (
          <EditSkillsModal
            orgId={props.orgId}
            pkg={editing}
            scope="org"
            onDone={refresh}
            onClose={() => setEditing(null)}
          />
        )}
        {promoting && (
          <PromoteSkillDialog
            orgId={props.orgId}
            pkg={promoting}
            onDone={refresh}
            onClose={() => setPromoting(null)}
          />
        )}
      </div>
    </div>
  );
}
```

---

### Task 20: Wire Routes and Nav

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/components/AppShell.tsx`

- [ ] **Step 1: Add routes to `App.tsx`**

Open `packages/web/src/App.tsx`.

Add two imports after the `AdminMcpsPage` import:
```typescript
import { MySkillsPage } from "./routes/MySkillsPage.tsx";
import { AdminSkillsPage } from "./routes/AdminSkillsPage.tsx";
```

Add two routes inside the `<Route element={<AppShell />}>` block, after the existing MCP routes:
```tsx
        <Route path="/me/skills" element={<MySkillsPage orgId={activeOrgId} />} />
        <Route path="/admin/skills" element={role === "admin" ? <AdminSkillsPage orgId={activeOrgId} /> : <Navigate to="/" replace />} />
```

- [ ] **Step 2: Add nav links to `AppShell.tsx`**

Open `packages/web/src/components/AppShell.tsx`.

After the `<NavLink to="/me/mcps" ...>My MCPs</NavLink>` line (line 51), add:
```tsx
        <NavLink to="/me/skills" style={navStyle}>My Skills</NavLink>
```

After the `{role === "admin" && <NavLink to="/admin/mcps" ...>Org MCPs</NavLink>}` line (line 54), add:
```tsx
        {role === "admin" && <NavLink to="/admin/skills" style={navStyle}>Org Skills</NavLink>}
```

---

### Task 21: Typecheck

- [ ] **Step 1: Install workspace deps to link the new package**

```bash
npm install
```

Expected: workspace symlinks created, no errors.

- [ ] **Step 2: Run typecheck across all packages**

```bash
npm run typecheck
```

Expected: all packages pass with no type errors.

Fix any type errors before marking complete.
