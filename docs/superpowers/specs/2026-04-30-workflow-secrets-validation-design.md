# Workflow Secrets Validation Design

**Status:** Draft — design approved in brainstorming, awaiting spec review.
**Depends on:** [Secrets & User Management](2026-04-28-secrets-and-user-management-design.md) (already implemented: `packages/secrets`, three-tier resolver, `requiredSecrets` field on flow steps).

---

## 1. Goal

Close the last-mile gaps so that a user authoring a workflow can declare which secrets each step needs, see only the names they're allowed to use, and get caught early — at save time — if they reference a secret they can't access. At run time, missing secrets already fail fast via `MissingSecretsError` (working today).

The full secrets stack (DB, encryption, scopes, resolver) is already shipped. This spec only fills the validation and editor gaps.

## 2. Non-goals

- No changes to secret storage, encryption, or the three-tier resolver.
- No new scope semantics — user > org > global precedence stays as-is.
- No bulk import, copy-between-scopes, or secret-name aliasing.
- No retroactive migration of existing flows that have empty `requiredSecrets`.

## 3. Current state — what's built and what's missing

**Built:**
- `packages/secrets` — DB, crypto, three-tier `resolveSecrets()`, HTTP routes for org/user/global/_resolve.
- `FlowStepDefinition.requiredSecrets: string[]` — declared on every step ([flow.types.ts:58](../../packages/core/src/types/flow.types.ts:58)).
- `conductor-converter` — emits `env:NAME` credential refs from `requiredSecrets` ([conductor-converter.ts:160](../../packages/orchestrator/src/flow-json/conductor-converter.ts:160)).
- `worker-harness` — catches `MissingSecretsError` and fails the run with `reason: "missing_secrets"` ([worker-harness.ts:90](../../packages/orchestrator/src/workers/worker-harness.ts:90)).
- `SecretsCredentialStore` — wired in api-server when DB is configured ([composition.ts:118](../../packages/api-server/src/composition.ts:118)).
- SPA pages: `AdminSecretsPage`, `MySecretsPage`.

**Missing — this spec:**
1. No UI in the flow editor for declaring `requiredSecrets` per step.
2. No API to list "secret names this caller can see."
3. No save-time validation that referenced names are accessible to the saving user.
4. `cli-worker` still uses the old `EnvCredentialStore` (global/process.env only) — user/org rows in the DB are invisible to it.

## 4. Architecture

Four small additions, no new packages.

```
+----------------------+   GET /api/orgs/:orgId/secrets/_visible-names
| flow-editor (SPA)    | -------------------------------------------+
|  Properties Panel    |                                            |
|  └─ Secrets section  | <----- list: ["GITHUB_TOKEN", ...]         |
|     (multi-select)   |                                            v
+----------+-----------+                              +-------------+----------+
           |                                          | api-server             |
           | PATCH /api/flows/:id { requiredSecrets } |  + visible-names route |
           +----------------------------------------> |  + save-time validator |
                                                      +-----------+------------+
                                                                  |
                                                                  v (re-uses)
                                          +-----------------------+----------+
                                          | @journeyman/secrets               |
                                          |  listVisibleNames(ctx) -> Set     |
                                          +-----------------------------------+
```

## 5. Visible-names API

### 5.1 New route

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/orgs/:orgId/secrets/_visible-names` | `{ names: string[] }` (sorted, deduped) |

- Auth: `requireAuth`. Same-org check (`ctx.org.id === params.orgId`) → 403 on mismatch.
- Returns the **union** of names visible to the caller:
  - Their user-scope secrets (`org_id = ctx.org.id AND user_id = ctx.user.id`)
  - Their org's org-scope secrets (`org_id = ctx.org.id AND user_id IS NULL`)
  - All `JM_GLOBAL_*` global names
- **Names only.** No values, no scope tags, no descriptions. The UI doesn't need them and surfacing scope leaks org-secret existence to members who shouldn't act on them.
- Members and admins both have access — both can author flows; both need the same picker.

### 5.2 In-process helper

Add to `@journeyman/secrets`:

```ts
// packages/secrets/src/visibility.ts
export async function listVisibleNames(
  pool: Pool, ctx: RunContext,
): Promise<string[]>;
```

Single SQL round trip:

```sql
SELECT DISTINCT name FROM jm_secrets
 WHERE org_id = $1 AND (user_id = $2 OR user_id IS NULL)
