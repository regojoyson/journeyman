# OpenCode Provider Parity — Design

**Date:** 2026-06-08
**Status:** Approved (design)
**Supersedes scope of:** `2026-04-20-opencode-provider-design.md` (initial scaffold)

## Goal

Bring the OpenCode coding provider to **full parity with Claude**: it must run custom AI
prompts (`runCustomPrompt`) in addition to the existing `scanRepos` / `checkoutRepo`, in
**both** execution backends (local + Docker), with **MCP**, **skills**, **tools**, and
**structured output** support, selected purely by the provider chosen for a step. No
behaviour should depend on the provider beyond the provider-specific translation layer.

## Background — current state

- `OpenCodeProvider` (`packages/agent-runtime/src/providers/opencode/`) implements
  `scanRepos` + `checkoutRepo` via `@opencode-ai/sdk` v2 sessions, but
  `runCustomPrompt` **throws** "not implemented".
- The provider factory (`packages/agent-runtime/src/providers/factory.ts`) only wires
  `case "claude"`. There is no `case "opencode"`.
- `OPENCODE_TOOL_MAP` (`providers/opencode/tool-mapping.ts`) maps **every** canonical tool
  to `null` — so no tools are usable.
- The existing operations hard-code `{ bash: true }` and ignore `opts.mcps`, `opts.skills`,
  and `opts.env`.
- `client.ts` spawns a managed server **once at construction** with a fixed config — which
  cannot carry per-call MCP/skills/tools.
- `placeSkills()` (`packages/orchestrator/src/workers/skill-placement.ts`) only handles
  `case "claude"`; for any other provider it returns skills unchanged, so **skills are
  never delivered into the container for OpenCode in Docker**.
- The runner Docker images bundle the Claude SDK but **not** the `opencode` binary.

## Key facts established about the OpenCode SDK (`@opencode-ai/sdk` v1.16.2, `/v2`)

- **Managed mode** (`createOpencode` / `createOpencodeServer`) spawns the `opencode`
  binary via `launch("opencode", ["serve", "--hostname", "--port"])` and passes the whole
  `Config` object through the `OPENCODE_CONFIG_CONTENT` env var. The binary must be on
  `PATH`. The SDK npm package is **only** the client/spawner — it does **not** ship the
  binary.
- **External mode** connects to an already-running server at a `baseUrl`.
- `Config` natively supports: `model` (`"providerID/modelID"`), `mcp`
  (`McpLocalConfig | McpRemoteConfig`), `tools` (`Record<string, boolean>` enable map),
  `permission`, `instructions` (paths), `provider` (per-provider options incl. apiKey),
  and skills (OpenCode loads `SKILL.md` folders natively; `source: "skill"`).
- `session.prompt` accepts `format: { type: "json_schema", schema }` and returns
  `structured` — native structured output, same shape Claude uses.

## Decisions (locked with stakeholder)

1. **Server lifecycle:** *Managed, per-operation.* Each operation assembles its config,
   spawns `opencode serve`, runs the session, and `close()`s it in a `finally`. Mirrors how
   Claude's SDK spawns a fresh `cli.js` per call. (Persistent/sidecar deferred as a future
   optimisation if startup cost matters.)
2. **Skills:** *Native skill dirs.* Stage skill packages where OpenCode discovers them and
   let OpenCode load them as real skills — no system-prompt faking.
3. **Model scope:** *Any configured provider.* No provider hard-coding; whatever
   provider/model the user configures flows through via secrets → env + the `model` string.

## How it runs (both backends)

The provider/factory/config code is **identical** across backends. The sandbox layer
decides where that code runs:

| | Local backend | Docker backend |
|---|---|---|
| Who calls the provider | the worker, in-process | `journeyman-runner`, inside the container |
| Where `opencode serve` is spawned | the worker's machine/container | inside the sandbox container |
| Workspace it acts on | a folder on the worker's disk | the container's `/workspace` volume |
| `opencode` binary must exist in | the **worker's** image/host | the **runner** image |
| Skills delivery | read directly from host cache | tar-streamed into the container |

**Concurrency:**

- **Docker backend:** each step gets its own container with its own private localhost, so
  servers never collide regardless of port. Only limit is host resources. (Production-safe.)
- **Local backend:** all servers share one localhost — so each spawned server **must get a
  unique/free port** (OS-assigned port `0`, or a unique port per spawn). Workspaces are
  already separate per step, so only the port needs handling.

