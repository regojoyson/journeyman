# Make the Condition Evaluator `$.`-Path Aware — Design

**Date:** 2026-05-29

## Problem

A webhook trigger's "Accept if (optional)" condition silently fails when the
field path uses the project's standard `$.`-prefix.

- The field autocomplete suggests `$.`-prefixed paths (e.g. `$.issue.state`),
  produced by `pathsFromSchema` (`useWebhooksForPicker.ts`, prefix `"$"`).
- The builder emits the field verbatim as `{ var: rule.field }`
  (`AcceptIfBuilder.logic.ts:66`) — no normalization.
- The evaluator is `json-logic-js`, whose `var` operator splits the path on `.`
  and looks up literal keys. `$.issue.state` becomes keys `["$", "issue",
  "state"]` → `data["$"]` is missing → resolves to `null` → the condition
  evaluates wrong.

Verified empirically against the real `issues` sample payload:

```
var "issue.state"    → "open"   (works)
var "$.issue.state"  → null     (broken)
```

So Accept-if only works when a user hand-types a path **without** `$.`; picking
a suggested (`$.`-prefixed) path produces a silently-broken condition. Input
*mapping* is unaffected because it uses a different path engine (`readPath`)
that understands `$.` and `[n]` — that divergence is the root inconsistency.

## Decision

`$.` is the **single, canonical path standard** everywhere (suggestions, input
mapping, and now condition evaluation). Teach the condition evaluator to resolve
`var` paths the same way `readPath` does, so `$.`-prefixed and `[n]` array paths
resolve correctly. Update the only user-facing example that still omits `$.` (the
AcceptIf JSON-mode placeholder) so users only ever see the `$.` form.

The evaluator still *tolerates* a missing `$.` internally (a plain `issue.state`
normalizes to itself) purely as a backward-compat safety net for already-saved or
hand-typed conditions — it is not a second advertised standard. Every suggestion
and example presents `$.`.

## Scope

`conditions.evaluate` is used only for acceptIf, at two call sites
(`webhook-trigger-fire.ts:64`, `match-human-tasks.ts:55`). The change lives in
the single shared evaluator, so both are fixed at once. Clean (non-`$.`) paths
keep working; only `$.`-prefixed/`[n]` paths change behaviour (from null to
resolved) — strictly an improvement, fully backward compatible.

## Design

In `packages/orchestrator/src/conditions/jsonlogic-evaluator.ts`, normalize every
`var` path in the expression before evaluating.

**`normalizeVarPath(path: string): string`** — mirrors `readPath`'s segment
rules, but emits a `json-logic-js`-friendly dot path:

- trim
- strip a leading `$.`; a lone `$` becomes `""` (whole-document `var`)
- convert `[n]` occurrences to `.n` (json-logic `var` indexes arrays via the
  numeric-string key, e.g. `data["0"]`)

Examples: `"$.issue.state"` → `"issue.state"`; `"$.labels[0].name"` →
`"labels.0.name"`; `"issue.state"` → `"issue.state"` (unchanged); `"$"` → `""`.

**`normalizeVarsInExpr(expr: unknown): unknown`** — recursively walk the JSONLogic
tree; for any object of the exact shape `{ var: <string> }`, return
`{ var: normalizeVarPath(<string>) }`; recurse into arrays and object values;
return primitives unchanged. Pure; does not mutate the input.

**`evaluate`** becomes:

```ts
evaluate(expression: unknown, data: Record<string, unknown>): boolean {
  if (expression == null) return false;
  return Boolean(jsonLogic.apply(normalizeVarsInExpr(expression) as any, data));
}
```

No global `json-logic-js` mutation; normalization is local and pure.

## Edge Cases

- **Lone `$`** → `""` → `var` returns the whole payload (json-logic semantics for
  empty `var`). Acceptable; matches `readPath`'s `"$"` → whole object.
- **`var` value not a string** (malformed) → left unchanged (only string paths are
  normalized).
- **No `var` anywhere** (e.g. literal `true`) → returned unchanged.
- **Nested `and`/`or`/`!`** → recursion rewrites every nested `var`.
- **Array index** `[n]` → `.n`; json-logic `var` walks `data[...]["n"]`, which
  works for JS arrays.
- **Already-clean paths** (`issue.state`) → unchanged → still work.

## Testing

Unit test `jsonlogic-evaluator` against the real `issues` sample payload
(`{ action, issue: { number, title, state, user: { login } }, repository, sender,
labels?: [{ name }] }`):

- `{"==":[{"var":"$.issue.state"},"open"]}` → **true**
- `{"==":[{"var":"issue.state"},"open"]}` → **true** (no regression)
- `{"==":[{"var":"$.issue.user.login"},"alice"]}` → **true**
- `{"==":[{"var":"$.labels[0].name"},"bug"]}` → **true** (array indexing)
- `{"!=":[{"var":"$.issue.state"},"closed"]}` → **true**
- A `var` against a missing path → comparison is false (not a throw).

Plus a direct `normalizeVarPath` unit test for the four example transforms above.

## Affected Files

| Responsibility | Path |
|---|---|
| `normalizeVarPath` + `normalizeVarsInExpr` + use in `evaluate` | `packages/orchestrator/src/conditions/jsonlogic-evaluator.ts` |
| Evaluator unit test | `packages/orchestrator/src/conditions/jsonlogic-evaluator.test.ts` |
| Standardize JSON-mode placeholder + field hint on `$.` | `packages/flow-editor/src/properties-panel/AcceptIfBuilder.tsx` |

## Non-Goals

- Changing the builder, path suggestions, or the `$.` standard.
- Touching if-else gate evaluation (separate path; not via `conditions.evaluate`).
- A shared cross-package path engine refactor (readPath stays in webhooks; the
  evaluator replicates only the small normalization it needs).

## Constraints

- No commits during implementation.
- Run `npm run typecheck` as the final gate.
