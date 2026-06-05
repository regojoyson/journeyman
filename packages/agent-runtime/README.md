# @journeyman/coding-cli

AI coding CLI providers for Journeyman. Implements `ICodingCLI` from `@journeyman/core` with concrete providers for Claude, Gemini, Codex, and OpenCode.

Providers run two categories of operations:

- **Git operations** (local via bash): `cloneRepos`, `checkoutRepo`, `scanRepos`, `commitPushRepos`, `cleanupRepos`, `createWorkspace`
- **AI operations** (via the provider's SDK): `analyze`, `plan`, `implement`

## Providers

| Provider | ID | Status | Notes |
|---|---|---|---|
| `ClaudeProvider` | `claude` | Implemented | Claude Agent SDK; runs in-process |
| `OpenCodeProvider` | `opencode` | Planned | OpenCode SDK; managed or external daemon mode |
| `GeminiProvider` | `gemini` | Stub | Throws `not implemented` |
| `CodexProvider` | `codex` | Stub | Throws `not implemented` |

## ClaudeProvider

Uses `@anthropic-ai/claude-agent-sdk` (`query()`) to run all AI operations. Auth is inherited from the environment:

- Local dev: run `claude login` once — no env var needed.
- Server/Docker/CI: set `ANTHROPIC_API_KEY`.

Optional per-step model configuration:

```yaml
# In pipeline.yaml product block
providerConfig:
  coding:
    defaultModel: claude-sonnet-4-6   # fallback for all steps
    models:
      analyze: claude-opus-4-7        # override for a specific step
      implement: claude-haiku-4-5
```

All fields are optional. Omitting them uses the SDK default model.

## Exports

```typescript
import {
  ClaudeProvider,
  GeminiProvider,
  CodexProvider,
  OpenCodeProvider,
} from "@journeyman/coding-cli";
import type { ICodingCLI, OpenCodeProviderConfig } from "@journeyman/coding-cli";
```

## Documentation

- [Providers reference](../../docs/providers.md#claude--claudeprovider) — full config + env var details
- [Configuration reference](../../docs/configuration.md#per-step-model-configuration-coding-providers) — per-step model config