## Components / changes

### 1. Factory wiring — `providers/factory.ts`

Add `case "opencode"`:

- Default `mode: "managed"`.
- Parse `opts.model` as `"<providerID>/<modelID>"` (split on the first `/`) into
  `{ providerID, modelID }`. Error clearly if the model string lacks a `/`.
- Pass `opts.env` through so provider API keys (any configured provider) reach the spawned
  server.

`CreateCodingProviderOpts` already carries `{ env, model? }`; no signature change needed.

### 2. Config assembly — `buildOpenCodeConfig(opts, providerConfig)`

A single helper (new file under `providers/opencode/`) that all three operations call,
producing the OpenCode `Config`:

```
{
  model:       `${providerID}/${modelID}`,
  permission:  { bash: "allow", edit: "allow", webfetch: "allow" },  // bypass parity
  tools:       <canonical → opencode enable map>,
  mcp:         <ResolvedMcpInstance[] → McpLocal/McpRemoteConfig>,
  instructions / skill dir: <staged skill packages>,
  provider:    <optional per-providerID apiKey from env>,
}
```

### 3. Per-operation managed server

Refactor `client.ts` so the managed server is **spawned inside each operation** with the
call's assembled config, then `close()`d in a `finally`. For the local backend, request a
free port per spawn (do not reuse a fixed port). Docker is unaffected (isolated localhost).

### 4. `runCustomPrompt` — new operation `operations/run-custom-prompt.ts`

Mirror Claude's operation:

- Honour `outputMode`:
  - **structured** → `format: { type: "json_schema", schema: opts.outputSchema }`; read
    `response.structured`.
  - **text** → plain prompt; return assistant text.
  - **none** → run; return nothing.
- Pass `opts.env` to the spawned server.
- Honour `opts.signal` (abort).
- Capture errors (incl. server stderr/exit output) into the result, parity with Claude's
  stderr capture.
- Log via the provider's session logger.

### 5. MCP mapping — `providers/opencode/mcp-adapter.ts`

Translate `ResolvedMcpInstance[]` → OpenCode `Config.mcp` (OpenCode shape, not Claude's):

- `transport: "stdio"` → `McpLocalConfig { type, command, args, environment }`
- `transport: "sse" | "http"` → `McpRemoteConfig { type, url, headers }`
- De-dupe by name (same approach as `@journeyman/mcp/sdk-adapter`).

MCP needs **no file staging** — it is pure config (command/url/env), identical in both
backends.

### 6. Skills — native dirs + Docker delivery

- **Local:** skills already live in the host cache (`$JOURNEYMAN_BASE_DIR/skills/...`);
  point OpenCode's config at those paths. No extra work.
- **Docker:** add a `case "opencode"` to `placeSkills()` that tars the enabled skill
  folders, streams them into the container at **OpenCode's** skills directory (e.g.
  `/workspace/.opencode/skill/`), and rewrites each `ResolvedSkillPackage.localPath` to the
  in-container path — exactly as the Claude case does, but to the OpenCode location.
- Point `buildOpenCodeConfig` at that directory so OpenCode discovers them as native skills.
- `ResolvedSkillPackage.cliType` already distinguishes `claude | opencode | codex`; skill
  resolution/placement for an OpenCode step should use OpenCode-compatible packages.

### 7. Tools — fill `OPENCODE_TOOL_MAP`

| Canonical | OpenCode |
|---|---|
| `bash` | `bash` |
| `read-file` | `read` |
| `write-file` | `write` |
| `edit-file` | `edit` |
| `search` | `grep`, `glob` |
| `web-fetch` | `webfetch` |
| `web-search` | `null` (no native equivalent) |

`buildOpenCodeConfig` turns the selected canonical tools into an enable map (selected on,
others off) so a step gets exactly its configured tools. `web-search` stays `null`; the
editor already flags `null`-mapped tools as unsupported per provider.

### 8. `scanRepos` / `checkoutRepo` consistency

Route both through `buildOpenCodeConfig` and the per-operation managed spawn so they gain
`env` (and MCP where relevant) and stay consistent with `runCustomPrompt`.

### 9. Docker / runtime packaging