```

Union with `listGlobalSecretNames()` (already exists in [global.ts:18](../../packages/secrets/src/global.ts:18)). Sort, dedupe, return.

The HTTP route is a thin wrapper around this. Save-time validation calls the helper directly.

## 6. Save-time validation (non-blocking warnings)

### 6.1 Principle: never block the save

The save **always succeeds** when the body is well-formed. Inaccessible-secret references return as **warnings** in the response, not as errors. Rationale: a user mid-way through building a large flow may legitimately reference a secret they haven't created yet, or one an admin has yet to provision. Blocking the save would force them to abandon work, go create the secret, and rebuild. Run-time fail-fast (`MissingSecretsError`) is the real safety net.

### 6.2 Flow validation rule

When `PATCH /api/flows/:id` (or create) is called with a `definition` containing nodes with `requiredSecrets`:

1. Compute the union of all `requiredSecrets` across all nodes (the flow's "needed set").
2. Call `listVisibleNames(pool, ctx)` for the saving caller.
3. Compute `inaccessible = needed - visible`.
4. **Save the flow regardless.** Attach `warnings` to the response if `inaccessible` is non-empty.

### 6.3 Response shape

Successful save (no warnings):

```json
{ "id": "...", "name": "...", /* ...flow fields... */ }
```

Successful save with warnings:

```json
{
  "id": "...",
  "name": "...",
  /* ...flow fields... */,
  "warnings": [
    {
      "code": "inaccessible_secrets",
      "message": "Flow references secrets you cannot currently access. Runs will fail until they are created.",
      "names": ["SECRET_FROM_OTHER_ORG", "PENDING_KEY"]
    }
  ]
}
```

HTTP status: `200` (PATCH) / `201` (create) — same as a clean save. The presence of a `warnings` array is the signal.

### 6.4 Where the check lives

In the flow PATCH/POST handler, after Zod parses the body but before the response is returned. Reuses the existing `RunContext` derivation in `composition.ts`. No new auth wiring.

### 6.5 Edge cases

- **Empty `requiredSecrets`** on every step → no check needed, no warnings.
- **Caller is not a member of an org** → save proceeds; all referenced names become inaccessible warnings (since visible set is just global).
- **Save validation passes (no warnings), then secret is deleted** → flow keeps the reference; run-time `MissingSecretsError` catches it. We do not eagerly invalidate flows when secrets are deleted.
- **User dismisses warnings, runs anyway** → run fails fast with `missing_secrets` reason. Existing behavior, no change.

## 7. Flow editor UI

### 7.1 Where it goes

In the existing properties panel for a phase node, add a new collapsible section: **"Required secrets"** below the existing Inputs/Config tabs.

### 7.2 What it looks like

- Multi-select dropdown.
- Options come from `GET /api/orgs/:orgId/secrets/_visible-names`, fetched once when the editor opens (cached for the editor session).
- Selected names render as chips.
- Removing a chip removes it from `node.requiredSecrets`.
- If the user has no visible names at all, show: "No secrets available. Add one in [My Secrets](/me/secrets) or ask an admin."

### 7.3 Free-text allowed (combobox)

The dropdown is a **combobox**: pick from the visible list, *or* type a name that doesn't exist yet. Both paths add to `node.requiredSecrets`. This lets a user reference a secret they haven't created yet and finish building the flow.

**Visual state per chip:**

- **Visible (resolves now)** — neutral chip.
- **Inaccessible (typed or stale)** — chip rendered with a warning style (e.g. amber border + ⚠ icon) and a tooltip: "Not accessible to you. Create it in My Secrets or ask an admin."

The warning state is computed from the same visible-names list used to populate the dropdown. No extra API call.

### 7.4 Refresh

After creating a secret in another tab, returning to the editor should pick it up. Two options:
- **Lazy:** add a small "Refresh" button next to the dropdown.
- **Eager:** re-fetch on dropdown open.

Pick **eager** — re-fetch on dropdown open. One request per click is cheap and avoids stale-list confusion.

## 8. CLI worker decision

[cli-worker.ts:100](../../packages/orchestrator/src/cli-worker.ts:100) uses `EnvCredentialStore`, which reads only `process.env` (no DB user/org rows).

**Decision: keep CLI worker on `EnvCredentialStore` for now, document the limitation.**

Reasoning:
- CLI worker is for local dev / test runs, not user-facing.
- Wiring it to `SecretsCredentialStore` requires it to know the running user's identity, which the CLI today doesn't model.
- Global tier (`JM_GLOBAL_*`) already works via `process.env`, which is what dev workflows use.

Document in `docs/setup.md` (and any cli-worker README): "The CLI worker resolves only global-tier (`JM_GLOBAL_*`) and process.env secrets. Run via api-server for user/org-scope resolution."

If/when the CLI worker grows a `--user` flag, revisit.

## 9. Failure modes — quick reference

| Situation | Behavior |
|---|---|
| Save flow with secret name not visible to caller | Save succeeds; response includes `warnings: [{ code: "inaccessible_secrets", names: [...] }]` |
| Save flow with empty `requiredSecrets` everywhere | Saves fine, no warnings |
| Caller is in wrong org for `:orgId` | `403` (existing same-org check) |
| Run a flow whose secret was deleted post-save | `MissingSecretsError` at run start (existing path) |
| Editor opens with no DB pool configured | Visible-names endpoint returns global names only; user/org chips unavailable |
| CLI-worker run references user/org secret | `MissingSecretsError`; user must run via api-server |

## 10. Rollout

1. Add `listVisibleNames(pool, ctx)` in `@journeyman/secrets`. Unit tests against a test DB.
2. Add `GET /api/orgs/:orgId/secrets/_visible-names` route. Integration test.
3. Add save-time validator in flow PATCH/POST handler. Integration test covering reject + accept paths.
4. Add the "Required secrets" section to the flow editor properties panel. Component test.
5. Update `docs/setup.md` with the CLI worker limitation note.

Implementation plan (file-by-file, task ordering) is produced separately by the writing-plans skill.

## 11. Open questions

None at spec time. The visible-names endpoint shape, the save-time error shape, and the editor placement are all small and reversible.

---
