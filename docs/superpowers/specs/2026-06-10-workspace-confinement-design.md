# Workspace Confinement for Coding Steps

**Date:** 2026-06-10
**Status:** Approved (design)
**Goal:** Keep AI coding steps operating *only* within their sandbox workspace directory.

## Problem

When a custom-AI step runs (e.g. "search this Java code"), the coding agent
wanders **outside** the workspace directory — into sibling projects (local mode)
or unrelated parts of the container filesystem (Docker). This pollutes analysis
and produces wrong-scope results.

The workspace path already flows to providers as `cwd` / `workspaceDir`
(`/workspace` in Docker, `<baseDir>/<runId>` locally), but `cwd` is only a
*starting* directory, not a fence:

- The Claude SDK **Bash** tool can `cd /`; file tools accept absolute paths.
- The AI SDK file tools (`tools/fs.ts`) resolve relative paths against `cwd` but
  **accept absolute paths unchecked** (`/etc/passwd` reads fine).
- `scan-repos` and `checkout-repo` (Claude + OpenCode) pass **no `cwd` at all** —
  they default to wherever the runner process started.
- There is no path validation / allowlist anywhere in `agent-runtime`.

## Goal & Non-Goals

**Goal (correctness / focus):** the agent should *stay* in the workspace so work
is scoped to the checked-out repos. File and search tools must **refuse**
out-of-workspace paths; the system prompt should set the expectation so the
model doesn't waste attempts wandering.

**Non-goal (security isolation):** this is **not** a hardened sandbox against a
malicious prompt. Bash confinement is best-effort. A truly untrusted workload
needs OS-level confinement (chroot / bubblewrap / container boundary), which is
explicitly out of scope here.

## Chosen Approach

**System prompt + tool-level enforcement**, via a shared pure module plus thin
per-provider adapters. Scope: all three coding providers (Claude SDK, AI SDK,
OpenCode), both local and Docker backends. Enforcement is **always-on** whenever
a workspace exists — no per-step opt-out.

Enforcement strength by tool class:

| Tool class | Claude SDK | AI SDK | OpenCode |
|---|---|---|---|
| Read / Write / Edit | **Hard** (PreToolUse deny) | **Hard** (throw in `fs.ts`) | Best-effort (working dir + prompt) |
| Search (Grep/Glob/search) | **Hard** (PreToolUse deny) | **Hard** (throw in `fs.ts`) | Best-effort |
| Bash | Best-effort (command scan) | Best-effort (command scan) | Best-effort |

OpenCode runs its own tool loop via `@opencode-ai/sdk`, so we cannot inject a
per-tool interception hook the way the Claude SDK allows. OpenCode confinement
is therefore working-directory + system-prompt only — documented, not pretended
to be airtight.

### Rejected alternatives

- **OS-level confinement** (chroot / bind-mount / bubblewrap locally; container
  as boundary in Docker): airtight including Bash, but heavy, platform-specific
  (no bubblewrap on macOS local dev), needs privileges, and answers the
  *security* goal we explicitly excluded. Can layer on top in Docker later if a
  hardening need appears.
- **System prompt + `cwd` defaults only** (no interception): trivial, but
  collapses back to a soft nudge — Bash and absolute paths still escape. Rejected
  because we want a hard boundary on file/search tools.

## Architecture

New pure module — no provider/SDK imports, so all providers and backends can
depend on it without coupling:

```
packages/agent-runtime/src/workspace-guard/
├── index.ts              ← exports
├── resolve.ts            ← resolveWithinWorkspace(root, candidate)
├── system-prompt.ts      ← confinementSystemPrompt(root)
└── extract-paths.ts      ← per-tool path extractors (tool name → path args)
```

### `resolveWithinWorkspace(root, candidate)`

Returns `{ ok: true, path }` (safe absolute path) or `{ ok: false, reason }`.

1. If `candidate` is relative, resolve against `root`; if absolute, take as-is.
2. `realpath`-normalize (collapse `..`, follow symlinks) to defeat `../../etc`
   and symlink escapes. For paths that don't exist yet (writes), normalize the
   nearest existing ancestor and re-append the remainder.
3. Assert the normalized result is `root` itself or a descendant, using a
   trailing-separator guard so `/workspace-evil` is **not** treated as inside
   `/workspace`.
4. Success → safe absolute path; failure → structured rejection with a reason.

### `confinementSystemPrompt(root)`

Produces a snippet prepended to the prompt/system prompt for all providers:

