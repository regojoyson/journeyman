# Skill Packages

## Overview

Skills are reusable AI behaviour bundles packaged as git repositories. Each skill package contains skill definitions — prompts, tool configs, and examples — that AI phases can load at runtime. Attaching a skill package to a flow node makes those skills available to the AI agent running that phase, without duplicating prompt logic across flows.

## Scopes

| Scope | Who can see it | Managed at |
|---|---|---|
| **User-scoped** | Your flows only (personal) | `/me/skills` |
| **Org-scoped** | All org members | `/admin/skills` |

Org admins can promote a user-scoped skill package to org scope, making it available to all members without requiring each user to install it individually.

## Installing Skill Packages

### Via UI

1. Navigate to `/me/skills` (personal) or `/admin/skills` (org-wide).
2. Click **Add package** and paste the git repo URL.
3. The system clones the repo (`clonePackage`), runs `discoverSkills` to enumerate skill definitions, and registers them.

To pick up changes after the source repo is updated, trigger a refresh. `refreshPackage` pulls the latest commits from the remote repo and re-runs discovery.

### API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/me/skills` | List your skill packages |
| `POST` | `/me/skills` | Install a user-scoped skill package (provide git URL) |
| `PUT` | `/me/skills/:id` | Update / refresh a user-scoped package |
| `DELETE` | `/me/skills/:id` | Remove a user-scoped package |
| `POST` | `/me/skills/:id/promote` | Promote to org scope |
| `GET` | `/orgs/:orgId/skills` | List org skill packages |
| `POST` | `/orgs/:orgId/skills` | Install an org-scoped skill package |
| `PUT` | `/orgs/:orgId/skills/:id` | Update / refresh an org package |
| `DELETE` | `/orgs/:orgId/skills/:id` | Remove an org package |
| `GET` | `/skills/visible` | List all skill packages visible to the current user (user + org combined) |
| `GET` | `/skills/catalog` | Browse the built-in skill package catalog |

A built-in catalog of curated skill packages is bundled with the package and browsable at `/skills/catalog`.

## Using Skills in Flows

1. Open the flow editor and select a phase node on the canvas.
2. In the properties panel, open the **Skills** tab.
3. Check the skill packages to attach. The visible list is fetched from `/api/orgs/{orgId}/skill-packages/visible`, which merges user-scoped and org-scoped packages.
4. Save the node. The selected package IDs are stored as `skillPackageIds` in the node config.

At runtime the worker resolves those IDs to full skill definitions before spawning the AI agent.

## Runtime Resolution

`resolveSkillPackages(ids, userId, orgId)` and `resolveSkillPackagesByIds` in `@journeyman/skills`:

1. Accept an array of skill package IDs plus the current user and org identifiers.
2. Look up each ID across user-scoped and org-scoped packages.
3. Return resolved skill definitions ready for the AI agent.

The `@journeyman/skills/sdk-adapter` subpath export provides helpers for passing those definitions into the Claude Agent SDK `query()` call, following the same pattern as `@journeyman/mcp/sdk-adapter`.

## Package Reference

| Export | Source file | Description |
|---|---|---|
| `resolveSkillPackages` | `resolver.ts` | Resolve package IDs to full skill definitions (user + org lookup) |
| `resolveSkillPackagesByIds` | `resolver.ts` | Alternate resolver accepting a plain ID array |
| `clonePackage` | `installer.ts` | Clone a git repo and store the package locally |
| `refreshPackage` | `installer.ts` | Pull latest changes from a package's remote repo |
| `discoverSkills` | `installer.ts` | Walk a cloned repo and enumerate skill definitions |
| `userSkillsRoutes` | `routes/user-skills.ts` | Express router for `/me/skills` CRUD |
| `orgSkillsRoutes` | `routes/org-skills.ts` | Express router for `/orgs/:orgId/skills` CRUD |
| `catalogRoutes` | `routes/catalog.ts` | Router for `GET /skills/catalog` |
| SDK helpers | `sdk-adapter.ts` (subpath) | Pass resolved skill configs into Claude Agent SDK `query()` |
| DB helpers | `db.ts` | Low-level database access for skill package records |
| Catalog data | `catalog.ts` | Static catalog of curated skill packages |
