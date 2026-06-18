# OpenCode parity — AbortSignal + Skills — design

**Date:** 2026-06-18
**Status:** Approved (design)
**Scope:** Close the two remaining OpenCode coding-provider parity gaps — `opts.signal` (cancellation) and `opts.skills` (skill delivery) — so OpenCode matches the Claude and AISDK providers. Both are provider-only changes; the `signal` and `skills` options already exist end-to-end in `@journeyman/core` and the orchestrator.

## Background

`runCustomPrompt(opts)` carries `signal?: AbortSignal` and `skills?: ResolvedSkillPackage[]`.
Two of three providers honor each; OpenCode honors neither:

| Concern | Claude | AISDK | OpenCode (today) |
|---|---|---|---|
| Abort | bridges `opts.signal` → `AbortController` on `query()` | `abortSignal: opts.signal` on `generateText` | **ignored** — cancelled run keeps executing server-side |
| Skills | SDK plugins + `Skill` tool (lazy) | in-process `Skill` tool + prompt menu | **dropped** — only counted in a log line |

`ResolvedSkillPackage` (`packages/core/src/types/skills.types.ts`): `{ id, name, localPath, enabledSkills: string[], cliType }`. Skills are already materialized into the workspace by `placeSkills` before the provider runs, so `localPath` points at a real on-disk skill package.

OpenCode exposes native mechanisms for both, discovered in `@opencode-ai/sdk` v2:
- **Abort:** `createOpencode({ …, signal })` (`ServerOptions.signal`) cancels server startup; `client.session.abort({ sessionID })` stops a running server-side agent loop.
- **Skills:** v2 `Config.skills = { paths?: string[]; urls?: string[] }` auto-registers skills from filesystem paths and exposes them through OpenCode's native `skill` tool (the server permission already sets `skill: "allow"`).

## Part A — Skills via the native registry

Thread `opts.skills` into the per-call server `Config` as `skills.paths`, one path per **enabled** skill.

### Changes
- **`server-config.ts`**
  - Add `skills?: ResolvedSkillPackage[]` to `ServerConfigRuntime`.
  - In `buildServerConfig`, compute
    `paths = (runtime.skills ?? []).flatMap(pkg => pkg.enabledSkills.map(name => join(pkg.localPath, name)))`
    (import `join` from `node:path`).
  - Add `...(paths.length ? { skills: { paths } } : {})` to the returned config object.
- **`index.ts`** — in `runCustomPrompt`, add `skills: opts.skills` to the `#withServer` runtime object.

### Rationale
Per-enabled-skill directories register exactly the skills the user enabled (a package may carry
more skills than `enabledSkills` lists). This mirrors the Claude/AISDK selection and the native
`skill` tool keeps skills lazily loaded — no prompt bloat.

### Assumption to verify (probe — needs OpenCode credentials)
`Config.skills.paths` expects a path to a directory containing that skill's `SKILL.md`
(i.e. `join(localPath, name)`), and registered skills surface in `client.skill.list()` and are
invokable by the model. If OpenCode instead expects the **package root** (and scans recursively),
the fallback is to pass each `pkg.localPath` once and accept that all skills in the package register.

## Part B — AbortSignal

Honor `opts.signal` at two points: server startup and the running prompt.

### Changes
- **`client.ts` (`startServer`)**
  - Add a `signal?: AbortSignal` parameter.
  - Forward it to `createOpencode({ hostname, port, timeout, config, signal })` in managed mode.
  - External mode ignores it (no server is spawned).
- **`index.ts` (`#withServer`)**
  - Add `signal?: AbortSignal` to the runtime inline type.
  - Pass `runtime.signal` to `startServer` (it is a server-lifecycle param, NOT part of
    `buildServerConfig`).
  - In `runCustomPrompt`, add `signal: opts.signal` to the runtime object.
- **`operations/run-custom-prompt.ts`**
  - Before creating the session: if `opts.signal?.aborted`, throw
    `opts.signal.reason ?? new DOMException("Aborted", "AbortError")`.
  - After `session.create` succeeds, register a one-shot listener:
    `opts.signal?.addEventListener("abort", onAbort, { once: true })`, where `onAbort` calls
    `client.session.abort({ sessionID: session.data.id })` fire-and-forget (swallow its own errors).
    Remove the listener in a `finally`.
  - When the run returns aborted — `opts.signal?.aborted` is true, or `info.error` is a
    `MessageAbortedError` — **throw** `opts.signal?.reason ?? new DOMException("Aborted", "AbortError")`
    instead of returning the `{ sessionId, error }` envelope.

### Rationale
Throwing on abort matches Claude/AISDK, whose underlying SDKs propagate cancellation as a thrown
error; the orchestrator handles all three identically. `session.abort` is best-effort — its failure
must never mask the original cancellation, hence the swallowed error.

## Out of scope
- `scanRepos` / `checkoutRepo` (deterministic ops; abort/skills not applicable to their fixed flows).
- The `skills.urls` registry channel (we only ship local, materialized skills).
- Any core/orchestrator/UI change — `signal` and `skills` already flow into `runCustomPrompt`.

## Testing
- **`server-config.test.ts`**
  - Given two packages with `enabledSkills`, `skills.paths` equals the `join(localPath, name)` list
    for every enabled skill, in order.
  - No skills (omitted / empty) ⇒ no `skills` key in the config.
  - The `skills` block coexists with the existing `permission` / `agent` / `mcp` / `provider` blocks.
- **Abort (unit, stub OpenCode client)**
  - An already-aborted `opts.signal` makes `runCustomPrompt` throw before any client method is called.
  - Firing the signal after session creation invokes `client.session.abort` with the created
    `sessionID`, and `runCustomPrompt` throws an `AbortError`.
- **Verification probe (needs credentials, no commit)** — confirm `skills.paths` registration via
  `client.skill.list()` and model invocation; confirm a mid-run `session.abort` stops the loop.

## Risk
Both changes are additive. The only assumptions are the skill-path granularity (Part A probe, with a
documented fallback) and that an aborted `session.prompt` returns a `MessageAbortedError` envelope
rather than hanging (Part B probe). Runs that never abort and steps with no skills are unaffected.
