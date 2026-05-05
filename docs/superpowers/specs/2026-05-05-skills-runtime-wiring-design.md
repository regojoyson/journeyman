# Skills Runtime Wiring — Design

**Goal:** Wire skill packages into actual flow runs. Per-phase selection (mirroring MCPs): each phase node holds `skillPackageIds: string[]`. The worker resolves those IDs at run time using the run's actor context and passes the resolved skills to phase handlers.

## Background

We have:
- DB-backed skill packages (`jm_skill_packages`) with management UI
- A resolver (`resolveSkillPackages`) that returns *all visible* packages for a user
- Phase handlers (`AnalyzeRepoPhaseHandler`, etc.) that accept `input.skills`
- Coding-CLI passes plugins + system prompt to the SDK

What's missing: nothing populates `input.skills`. The worker resolves MCPs from `mcpInstanceIds` but has no equivalent for skills. The flow editor has no skill picker. Phase definitions don't expose a skills tab.

## Architecture

Three changes mirroring the existing MCP wiring:

1. **Resolver gains a "by IDs" function** — `resolveSkillPackagesByIds(pool, ctx, packageIds, cliType)`. Same signature shape as `resolveMcpInstances`.
2. **Worker harness gains a `skillsResolver` hook** — like `mcpResolver`. Composition root injects a curried implementation. The harness pulls `skillPackageIds` from the phase config, resolves them, and passes `skills` to the phase handler.
3. **Flow editor gains a Skills tab** — clone of `McpToolsTab` writing `node.config.skillPackageIds`. Tab is shown when `definition.tabs.skills !== "hidden"`. Three AI phase definitions (analyze, plan, implement) flip to `tabs.skills: "shown"` and `supportsSkills: true`.

## Data flow at run time

```
phase node config:
  { skillPackageIds: ["abc-123", "def-456"] }

worker pre-resolution:
  packageIds = ["abc-123", "def-456"]
  ctx        = { userId: <run-actor>, orgId: <run-actor-org> }
  cliType    = "claude"  (hardcoded for now; future: derive from phase or flow)

  skillsResolver({ ctx, packageIds })
    → fetch packages by id, scoped to (orgId, userId or NULL)
    → for each: ensureCloned / refreshPackage, discoverSkills, filter enabledSkills
    → return ResolvedSkillPackage[]

phase handler (analyze):
  receives input.skills
  → coding.analyze({ ..., skills })
  → toSdkPluginConfigs + buildSkillSystemPrompt
  → SDK plugins + prompt suffix
```

## Database

New helper `listVisibleSkillPackages(pool, orgId, userId)` returning `VisibleSkillRow[]` — mirrors `listVisibleMcpInstances`. Used by the flow editor's Skills tab to populate the picker.

```typescript
export interface VisibleSkillRow {
  id: string;
  name: string;
  scope: "user" | "org";
  installStatus: SkillInstallStatus;
  enabledSkillCount: number;
}
```

Query returns user-scope + org-scope rows with `install_status = 'ready'` (skip pending/installing/error rows from the picker — the flow can't run successfully against them anyway).

## Resolver

New function `resolveSkillPackagesByIds(pool, ctx, packageIds, cliType)`:

- Fetches rows by id constrained to `(orgId, userId or NULL)`
- Throws `MissingSkillPackagesError(missing[])` if any id isn't found
- For each row: `ensureCloned` if `localPath` missing, then `discoverSkills` and apply `enabledSkills` filter
- Updates DB status if a clone happens (mirror existing `resolveSkillPackages`)
- Returns `ResolvedSkillPackage[]`

Existing `resolveSkillPackages` (no ids) stays — useful for "load all visible" debugging or future modes.

## Worker harness

`WorkerHarnessDeps` gains:

```typescript
skillsResolver: (input: {
  ctx: { userId: string; orgId: string };
  packageIds: string[];
}) => Promise<ResolvedSkillPackage[]>;
```

In the run loop, after MCP resolution:

```typescript
const skillPackageIds = Array.isArray((phaseInput as any).skillPackageIds)
  ? ((phaseInput as any).skillPackageIds.filter((x: any): x is string => typeof x === "string"))
  : [];
let skills: ResolvedSkillPackage[] = [];
if (skillPackageIds.length > 0 && userId && orgId) {
  try {
    skills = await this.deps.skillsResolver({ ctx: { userId, orgId }, packageIds: skillPackageIds });
  } catch (err) {
    // emit phase.failed with reason: "skills_resolution_failed"
  }
}
// merge into phaseInput before calling the handler
```

## CLI worker wire-up

```typescript
import { resolveSkillPackagesByIds } from "@journeyman/skills";

skillsResolver: ({ ctx, packageIds }) => {
  if (!pool) return Promise.resolve([]);
  return resolveSkillPackagesByIds(pool, ctx, packageIds, "claude");
},
```

## Flow editor

**`tabs-shell.tsx`:** add `"skills"` to `TabId`, `TabsVisibility`, `ALL_TABS` (label: "Skills"). Reorder so Skills sits next to MCP & Tools.

**`PropertiesPanel.tsx`:** branch `effectiveActive === "skills"` to render `<SkillsTab node={...} orgId={...} onChange={...} />`. Add `requiredEmpty.skills`. Wire `visibility.skills` from `definition.tabs.skills`.

**`SkillsTab.tsx`:** structural clone of `McpToolsTab`. Reads `node.config.skillPackageIds`. Fetches `/api/orgs/:orgId/skill-packages/visible`. Renders one row per package with checkbox + scope badge + skill count.

**Phase definitions** (`packages/phases/src/ai/{analyze-repo,plan-implementation,implement-changes}.tsx`): flip `tabs.skills: "shown"` and `supportsSkills: true`.

## API surface

- `GET /api/orgs/:orgId/skill-packages/visible` — returns `VisibleSkillRow[]` (user-scope + org-scope, ready-only). One endpoint serves both user and admin contexts (the mcp `visible` endpoint is also single-shaped).

## Web API client

```typescript
listVisible: (orgId: string) =>
  fetch(`/api/orgs/${orgId}/skill-packages/visible`, { credentials: "include" })
    .then(jsonOrThrow<VisibleSkillRow[]>),
```

## Edge cases

| Case | Behavior |
|---|---|
| Phase config has stale `skillPackageIds` (deleted package) | `MissingSkillPackagesError` → phase fails with `skills_resolution_failed`. Same as MCP behavior. |
| Package is in `error` or `installing` state | The `visible` endpoint omits non-ready rows, so picker won't list them. If somehow selected, resolver still loads but install state may cause downstream issues; the resolver's existing per-row try/catch silently skips broken installs. |
| User triggers run, package belongs to different user (user-scope) | DB query filters `(user_id = $userId OR user_id IS NULL)` — won't be found → MissingSkillPackagesError. |
| `skillPackageIds` empty | `skills = []`, phase runs with no plugins. |
| Run actor missing (`userId` or `orgId` null) | Skip resolution, run with no skills. Same fallback as MCP. |

## Out of scope

- Multi-CLI selection (always `cliType = "claude"` for now)
- Migration of existing flow definitions to set empty `skillPackageIds` — empty/missing field already means "no skills"
- Validation in flow-editor `validate-flow.ts` for stale skill ids (matches MCP — also not validated there today)
