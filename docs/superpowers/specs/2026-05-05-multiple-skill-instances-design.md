# Multiple Skill Package Instances — Design

**Goal:** Allow the same git URL to be added multiple times within a scope (user or org), each with a different name and enabled-skills subset. Clone on disk can be either **shared** (one clone, many configs) or **independent** (each instance gets its own clone), chosen at create time.

## Background

Today `jm_skill_packages` enforces uniqueness on `(scope, user_id, org_id, git_url)`. Adding `https://github.com/obra/superpowers` twice fails with "Skill package already added". The user wants two configurations of the same package — e.g. `superpowers-tdd` with skills `[test-driven-development, requesting-code-review]` and `superpowers-debug` with skills `[systematic-debugging]`.

## Architecture

Uniqueness shifts from URL to name. Each row carries its own `local_path`. When a row is created against an already-installed URL, the user picks:

- **Share**: copy the existing row's `local_path` — no clone runs, both rows share one directory on disk.
- **Independent**: leave `local_path` null, kick off `runInstall` — new directory at `<SKILLS_CACHE_DIR>/<name>-<urlhash>/`.

Pull-latest operates on the row's `local_path`. With shared clones, **all rows pointing to that path** get their status/commit_sha updated. Delete drops the DB row; if no other row references the path, the directory is removed.

## Database

Migration `011_skill_packages_name_unique.sql`:

```sql
ALTER TABLE jm_skill_packages
  DROP CONSTRAINT jm_skill_packages_scope_unique;

ALTER TABLE jm_skill_packages
  ADD CONSTRAINT jm_skill_packages_name_unique
  UNIQUE NULLS NOT DISTINCT (scope, user_id, org_id, name);
```

No column changes. The existing `local_path` column carries shared paths transparently.

## Backend changes (`@journeyman/skills`)

**`db.ts`:**
- `DuplicateSkillPackageError` — message becomes `"Skill package name already in use: <name>"` and constructor takes `name` instead of `gitUrl`.
- `insertSkillPackage` accepts optional `shareCloneWith?: string` (existing package id in same scope). When provided, the SQL `INSERT` includes `local_path`, `commit_sha`, and `install_status = 'ready'` copied from the source row in a single `INSERT ... SELECT` so we don't re-clone.
- New helper `findShareableSkillPackage(pool, orgId, userId, scope, gitUrl)` — returns the first `ready` row with that URL in this scope, or null. Used by the API to inform the UI that a clone exists.
- New helper `updateSkillPackageStatusByPath(pool, localPath, patch)` — updates every row whose `local_path = $1`. Called by `runInstall` after pull-latest so all rows sharing a clone reflect the new commit.

**`installer.ts`:**
- `runInstall` switches its DB write from `updateSkillPackageStatus(id, ...)` to `updateSkillPackageStatusByPath(localPath, ...)` once a path is known. The initial "installing" status still writes by `id` (no path yet).

**`sdk-adapter.ts`:**
- `toSdkPluginConfigs` dedupes by `localPath` so the SDK doesn't load the same plugin directory twice when two rows share it.
- `buildSkillSystemPrompt` is unchanged — it already emits one block per row, named by row, which is the desired behavior.

**`resolver.ts`:**
- No change. Each row is resolved independently and lands as its own `ResolvedSkillPackage` entry. Dedup happens later in `toSdkPluginConfigs`.

## API

**New endpoints:**
- `GET /api/orgs/:orgId/users/me/skill-packages/by-url?url=<gitUrl>` — returns the shareable row for a URL in user scope, or 404
- `GET /api/orgs/:orgId/skill-packages/by-url?url=<gitUrl>` — same for org scope (admin)

**Updated endpoints:**
- `POST .../skill-packages` — accepts optional `shareCloneWith` in the body
- `DELETE .../skill-packages/:id` — after row delete, count remaining rows with same `local_path`; if zero, `rmSync` the directory

## UI

**`AddFromCatalogModal.tsx`:**
- After picking an entry, show a name input pre-filled with `entry.name`
- Call `findByUrl(gitUrl)` on entry pick. If a shareable row is returned, show a radio:
  - "Share clone with `<existing-name>`" (default — fast, no download)
  - "Independent copy (separate clone, can drift)"
- POST includes `shareCloneWith` when "Share" is chosen

**`AddCustomModal.tsx`:**
- Same logic — debounce a `findByUrl` call as the user types the URL; show the share/independent radio when a match exists

**List pages (`MySkillsPage`, `AdminSkillsPage`):**
- A small badge `shared (N)` next to the package name when the row's `local_path` is referenced by other rows in the same list. Pure presentation — derived client-side from the loaded list.

## Web API client (`packages/web/src/api/skills.ts`)

- `findByUrlMy(orgId, gitUrl)` and `findByUrlOrg(orgId, gitUrl)` returning `SkillPackage | null`
- `CreateSkillBody` gains optional `shareCloneWith?: string`

## Edge cases

| Case | Behavior |
|---|---|
| Share-clone source row is `error` or `installing` | API rejects share with 409. UI hides the share option until source is `ready`. |
| Share-clone source row gets deleted later | New row keeps the `local_path`; the directory persists because the new row is still a reference. |
| Pull on an independent row | Affects only that row's `local_path` (no other rows share it, so `updateSkillPackageStatusByPath` only matches one). |
| Pull on a shared row | Updates all sharing rows in DB; on disk, one fetch+reset on the shared dir. |
| Delete one of two sharing rows | Other row still works; directory persists. |
| Delete the last row pointing at a path | Directory is removed from disk. |
| Two rows share path; SDK adapter receives both | Plugin emitted once; system prompt emits two named blocks (one per row). Agent uses union of enabled skills. |

## Out of scope

- Refcount column or background GC of orphaned skill directories. The inline cleanup in delete is enough for now.
- "Convert independent to shared" / "fork shared into independent" operations. Re-create the row to switch modes.
- Cross-scope sharing (user-scope row sharing with org-scope clone). Sharing is within a single scope only.