- Pin **`opencode-ai`** (the CLI package carrying the platform binary) as a prod dependency
  of `@journeyman/agent-runtime`, so it lands in `node_modules/.bin/opencode` and rides the
  existing `COPY --from=build /app/node_modules` in both Dockerfiles (and is available for
  the local backend after `npm install`). Add `node_modules/.bin` (or the relocatable
  `/opt/journeyman/bin`) to `PATH` so the SDK's `launch("opencode", …)` resolves it.
- **musl vs glibc:** `runner-base.Dockerfile`'s runtime stage is `node:22-alpine` (musl)
  but the build stage is `node:22-slim` (glibc), so `npm ci` resolves the **glibc** opencode
  binary, which will not run on Alpine. **Switch the `runner-base` runtime stage to
  `node:22-slim`** (glibc), consistent with `runner-bundle` (already glibc). (Alternative:
  install a musl-specific opencode build on Alpine — not chosen.)
- **Architecture:** `npm ci` selects the binary for the build platform; multi-arch (e.g.
  ECS Graviton/arm64) means building per-arch with buildx. No code change — a build-matrix
  note.
- For both `compose` and `ECS`/`k8s`, "installing opencode" = this dependency + image
  rebuild + push. Nothing installs at runtime.

## Data flow (custom-AI step, Docker backend)

1. Worker resolves step config → `ResolvedMcpInstance[]`, `ResolvedSkillPackage[]` (skill
   packages git-cloned to host cache), `CanonicalTool[]`, `model`, `provider:"opencode"`.
2. `placeSkills("opencode", …)` tars + streams skills into the container and rewrites
   `localPath` to in-container paths.
3. Docker backend execs `journeyman-runner` with the `RunnerRequest`
   (`{ op:"custom-prompt", provider:"opencode", opts:{…, cwd:"/workspace"} }`).
4. In the container: `createCodingProvider("opencode", { env, model })` →
   `OpenCodeProvider.runCustomPrompt(opts)` → `buildOpenCodeConfig(opts)` → spawn managed
   `opencode serve` (config via `OPENCODE_CONFIG_CONTENT`) → `session.create` /
   `session.prompt` (with `format` if structured) → `close()` → return `RunnerResponse`.

For the local backend, steps 2–3 collapse: the provider is called in-process and reads
skills from the host cache; the only difference is a free-port-per-spawn requirement.

## Error handling

- Missing `opencode` binary → clear "opencode not found on PATH" error (the same failure
  class as the historical `node`-not-on-PATH issue; see the runner `PATH` handling).
- Model string without `/` → `ConfigurationError` from the factory.
- Server spawn timeout / non-zero exit → surface the captured server output in the result.
- Structured-output validation failure → propagate OpenCode's `StructuredOutputError`.
- Abort signal → close the server and return an aborted result.

## Testing

- **Unit (pure functions):** model split, `OPENCODE_TOOL_MAP` enable-map build, MCP map
  (stdio/sse/http), skills staging path rewrite (`placeSkills` opencode case).
- **Integration:** `runCustomPrompt` in **text** and **structured** modes against a real
  managed `opencode`; one MCP smoke test; abort-signal test.
- **Image:** extend the runner `--selftest` to assert `opencode` is present and runnable.
- **Parity:** run the same custom-AI step with `provider:"claude"` then
  `provider:"opencode"` and confirm both return valid structured output.

## Out of scope / deferred

- Persistent / sidecar OpenCode server (kept per-operation for now).
- `web-search` for OpenCode (no native tool).
- Gemini / Codex providers (separate work).

## Affected files (indicative)

- `packages/agent-runtime/src/providers/factory.ts` — add `case "opencode"`.
- `packages/agent-runtime/src/providers/opencode/` — `buildOpenCodeConfig`, refactor
  `client.ts` (per-op spawn + free port), new `operations/run-custom-prompt.ts`,
  `mcp-adapter.ts`, fill `tool-mapping.ts`, route `scan-repos.ts` / `checkout-repo.ts`
  through the helper.
- `packages/orchestrator/src/workers/skill-placement.ts` — add `case "opencode"`.
- `packages/skills/src/bundle-skills.ts` — OpenCode skills dir constant (if needed).
- `packages/agent-runtime/package.json` — add `opencode-ai` dep.
- `docker/runner-base.Dockerfile` — glibc runtime stage + `PATH`.
- `docker/runner-bundle.Dockerfile` — ensure opencode rides the relocatable bundle + `PATH`.