> Your workspace is rooted at `<root>`. All files you read, write, search, or
> operate on live under this directory. Do not access paths outside it — file
> and search tools will refuse out-of-workspace paths. Use relative paths or
> paths under `<root>`.

Naming the root + the explicit "tools will refuse" line reduces wasted attempts.

### `extract-paths.ts`

Maps a tool name + tool input to the path argument(s) to validate:

- `Read` / `Write` / `Edit` → `file_path`
- `Grep` / `Glob` → `path` (search root; omitted → defaults to `cwd` = workspace, which is fine)
- AI SDK `read`/`write`/`edit`/`search` → their path arg
- `Bash` → best-effort scan of the `command` string for absolute paths and
  `cd <target>` outside the root

## Per-Provider Wiring

### Claude SDK — `run-custom-prompt.ts`, `scan-repos.ts`, `checkout-repo.ts`

- Add a `PreToolUse` hook to `query()` options. The hook reads `tool_name` +
  `tool_input`, extracts path arg(s) via `extract-paths`, validates each with
  `resolveWithinWorkspace`, and on failure returns:
  ```ts
  { hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `Path '<p>' is outside the workspace root '<root>'. Operate only within the workspace.`,
  }}
  ```
  (Confirmed available even under `permissionMode: "bypassPermissions"`.)
- Set `cwd = workspaceRoot` and `additionalDirectories = []` so the default
  search root is the workspace even when the agent omits a path.
- Prepend `confinementSystemPrompt(root)`.
- **Fix the cwd gap:** thread the workspace root into `scan-repos` and
  `checkout-repo` `query()` calls (today they pass none), so confinement is
  uniform across all coding ops.

### AI SDK — `tools/fs.ts`, `tools/bash.ts`

- Replace the existing `resolve()` helper in `fs.ts` with `resolveWithinWorkspace`
  so `read`/`write`/`edit`/`search` throw a tool error on out-of-bounds paths
  (absolute paths included — today they're allowed).
- In `bash.ts`, run the best-effort command scan before `spawn`.
- Prepend `confinementSystemPrompt(root)`.

### OpenCode — `operations/*.ts`

- Set the session working directory to the workspace root and pass OpenCode's
  directory-restriction option if its SDK exposes one.
- Prepend `confinementSystemPrompt(root)`.
- Best-effort only (no per-tool hook); documented limitation.

## Error Handling

- **Blocked path message** (Claude deny reason / AI SDK tool error):
  `"Path '<p>' is outside the workspace root '<root>'. Operate only within the workspace."`
  The model reads this and self-corrects to a workspace-relative path.
- **Do not** set `interrupt` — the agent should retry inside the workspace, not
  abort the run.
- **Logging:** each denial is logged through the existing logger path
  (`logSdkMessage` for Claude) so blocked attempts are visible in run logs —
  useful for observing how often prompts try to wander.

## Bash Best-Effort Scope (explicit)

The command scan flags absolute paths not under root and `cd <abs-path>` outside
the root. It will **not** catch obfuscation (env vars, subshells, `$(...)`,
command substitution). It is documented as best-effort and is **not** a security
boundary.

## Testing

- **`resolveWithinWorkspace`** unit tests: relative inside, absolute inside,
  `..` escape, symlink escape, sibling-prefix (`/workspace-evil`), root itself,
  `/etc/passwd`, not-yet-existing write path under root.
- **`extract-paths`** unit tests: correct path arg per tool name; missing path →
  no rejection.
- **Per-provider adapter tests:** a fake out-of-bounds tool call returns
  deny/throws; an in-bounds call passes.
- **Bash scan tests:** `cat /etc/passwd` blocked, `cd /tmp` blocked,
  `grep foo src/` allowed.

## Affected Files

- **New:** `packages/agent-runtime/src/workspace-guard/{index,resolve,system-prompt,extract-paths}.ts`
- `packages/agent-runtime/src/providers/claude/operations/run-custom-prompt.ts`
- `packages/agent-runtime/src/providers/claude/operations/scan-repos.ts`
- `packages/agent-runtime/src/providers/claude/operations/checkout-repo.ts`
- `packages/agent-runtime/src/providers/aisdk/tools/fs.ts`
- `packages/agent-runtime/src/providers/aisdk/tools/bash.ts`
- `packages/agent-runtime/src/providers/aisdk/operations/run-custom-prompt.ts`
- `packages/agent-runtime/src/providers/opencode/operations/*.ts`
