# Clone-repos branch handling — design

**Date:** 2026-06-22
**Status:** Approved for planning (revised after end-to-end dry run)

## Problem

There are two independent "clone repos" paths, each with a branch gap:

1. **Workflow `clone-repos` step** — stores repos as one newline blob (`repos: string`) plus a single `branch` for all of them. There is no way to give each repo its own branch, `repos` is hard-required (so a fresh node errors before a connection is picked), and the local clone path forces `opts.branch ?? "main"` (breaks repos whose default is `master`/`develop`).
2. **Agent `repoSelections`** — the user picks repos but cannot set a checkout branch per repo. The type has `branch?`, but the UI never sets it, `compile.ts` reads only `repoSelections[0]?.branch` (first repo wins, rest lost), and the agent-run handler + sandbox provider apply one shared branch to all repos.

The low-level plumbing already supports per-repo branches: `RepoEntry` (`{ url, branch }`), `CloneReposOptions.repos: string | string[] | RepoEntry | RepoEntry[]`, the local provider's `normalizeEntries`, and the runner's `clone` op (`dispatch.ts` runs `git clone --branch <branch>`). The gaps are in the middle layers that throw the per-repo branch away — plus one shared helper (`parseRepoList`) that only understands strings.

## Decisions

- **No legacy back-compat.** The connection-based `{ url, branch }[]` shape is the only supported shape. Old `repos: string` + `branch` configs are not read at runtime and not migrated. Existing saved flows whose clone-repos nodes use the old shape must have those nodes re-picked. (Breaking change — see Migration impact.)
- **Branch semantics:** `branch` = check out an existing branch at clone time (`git clone --branch <branch>`). Blank = clone the repo's real default branch (omit `--branch`). A branch missing on the remote fails the clone (clear error); clone never creates branches. Creating a new working branch remains `start-feature-branch`.
- **Fix the sandbox private-repo auth gap** in the clone-repos step as part of this work (see A3).

## Shared runtime normalizer

`parseRepoList` (`packages/core/src/parse-repo-list.ts`) only handles `string | string[]` — fed an object array it returns `[]`, which silently zeros out cloning. Leave `parseRepoList` as-is and add a new shared helper in `@journeyman/core`:

```
toRepoEntries(repos: unknown): RepoEntry[]
// maps [{ url, branch? }] → [{ url, branch: branch ?? "" }], trims, drops empty url.
```

Both step handlers and the sandbox provider use it. `needsWorkspaceFor` counts `toRepoEntries(...).length`.

## Part A — Workflow `clone-repos` step (per-repo branch)

One git connection on the node, then a picker-only list of repos from that connection, each with its own checkout branch.

