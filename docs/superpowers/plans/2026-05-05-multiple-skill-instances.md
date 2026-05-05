# Multiple Skill Package Instances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow same git URL to be added multiple times within a scope, with shared or independent clones chosen at create time.

**Architecture:** Drop the URL unique constraint, add a name unique constraint per scope. Each row carries its own `local_path`. Sharing copies the path from an existing row; independent installs run a fresh clone. Pull-latest and delete handle shared paths via path-keyed DB updates and reference counting.

**Tech Stack:** Postgres, Fastify, React, TypeScript.

**User overrides:** No commits during implementation. No unit tests. Run `npm run typecheck` once at the end.

---

### Task 1: DB migration — swap unique constraint

**Files:**
- Create: `packages/migrations/src/sql/011_skill_packages_name_unique.sql`

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE jm_skill_packages
  DROP CONSTRAINT jm_skill_packages_scope_unique;

ALTER TABLE jm_skill_packages
  ADD CONSTRAINT jm_skill_packages_name_unique
  UNIQUE NULLS NOT DISTINCT (scope, user_id, org_id, name);
```

---

### Task 2: DB helpers — error message + share + path-keyed update

**Files:**
- Modify: `packages/skills/src/db.ts`

- [ ] **Step 1: Update `DuplicateSkillPackageError` to take a name**

Replace:
```typescript
export class DuplicateSkillPackageError extends Error {
  constructor(gitUrl: string) {
    super(`Skill package already added: ${gitUrl}`);
    this.name = "DuplicateSkillPackageError";
  }
}
```

With:
```typescript
export class DuplicateSkillPackageError extends Error {
  constructor(name: string) {
    super(`Skill package name already in use: ${name}`);
    this.name = "DuplicateSkillPackageError";
  }
}
```

- [ ] **Step 2: Update `insertSkillPackage` signature + implementation**

Replace:
```typescript
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
```

With:
```typescript
export async function insertSkillPackage(
  pool: Pool,
  input: {
    orgId: string;
    userId: string | null;
    scope: 'user' | 'org';
    gitUrl: string;
    name: string;
    cliType?: string;
    shareCloneWith?: string; // existing package id in same scope
  },
): Promise<SkillPackage> {
  try {
    if (input.shareCloneWith) {
      // Copy local_path / commit_sha / install_status from the source row
      const { rows } = await pool.query(
        `INSERT INTO jm_skill_packages
            (scope, user_id, org_id, git_url, name, cli_type,
             local_path, commit_sha, install_status)
         SELECT $1, $2, $3, $4, $5, $6,
                src.local_path, src.commit_sha, 'ready'
         FROM jm_skill_packages src
         WHERE src.id = $7
           AND src.org_id = $3
           AND COALESCE(src.user_id::text, '') = COALESCE($2::text, '')
           AND src.git_url = $4
           AND src.install_status = 'ready'
         RETURNING *`,
        [
          input.scope, input.userId, input.orgId, input.gitUrl,
          input.name, input.cliType ?? 'claude', input.shareCloneWith,
        ],
      );
      if (!rows[0]) {
        throw new Error("Share-clone source not found, not in same scope, or not ready");
      }
      return rowToPackage(rows[0]);
    }
    const { rows } = await pool.query(
      `INSERT INTO jm_skill_packages (scope, user_id, org_id, git_url, name, cli_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [input.scope, input.userId, input.orgId, input.gitUrl, input.name, input.cliType ?? 'claude'],
    );
    return rowToPackage(rows[0]);
  } catch (err: any) {
    if (err.code === '23505') throw new DuplicateSkillPackageError(input.name);
    throw err;
  }
}
```

- [ ] **Step 3: Add `findShareableSkillPackage` helper**

Append to `db.ts`:

```typescript
export async function findShareableSkillPackage(
  pool: Pool,
  orgId: string,
  userId: string | null,
  gitUrl: string,
): Promise<SkillPackage | null> {
  const { rows } = userId
    ? await pool.query(
        `SELECT * FROM jm_skill_packages
          WHERE org_id = $1 AND user_id = $2
            AND git_url = $3 AND install_status = 'ready'
          ORDER BY created_at LIMIT 1`,
        [orgId, userId, gitUrl],
      )
    : await pool.query(
        `SELECT * FROM jm_skill_packages
          WHERE org_id = $1 AND user_id IS NULL
            AND git_url = $2 AND install_status = 'ready'
          ORDER BY created_at LIMIT 1`,
        [orgId, gitUrl],
      );
  return rows[0] ? rowToPackage(rows[0]) : null;
}
```

- [ ] **Step 4: Add `updateSkillPackageStatusByPath` helper**

Append to `db.ts`:

```typescript
export async function updateSkillPackageStatusByPath(
  pool: Pool,
  localPath: string,
  patch: {
    installStatus: SkillInstallStatus;
    commitSha?: string;
    installError?: string;
  },
): Promise<void> {
  await pool.query(
    `UPDATE jm_skill_packages
     SET install_status = $2,
         commit_sha = COALESCE($3, commit_sha),
         install_error = $4,
         updated_at = now()
     WHERE local_path = $1`,
    [localPath, patch.installStatus, patch.commitSha ?? null, patch.installError ?? null],
  );
}
```

- [ ] **Step 5: Add `countRowsByLocalPath` helper (used by delete cleanup)**

Append to `db.ts`:

```typescript
export async function countRowsByLocalPath(pool: Pool, localPath: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM jm_skill_packages WHERE local_path = $1`,
    [localPath],
  );
  return rows[0]?.n ?? 0;
}
```

---

### Task 3: Installer — share-aware DB writes during install

**Files:**
- Modify: `packages/skills/src/installer.ts`

- [ ] **Step 1: Update `runInstall` to use path-keyed update once a path is known**

Replace the body of `runInstall`:

```typescript
export async function runInstall(
  pool: import("pg").Pool,
  id: string,
  name: string,
  gitUrl: string,
  existingLocalPath: string | undefined,
): Promise<void> {
  const { updateSkillPackageStatus, updateSkillPackageStatusByPath } = await import("./db.ts");
  await updateSkillPackageStatus(pool, id, { installStatus: "installing" });
  try {
    const result =
      existingLocalPath && existsSync(existingLocalPath)
        ? refreshPackage(existingLocalPath, gitUrl)
        : clonePackage(name, gitUrl);
    // Update by id first so the row gets its localPath set, then by path
    // so any other rows sharing this path also pick up the new commit.
    await updateSkillPackageStatus(pool, id, {
      installStatus: "ready",
      localPath: result.localPath,
      commitSha: result.commitSha,
    });
    await updateSkillPackageStatusByPath(pool, result.localPath, {
      installStatus: "ready",
      commitSha: result.commitSha,
    });
  } catch (err) {
    await updateSkillPackageStatus(pool, id, {
      installStatus: "error",
      installError: String(err),
    });
  }
}
```

---

### Task 4: SDK adapter — dedupe plugins by localPath

**Files:**
- Modify: `packages/skills/src/sdk-adapter.ts`

- [ ] **Step 1: Dedupe by `localPath` in `toSdkPluginConfigs`**

Replace `toSdkPluginConfigs`:

```typescript
export function toSdkPluginConfigs(skills: ResolvedSkillPackage[]): SdkPluginConfig[] {
  const seen = new Set<string>();
  const out: SdkPluginConfig[] = [];
  for (const s of skills) {
    if (!s.localPath || !existsSync(s.localPath)) continue;
    if (seen.has(s.localPath)) continue;
    seen.add(s.localPath);
    out.push({ type: "local" as const, path: s.localPath });
  }
  return out;
}
```

---

### Task 5: User routes — by-url, share-clone create, delete cleanup

**Files:**
- Modify: `packages/skills/src/routes/user-skills.ts`

- [ ] **Step 1: Add imports for new helpers**

Update the db import line:

```typescript
import {
  DuplicateSkillPackageError,
  countRowsByLocalPath,
  deleteSkillPackage,
  findShareableSkillPackage,
  getSkillPackage,
  insertSkillPackage,
  listSkillPackages,
  updateEnabledSkills,
} from "../db.ts";
```

Add `rmSync` import:

```typescript
import { rmSync } from "node:fs";
```

- [ ] **Step 2: Update POST to accept `shareCloneWith`**

Replace the body of the `app.post(.../skill-packages, ...)` handler so the `insertSkillPackage` call passes through `shareCloneWith` and skips `runInstall` when sharing:

```typescript
const rec = await insertSkillPackage(pool, {
  orgId,
  userId: ctx.user.id,
  scope: "user",
  gitUrl: body.gitUrl,
  name: body.name,
  cliType: body.cliType ?? "claude",
  shareCloneWith: body.shareCloneWith ?? undefined,
});
if (!body.shareCloneWith) {
  void runInstall(pool, rec.id, rec.name, rec.gitUrl, undefined);
}
reply.code(201);
return rec;
```

- [ ] **Step 3: Add the by-url route**

Insert before the closing `}` of `registerUserSkillRoutes`:

```typescript
app.get(
  "/api/orgs/:orgId/users/me/skill-packages/by-url",
  { preHandler: requireAuth() },
  async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { url } = req.query as { url?: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    if (!url) return reply.code(400).send({ error: "Missing url query param" });
    const rec = await findShareableSkillPackage(pool, orgId, ctx.user.id, url);
    if (!rec) return reply.code(404).send({ error: "Not found" });
    return rec;
  },
);
```

- [ ] **Step 4: Update DELETE to clean up the directory when no refs remain**

Replace the existing delete handler body:

```typescript
async (req, reply) => {
  const { orgId, id } = req.params as { orgId: string; id: string };
  const ctx = req.runContext!;
  if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
  const rec = await getSkillPackage(pool, id, orgId, ctx.user.id);
  if (!rec) return reply.code(404).send({ error: "Not found" });
  const ok = await deleteSkillPackage(pool, id, orgId, ctx.user.id);
  if (!ok) return reply.code(404).send({ error: "Not found" });
  if (rec.localPath) {
    const remaining = await countRowsByLocalPath(pool, rec.localPath);
    if (remaining === 0) {
      try { rmSync(rec.localPath, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
  return { ok: true };
},
```

---

### Task 6: Org routes — same shape as user routes

**Files:**
- Modify: `packages/skills/src/routes/org-skills.ts`

- [ ] **Step 1: Update imports the same way (add `countRowsByLocalPath`, `findShareableSkillPackage`, `rmSync`)**

```typescript
import {
  DuplicateSkillPackageError,
  countRowsByLocalPath,
  deleteSkillPackage,
  findShareableSkillPackage,
  getSkillPackage,
  insertSkillPackage,
  listSkillPackages,
  listPromotableSkillPackages,
  promoteSkillPackage,
  updateEnabledSkills,
} from "../db.ts";
import { rmSync } from "node:fs";
```

- [ ] **Step 2: Update POST to accept `shareCloneWith`**

```typescript
const rec = await insertSkillPackage(pool, {
  orgId,
  userId: null,
  scope: "org",
  gitUrl: body.gitUrl,
  name: body.name,
  cliType: body.cliType ?? "claude",
  shareCloneWith: body.shareCloneWith ?? undefined,
});
if (!body.shareCloneWith) {
  void runInstall(pool, rec.id, rec.name, rec.gitUrl, undefined);
}
reply.code(201);
return rec;
```

- [ ] **Step 3: Add the by-url route**

Insert before the closing `}` of `registerOrgSkillRoutes`:

```typescript
app.get(
  "/api/orgs/:orgId/skill-packages/by-url",
  { preHandler: requireAuth() },
  async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { url } = req.query as { url?: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    if (!url) return reply.code(400).send({ error: "Missing url query param" });
    const rec = await findShareableSkillPackage(pool, orgId, null, url);
    if (!rec) return reply.code(404).send({ error: "Not found" });
    return rec;
  },
);
```

- [ ] **Step 4: Update DELETE handler with the same cleanup**

```typescript
async (req, reply) => {
  const { orgId, id } = req.params as { orgId: string; id: string };
  if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
  const rec = await getSkillPackage(pool, id, orgId, null);
  if (!rec) return reply.code(404).send({ error: "Not found" });
  const ok = await deleteSkillPackage(pool, id, orgId, null);
  if (!ok) return reply.code(404).send({ error: "Not found" });
  if (rec.localPath) {
    const remaining = await countRowsByLocalPath(pool, rec.localPath);
    if (remaining === 0) {
      try { rmSync(rec.localPath, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
  return { ok: true };
},
```

---

### Task 7: Package barrel — export new helpers

**Files:**
- Modify: `packages/skills/src/index.ts`

- [ ] **Step 1: Add `findShareableSkillPackage`, `updateSkillPackageStatusByPath`, `countRowsByLocalPath` to the barrel exports**

```typescript
export {
  DuplicateSkillPackageError,
  insertSkillPackage,
  listSkillPackages,
  getSkillPackage,
  updateSkillPackageStatus,
  updateSkillPackageStatusByPath,
  updateEnabledSkills,
  deleteSkillPackage,
  listSkillPackagesForResolver,
  listPromotableSkillPackages,
  promoteSkillPackage,
  findShareableSkillPackage,
  countRowsByLocalPath,
} from "./db.ts";
```

---

### Task 8: Web API client — by-url + shareCloneWith

**Files:**
- Modify: `packages/web/src/api/skills.ts`

- [ ] **Step 1: Extend `CreateSkillBody`**

```typescript
export interface CreateSkillBody {
  gitUrl: string;
  name: string;
  cliType?: SkillCliType;
  shareCloneWith?: string;
}
```

- [ ] **Step 2: Add `findByUrlMy` and `findByUrlOrg` to `skillsApi`**

Insert before `pullMy`:

```typescript
findByUrlMy: async (orgId: string, gitUrl: string): Promise<SkillPackage | null> => {
  const r = await fetch(
    `${userBase(orgId)}/by-url?url=${encodeURIComponent(gitUrl)}`,
    { credentials: "include" },
  );
  if (r.status === 404) return null;
  return jsonOrThrow<SkillPackage>(r);
},

findByUrlOrg: async (orgId: string, gitUrl: string): Promise<SkillPackage | null> => {
  const r = await fetch(
    `${orgBase(orgId)}/by-url?url=${encodeURIComponent(gitUrl)}`,
    { credentials: "include" },
  );
  if (r.status === 404) return null;
  return jsonOrThrow<SkillPackage>(r);
},
```

---

### Task 9: AddFromCatalogModal — name input + share/independent radio

**Files:**
- Modify: `packages/web/src/components/skills/AddFromCatalogModal.tsx`

- [ ] **Step 1: Replace the entire file with the new flow**

```tsx
import { useEffect, useState } from "react";
import { btnGhost, btnPrimary, card, codePill, inputCls } from "../../routes/admin-styles.ts";
import { skillsApi, type SkillCatalogEntry, type SkillPackage } from "../../api/skills.ts";

export interface AddFromCatalogModalProps {
  orgId: string;
  scope: "user" | "org";
  onClose: () => void;
  onCreated: () => void;
}

export function AddFromCatalogModal(props: AddFromCatalogModalProps) {
  const [catalog, setCatalog] = useState<SkillCatalogEntry[]>([]);
  const [chosen, setChosen] = useState<SkillCatalogEntry | null>(null);
  const [name, setName] = useState("");
  const [shareable, setShareable] = useState<SkillPackage | null>(null);
  const [mode, setMode] = useState<"share" | "independent">("share");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    skillsApi.catalog().then(setCatalog).catch(() => setCatalog([]));
  }, []);

  async function pick(entry: SkillCatalogEntry) {
    setChosen(entry);
    setName(entry.name);
    setError(null);
    const found =
      props.scope === "user"
        ? await skillsApi.findByUrlMy(props.orgId, entry.gitUrl)
        : await skillsApi.findByUrlOrg(props.orgId, entry.gitUrl);
    setShareable(found);
    setMode(found ? "share" : "independent");
  }

  async function submit() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        gitUrl: chosen.gitUrl,
        name,
        ...(shareable && mode === "share" ? { shareCloneWith: shareable.id } : {}),
      };
      if (props.scope === "user") await skillsApi.createMy(props.orgId, body);
      else await skillsApi.createOrg(props.orgId, body);
      props.onCreated();
      props.onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className={`${card} w-full max-w-xl max-h-[90vh] overflow-y-auto p-6`}>
        <h2 className="text-lg font-semibold text-slate-100 mb-4">
          {chosen ? `Configure ${chosen.name}` : "Add from catalog"}
        </h2>

        {!chosen ? (
          <div className="space-y-3">
            {catalog.map((entry) => (
              <button
                key={entry.gitUrl}
                type="button"
                onClick={() => pick(entry)}
                className={`${card} p-4 w-full text-left hover:border-indigo-500 transition`}
              >
                <div className="text-sm font-medium text-slate-100">{entry.name}</div>
                <div className="mt-1 text-xs text-slate-400">{entry.description}</div>
                <div className="mt-1 flex gap-1 items-center">
                  <span className={codePill}>{entry.author}</span>
                  <span className="text-slate-500 text-xs truncate">{entry.gitUrl}</span>
                </div>
              </button>
            ))}
            {catalog.length === 0 && (
              <div className="text-sm text-slate-500 text-center py-6">Catalog is empty.</div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Name (must be unique in this scope)</label>
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            {shareable && (
              <div className={`${card} p-3 space-y-2`}>
                <div className="text-xs text-slate-400">
                  This URL is already installed as <code className={codePill}>{shareable.name}</code>.
                </div>
                <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer">
                  <input
                    type="radio"
                    className="mt-1 accent-indigo-500"
                    checked={mode === "share"}
                    onChange={() => setMode("share")}
                  />
                  <div>
                    <div>Share clone with <code className={codePill}>{shareable.name}</code></div>
                    <div className="text-xs text-slate-500">No download. Pull-latest affects all instances sharing this clone.</div>
                  </div>
                </label>
                <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer">
                  <input
                    type="radio"
                    className="mt-1 accent-indigo-500"
                    checked={mode === "independent"}
                    onChange={() => setMode("independent")}
                  />
                  <div>
                    <div>Independent copy</div>
                    <div className="text-xs text-slate-500">Fresh clone in its own directory. Can drift to a different commit.</div>
                  </div>
                </label>
              </div>
            )}

            {error && <div className="text-sm text-rose-400">{error}</div>}

            <div className="flex justify-between pt-2">
              <button type="button" onClick={() => setChosen(null)} className={btnGhost}>← Back</button>
              <div className="flex gap-2">
                <button type="button" onClick={props.onClose} className={btnGhost}>Cancel</button>
                <button type="button" disabled={busy || !name.trim()} onClick={submit} className={btnPrimary}>
                  {busy ? "Adding…" : "Add"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

---

### Task 10: AddCustomModal — share/independent prompt when URL exists

**Files:**
- Modify: `packages/web/src/components/skills/AddCustomModal.tsx`

- [ ] **Step 1: Replace the entire file**

```tsx
import { useEffect, useState } from "react";
import { btnGhost, btnPrimary, card, codePill, inputCls } from "../../routes/admin-styles.ts";
import { skillsApi, type SkillPackage } from "../../api/skills.ts";

export interface AddCustomModalProps {
  orgId: string;
  scope: "user" | "org";
  onClose: () => void;
  onCreated: () => void;
}

export function AddCustomModal(props: AddCustomModalProps) {
  const [gitUrl, setGitUrl] = useState("");
  const [name, setName] = useState("");
  const [shareable, setShareable] = useState<SkillPackage | null>(null);
  const [mode, setMode] = useState<"share" | "independent">("independent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce findByUrl as the user types
  useEffect(() => {
    if (!gitUrl.trim()) {
      setShareable(null);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const found =
          props.scope === "user"
            ? await skillsApi.findByUrlMy(props.orgId, gitUrl.trim())
            : await skillsApi.findByUrlOrg(props.orgId, gitUrl.trim());
        setShareable(found);
        if (found) setMode("share");
      } catch {
        setShareable(null);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [gitUrl, props.orgId, props.scope]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        gitUrl,
        name,
        ...(shareable && mode === "share" ? { shareCloneWith: shareable.id } : {}),
      };
      if (props.scope === "user") await skillsApi.createMy(props.orgId, body);
      else await skillsApi.createOrg(props.orgId, body);
      props.onCreated();
      props.onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className={`${card} w-full max-w-md p-6`}>
        <h2 className="text-lg font-semibold text-slate-100 mb-4">Add custom skill package</h2>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Git URL</label>
            <input
              className={inputCls}
              placeholder="https://github.com/org/repo or git@..."
              required
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Display name (must be unique in this scope)</label>
            <input
              className={inputCls}
              placeholder="e.g. superpowers-tdd"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {shareable && (
            <div className={`${card} p-3 space-y-2`}>
              <div className="text-xs text-slate-400">
                This URL is already installed as <code className={codePill}>{shareable.name}</code>.
              </div>
              <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="radio"
                  className="mt-1 accent-indigo-500"
                  checked={mode === "share"}
                  onChange={() => setMode("share")}
                />
                <div>
                  <div>Share clone with <code className={codePill}>{shareable.name}</code></div>
                  <div className="text-xs text-slate-500">No download. Pull-latest affects all instances sharing this clone.</div>
                </div>
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="radio"
                  className="mt-1 accent-indigo-500"
                  checked={mode === "independent"}
                  onChange={() => setMode("independent")}
                />
                <div>
                  <div>Independent copy</div>
                  <div className="text-xs text-slate-500">Fresh clone in its own directory. Can drift to a different commit.</div>
                </div>
              </label>
            </div>
          )}

          {error && <div className="text-sm text-rose-400">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={props.onClose} className={btnGhost}>Cancel</button>
            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? "Adding…" : "Add package"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

---

### Task 11: List pages — "shared" badge

**Files:**
- Modify: `packages/web/src/routes/MySkillsPage.tsx`
- Modify: `packages/web/src/routes/AdminSkillsPage.tsx`

- [ ] **Step 1: Compute share counts in `MySkillsPage`**

Inside the component body of `MySkillsPage`, after `const [editing, setEditing]...`, add:

```typescript
const sharedPathCounts = rows.reduce<Record<string, number>>((acc, r) => {
  if (r.localPath) acc[r.localPath] = (acc[r.localPath] ?? 0) + 1;
  return acc;
}, {});
```

Then in the row's name cell, replace the existing block:

```tsx
<td className="px-6 py-3">
  <div>
    <code className={codePill}>{r.name}</code>
    <div className="mt-0.5 text-xs text-slate-500 truncate max-w-xs">{r.gitUrl}</div>
  </div>
</td>
```

with:

```tsx
<td className="px-6 py-3">
  <div>
    <div className="flex items-center gap-2">
      <code className={codePill}>{r.name}</code>
      {r.localPath && (sharedPathCounts[r.localPath] ?? 0) > 1 && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/40 text-indigo-300">
          shared ({sharedPathCounts[r.localPath]})
        </span>
      )}
    </div>
    <div className="mt-0.5 text-xs text-slate-500 truncate max-w-xs">{r.gitUrl}</div>
  </div>
</td>
```

- [ ] **Step 2: Same edit in `AdminSkillsPage`**

Apply the same `sharedPathCounts` computation (using `orgRows` instead of `rows`) and the same JSX change to the org-rows table cell.

---

### Task 12: Final typecheck

**Files:**
- (none — just run the command)

- [ ] **Step 1: Run `npm run typecheck`**

Run: `npm run typecheck`
Expected: zero new errors. The pre-existing `FlowEditorPage.tsx` issue should already be fixed; only new code we wrote should be checked.

If errors appear, fix them before declaring the task done.

---

## Self-Review

Spec coverage check:
- DB constraint swap → Task 1 ✓
- DuplicateSkillPackageError message → Task 2 ✓
- insertSkillPackage shareCloneWith → Task 2 ✓
- findShareableSkillPackage → Task 2 ✓
- updateSkillPackageStatusByPath → Task 2 ✓
- countRowsByLocalPath (delete cleanup) → Task 2 ✓
- Installer path-keyed update → Task 3 ✓
- SDK adapter dedupe → Task 4 ✓
- by-url + share-aware POST + delete cleanup (user) → Task 5 ✓
- Same for org → Task 6 ✓
- Barrel exports → Task 7 ✓
- Web API findByUrl + CreateSkillBody.shareCloneWith → Task 8 ✓
- Catalog modal → Task 9 ✓
- Custom modal → Task 10 ✓
- Shared badge → Task 11 ✓
- Final typecheck → Task 12 ✓

No placeholders, type names match across tasks. Plan is self-contained.
