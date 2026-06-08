# @journeyman/agent-runtime

The Journeyman **box runtime**: the package shipped into a sandbox container. It bundles the coding providers that implement `ICodingCLI` from `@journeyman/core`, plus a stdin/stdout runner that drives a single operation per invocation.

Providers run two categories of operations:

- **Workspace/git operations** (local via bash): `scanRepos`, `checkoutRepo`
- **AI operation** (via the provider's SDK): `runCustomPrompt` — the engine behind `custom-ai` steps

> `ICodingCLI` is intentionally small: `scanRepos`, `checkoutRepo`, `runCustomPrompt`. There is no separate `analyze` / `plan` / `implement` — those were retired in favor of user-defined `custom-ai` steps driven by `runCustomPrompt`.

## Providers

| Provider | ID | Status | Notes |
|---|---|---|---|
| `ClaudeProvider` | `claude` | Implemented | Claude Agent SDK; runs in-process |
| `OpenCodeProvider` | `opencode` | Implemented | OpenCode SDK; managed or external daemon mode |
| `GeminiProvider` | `gemini` | Stub | Throws `not implemented` |
| `CodexProvider` | `codex` | Stub | Throws `not implemented` |

Build one with `createCodingProvider(id, { env })`.

## The runner

`runner/cli.ts` (`journeyman-runner`) reads a `RunnerRequest` JSON on stdin, runs the operation via the selected provider, and writes a `RunnerResponse` JSON on stdout; SDK log lines go to stderr. It guarantees the current Node binary is resolvable by bare name on `PATH` and sets `IS_SANDBOX=1` so the Claude engine permits `bypassPermissions` as root inside the throwaway container. `--selftest` prints a fixed ok response without invoking any SDK (used by the image smoke test; needs no API key).

```jsonc
// RunnerRequest (stdin)
{ "op": "custom-prompt", "provider": "claude", "opts": { "prompt": "…", "outputMode": "text", "tools": ["bash"], "cwd": "/workspace" } }
// RunnerResponse (stdout)
{ "ok": true, "result": "…" }
```

## Tools (canonical → native)

`runCustomPrompt` receives canonical tool names (`CanonicalTool` from `@journeyman/core`: `bash`, `read-file`, `write-file`, `edit-file`, `search`, `web-fetch`, `web-search`). Each provider's `tool-mapping.ts` translates them to native SDK tool names (Claude: `bash → ["Bash"]`, `search → ["Grep","Glob"]`), and the SDK is called with `{ tools, allowedTools }`. An empty/undefined list means a pure-prompt step (no tools). It also accepts `mcps?`, `skills?`, and structured `outputSchema`.

## ClaudeProvider

Uses `@anthropic-ai/claude-agent-sdk` (`query()`). Auth is inherited from the environment:

- Local dev: run `claude login` once — no env var needed.
- Server/Docker/CI: set `ANTHROPIC_API_KEY`.

Optional per-step model configuration:

```yaml
# In the flow / product config
providerConfig:
  coding:
    defaultModel: claude-sonnet-4-6   # fallback for all steps
```

All fields are optional. Omitting them uses the SDK default model.

## Exports

```typescript
import {
  ClaudeProvider,
  OpenCodeProvider,
  GeminiProvider,
  CodexProvider,
  createCodingProvider,
  dispatchOperation,
  runRunnerCli,
  PROVIDER_TOOL_MAPS,
} from "@journeyman/agent-runtime";
import type {
  ICodingCLI,
  OpenCodeProviderConfig,
  RunnerRequest,
  RunnerResponse,
} from "@journeyman/agent-runtime";
```

## Documentation

- [Providers reference](../../docs/providers.md) — full config + env var details