### A1. Config model
- `repos: string` (+ `branch`) → `repos: { url: string; branch?: string }[]`. The standalone `branch` is removed (blank per-repo = that repo's default).
- `packages/steps/src/git/clone-repos.tsx`
  - `CloneReposConfig` interface → `{ repos: { url: string; branch?: string }[] }` (drop `branch`).
  - `defaultConfig` → `{ repos: [] }`.
  - `summary()` — **currently `c.repos.split("\n")`, which throws on an array.** Rewrite to `c.repos?.length ? \`${c.repos.length} repo(s)\` : "(no repos)"`.
  - `configFields` — **remove the `branch` field**. Keep a `repos` entry so it stays a recognized config key (see A2 sweep note), but it is not generically rendered.
- `packages/steps/src/git/clone-repos.meta.ts`
  - `cloneReposConfigSchema` → `z.object({ repos: z.array(z.object({ url: z.string().min(1), branch: z.string().optional() })).optional() })`.
  - `cloneReposInputFields.repos.shape` → array of object `{ url, branch }`; remove `required: true`; remove the `branch` input field.

### A2. UI (flow editor)
- **Connection** — unchanged: the node's existing `ConnectionPicker`.
- **Repos** — upgrade [RepoPicker.tsx](../../../packages/flow-editor/src/properties-panel/RepoPicker.tsx) (the sole editor for repos; it is used nowhere else):
  - `value`/`onChange` change from `string[]` to `{ url, branch? }[]`.
  - `toggle`/selected-checks change from `value.includes(url)` to `value.some(r => r.url === url)`; add `{ url }` on select.
  - render selected repos as **vertical rows**, each with an inline branch `<input>` (controlled on `r.branch ?? ""`, writes `branch || undefined`) + remove.
- **ConfigTab wiring** (`ConfigTab.tsx`, the clone-repos block): replace the `.split("\n")`/`.join("\n")` adapters with object-array passthrough (`value={config.repos ?? []}`, `onChange={repos => …}`). Coerce a non-array `config.repos` to `[]` (stale old node shows no rows → user re-picks).
- **Generic-render + stale-key sweep (the two traps):**
  - `repos`/`branch` currently also render via `SchemaForm` from `configFields`, and `string-list`/`valueListMode` writes a **string**, not objects. RepoPicker must be the *only* repos editor — exclude `repos` from generic SchemaForm rendering for clone-repos, and remove `branch` from `configFields`.
  - The `ConfigTab` stale-key sweep deletes any `config` key not in `configFields` (the allow-set is derived from `definition.configFields` keys). So **keep `repos` in `configFields`** (protects it from the sweep) and exclude it from generic rendering by filtering the `fields` map passed to `SchemaForm` for clone-repos (a small `renderedConfigFields` derivation in `ConfigTab` — least invasive; no new `FieldMeta` flag plumbing). `branch` is dropped from `configFields`, so the sweep removing a stale `config.branch` is desired.
  - `SchemaForm` runs `safeParse` on the whole `config` regardless of which fields render, so excluding `repos` from rendering does **not** skip its validation. With `repos` as an optional array, an empty selection validates cleanly at edit time; the runtime handler enforces non-empty (fails at run time).

### A3. Handler
- `packages/orchestrator/src/workers/steps/clone-repos-step-handler.ts`
  - Replace `parseRepoList(input.repos)` + `input.branch` with `const entries = toRepoEntries(input.repos)`. Empty → unchanged non-retryable `InvalidInput` failure.
  - Pass `repos: entries` to `cloneRepos` (per-entry branch); drop the single `branch` arg.
  - Fix the per-repo log line to use `r.url` (today `ctx.log(\`Cloning ${r}\`)` would print `[object Object]`).
  - **Sandbox auth fix:** `ctx.connection.credential` is already the decrypted token (the worker's resolver unseals it before the handler runs), so build `SandboxGitAuth` **directly** — `{ provider: ctx.connection.provider, token: ctx.connection.credential, baseUrl: ctx.connection.baseUrl }` — and pass it to `new SandboxInstanceGitProvider(ctx.exec, auth)`. No pool/unseal needed (simpler than agent-run, which only does that because it resolves a separate `input.gitConnectionId` the harness hasn't pre-resolved). Today the sandbox branch passes no auth and the runner's `git clone` injects no token, so private repos cannot clone in a sandbox. The local (`this.deps.git(ctx.connection?.provider, ctx.env, ctx.connection)`) path is already authed — only the `ctx.exec` branch needs the fix.

### A4. Blank-branch fix (local providers)
- `packages/git-provider/src/providers/github/operations/clone-repos.ts`
  - `normalizeEntries`: `opts.branch ?? "main"` → `opts.branch ?? ""` (no forced `main`).
  - Clone args: `["clone", ...(entry.branch ? ["--branch", entry.branch, "--single-branch"] : []), cloneUrl, repoDir]` — blank branch clones the default. `--branch ""` would otherwise crash.
  - `CloneResult.branch` reports the effective branch (empty when defaulted).
- `packages/git-provider/src/providers/gitlab/operations/clone-repos.ts` — **same `?? "main"` fix** (its `--branch` is already conditional; just change the default).

## Part B — Agent per-repo branch

**Repos are optional for agents** (a pure-prompt agent with `repoSelections: []` is valid — no required-repo guard exists in the UI, API, or the `readiness` enable-gate, and none is added). `needsWorkspaceFor` must keep returning `false` for "no repos + no tools/skills/mcps", which `toRepoEntries([]).length === 0` preserves. This is the key asymmetry vs the clone-repos step: an empty agent runs prompt-only; an empty clone-repos step is a non-retryable failure.

### B1. UI — per-repo branch input (inline)
- `packages/web/src/components/agents/sections/WorkspaceSection.tsx`
  - Replace the chip-cloud render with **rows**: repo name + inline branch `<input>` (controlled on `r.branch ?? ""`) + remove.
  - Add `setRepoBranch(repo, value)` patching the matching `repoSelections` entry's `branch` (blank → `undefined`).
  - `AgentRepoSelection.branch` already exists — no type change. (Minor pre-existing: rows keyed by `r.repo` ignore `connectionId`; cross-connection same-name repos would collide — out of scope, but note.)

### B2. Compile
- `packages/agents/src/compile.ts`
  - `repos: agent.repoSelections.map(r => ({ url: r.repo, branch: r.branch ?? "" }))`.
  - **Remove `repoBranch`** (only writer here, only reader is the agent-run handler — both go together).

### B3. Agent-run handler
- `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts`
  - `needsWorkspaceFor` and `run`: replace `parseRepoList(input.repos)` with `toRepoEntries(input.repos)` (else no workspace is provisioned and cloning is skipped).
  - Pass `repos: entries` to `cloneRepos`; drop the `input.repoBranch` read; fix the `ctx.log(\`Cloning ${r}\`)` loop to use `r.url`.
  - `auth`/`gitConnectionId` resolution is orthogonal to branch — unchanged.

### B4. Sandbox provider — honor each repo's branch (shared by both paths)
- `packages/orchestrator/src/sandbox/sandbox-instance-git-provider.ts`
  - Replace `toUrls(opts.repos)` (which discards per-entry branch and applies one `opts.branch`) with `toRepoEntries(opts.repos)`.
  - In the loop, pass each entry's own branch into the `clone` op stdin: `...(entry.branch ? { branch: entry.branch } : {})` (blank → omit → default branch). `buildAuthCloneUrl` is branch-agnostic (unchanged).
  - `CloneResult.branch` reports the per-entry branch.

The runner's `clone` op (`dispatch.ts`) already runs `git clone --branch <branch>` and clones the default when branch is omitted — no change.

## Data flow (after)

```
Agent UI (per-repo branch)                Clone-repos step UI (per-repo branch)
  → compile.ts ({url,branch}[])             → step config { repos: {url,branch}[] }
        \                                   /
         → step handler: toRepoEntries() → cloneRepos(RepoEntry[])
           → SandboxInstanceGitProvider (per-entry branch → clone op stdin)
             → runner dispatch "clone" (git clone --branch <branch>)   [already supported]
           → local GitHub/GitLab provider (normalizeEntries per-entry branch)
```

Blank branch at any layer ⇒ clone the repo's default branch.

## Execution backends (local / Docker / Windows)

Clone routing branches only on whether `ctx.exec` is set (worker-harness sets it for every non-`local` backend), never on backend type — so per-repo branch is uniform:
- **Local workspace** (`type: "local"`, `ctx.exec` undefined) → git-provider `execFile git` into an absolute `ctx.workspaceDir` (never `/workspace`). OS-agnostic.
- **Docker** (`ctx.exec` set) → `SandboxInstanceGitProvider` → `docker exec journeyman-runner` → `dispatch.ts` clone op.
- **Windows** (`ctx.exec` set) → same `SandboxInstanceGitProvider` → gRPC → the **same** `journeyman-runner` → same `dispatch.ts`.

The per-repo `branch` rides in the `clone` op `stdin` (`unknown`, passed through verbatim by each backend's `exec`), so B4's single change is honored everywhere. Auth URL builders are pure string-building, OS-agnostic and branch-independent.

**Pre-existing Windows caveat (not introduced here, do not fix in this change):** `dispatch.ts` `gitClone` hardcodes `cwd: "/workspace"` and ignores the per-op `cwd` the Windows env supplies (`C:\jm-runs\<runId>`) — this is windows-sandbox design Finding 3b, and the Windows agent package does not exist yet. This change does not touch `cwd`/folder handling, so it adds no new Windows risk, but Windows clone is not end-to-end functional until that agent lands.

- **Clone-repos step:** existing saved flows with `repos: "a\nb"` + `branch` are not read at runtime (cloning fails) and show no rows / a validation error in the editor until the node's repos are re-picked. Accepted per the no-legacy decision.
- **Agents:** unaffected at the data layer — agents recompile config from `repoSelections` on every run, so there is no persisted legacy agent-run config. Old agents simply gain the per-repo branch capability.

## Edge cases

- **Blank branch** → repo default branch (local and sandbox).
- **Branch missing on remote** → clone fails with the git error surfaced (no auto-create).
- **Mixed branches across repos** (agent or step) → each repo clones its own branch.
- **Empty repo list** → agent: valid, runs prompt-only (no workspace unless tools/skills/mcps require it); clone-repos step: non-retryable failure.
- **Private repo in a sandbox (clone-repos step)** → now authed via the A3 fix.
- **Bound `repos` input** → shape tightens to `array<object{url,branch}>`; a flow binding a plain string-array into `repos` will newly fail publish validation (acceptable tightening).

## Testing

- New `toRepoEntries` unit test: `{url,branch}[]` → `RepoEntry[]`; blank/omitted branch → `""`; non-array/garbage → `[]`.
- `compile.test.ts`: **update** — `config.repos` becomes `[{url, branch}]`; assert per-repo branches survive; drop `repoBranch` assertions.
- `sandbox-instance-git-provider` test: `RepoEntry[]` with differing branches issues one `clone` op per repo, each with its own `branch`; blank omits `branch`.
- `clone-repos.ts` (github) + gitlab test: blank branch omits `--branch` (clones default); set branch passes `--branch <b>`.
- `clone-repos-step-handler` test: object-array config produces the right `RepoEntry[]`; empty → non-retryable failure; sandbox path builds auth from `ctx.connection`.
- `agent-run-step-handler` test: object-array `input.repos` provisions a workspace and clones with per-repo branch.

## Out of scope

- Creating/switching to a new branch at clone time (`checkout -b`) — remains `start-feature-branch`.
- Per-repo connection selection (one connection per agent / per clone-repos step).
- Manual free-text repo entry on the clone-repos step (picker-only).
- The pre-existing cross-connection same-name repo key collision in the agent UI.
- Extracting a shared repo-rows component across `web` and `flow-editor` (different packages/data models) — optional future cleanup.
