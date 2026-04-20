# OpenCode Provider — Design Spec

**Date:** 2026-04-20  
**Author:** Samuel Rego  
**Status:** Approved

---

## 1. Goal

Add `OpenCodeProvider` to `@journeyman/coding-cli` as a fully-implemented `ICodingCLI` provider backed by the [OpenCode SDK](https://opencode.ai/docs/sdk/). It is model-agnostic (Anthropic, OpenAI, Google, local) and supports two daemon modes: SDK-managed (Option B) and externally-running (Option A). The existing pipeline phases require no changes.

---

## 2. Background

### Claude provider (existing)
`@anthropic-ai/claude-agent-sdk` `query()` runs Claude **in-process** as an agent with Bash/Read/Glob/Grep tools. Each operation is a `for await` loop over streamed SDK messages until a `result` message arrives.

### OpenCode SDK (new)
OpenCode is a **local HTTP daemon** (`localhost:4096` by default). The SDK either spawns it as a child process or connects to an already-running instance. Operations are single `await client.session.prompt(...)` calls that block until the AI finishes and return an `AssistantMessage` with optional `structured_output`.

Key capabilities confirmed:
- Bash/file/glob/grep tool access via `permission: { bash: "allow", edit: "allow" }`
- Structured JSON output via `format: { type: "json_schema", schema }`
- MCP servers via `config.mcp` at daemon startup
- Per-prompt tool toggles via `tools: { [toolName]: boolean }`
- Model selection per-prompt: `model: { providerID, modelID }`

---

## 3. Approach: Mirror Claude Structure (Approach B)

Each operation lives in its own file under `operations/`. Prompts are identical in intent to the Claude operations — only the execution layer changes. This isolates the two providers completely; they can diverge independently.

---

## 4. Config Type

Defined in `packages/coding-cli/src/providers/opencode/types.ts`:

```ts
import type { McpLocalConfig, McpRemoteConfig } from "@opencode-ai/sdk"

export type OpenCodeMode =
  | { mode: "managed"; hostname?: string; port?: number; timeout?: number }
  | { mode: "external"; baseUrl?: string }   // defaults to http://localhost:4096

export type OpenCodePermission = {
  bash?: "ask" | "allow" | "deny"
  edit?: "ask" | "allow" | "deny"
  webfetch?: "ask" | "allow" | "deny"
}

export type OpenCodeProviderConfig = OpenCodeMode & {
  model: { providerID: string; modelID: string }
  mcp?: Record<string, McpLocalConfig | McpRemoteConfig>
  tools?: Record<string, boolean>
  permission?: OpenCodePermission
}
```

**Default permissions** (applied if not overridden): `bash: "allow"`, `edit: "allow"`, `webfetch: "allow"` — mirrors `bypassPermissions` behaviour of the Claude provider.

### Usage examples

```ts
// Option A — connect to already-running daemon
new OpenCodeProvider({
  mode: "external",
  baseUrl: "http://localhost:4096",
  model: { providerID: "openai", modelID: "gpt-4o" },
})

// Option B — SDK spawns and manages the process
new OpenCodeProvider({
  mode: "managed",
  model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
  mcp: {
    github: { type: "local", command: ["npx", "@modelcontextprotocol/server-github"] },
  },
})
```

---

## 5. File Layout

```
packages/coding-cli/src/providers/opencode/
├── types.ts                         ← OpenCodeProviderConfig, OpenCodeMode
├── client.ts                        ← getClient() factory
├── index.ts                         ← OpenCodeProvider class
├── operations/
│   ├── scan-repos.ts
│   ├── checkout-repo.ts
│   ├── commit-push-repos.ts
│   ├── cleanup-repos.ts
│   ├── create-workspace.ts
│   ├── analyze.ts
│   ├── plan.ts
│   └── implement.ts
└── utils/
    └── sdk-logger.ts                ← logSessionEvent()
```

---

## 6. Client Factory (`client.ts`)

```ts
import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk"
import type { OpenCodeProviderConfig } from "./types.ts"

const DEFAULT_PERMISSION = { bash: "allow", edit: "allow", webfetch: "allow" }

export async function getClient(config: OpenCodeProviderConfig) {
  const permission = { ...DEFAULT_PERMISSION, ...config.permission }
  const tools = config.tools

  if (config.mode === "managed") {
    const { client } = await createOpencode({
      hostname: config.hostname,
      port: config.port,
      timeout: config.timeout,
      config: { permission, tools, mcp: config.mcp },
    })
    return client
  }

  // mode === "external"
  return createOpencodeClient({ baseUrl: config.baseUrl ?? "http://localhost:4096" })
}
```

Lifecycle: in `managed` mode the OpenCode child process is tied to the Node.js parent process lifetime — no explicit cleanup required.

---

## 7. Provider Class (`index.ts`)

```ts
export class OpenCodeProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "opencode",
    name: "OpenCode CLI",
    description: "AI coding via OpenCode SDK (model-agnostic: Anthropic, OpenAI, Gemini…)",
    category: "coding-cli",
  }

  #config: OpenCodeProviderConfig
  #client: OpenCodeClient | null = null

  constructor(config: OpenCodeProviderConfig) { this.#config = config }

  private async client() {
    if (!this.#client) this.#client = await getClient(this.#config)
    return this.#client
  }

  async scanRepos(opts)        { return scanRepos(await this.client(), this.#config, opts) }
  async checkoutRepo(opts)     { return checkoutRepo(await this.client(), this.#config, opts) }
  async commitPushRepos(opts)  { return commitPushRepos(await this.client(), this.#config, opts) }
  async cleanupRepos(opts)     { return cleanupRepos(await this.client(), this.#config, opts) }
  async createWorkspace(opts)  { return createWorkspace(await this.client(), this.#config, opts) }
  async analyze(opts)          { return analyze(await this.client(), this.#config, opts) }
  async plan(opts)             { return plan(await this.client(), this.#config, opts) }
  async implement(opts)        { return implement(await this.client(), this.#config, opts) }
}
```

Client is initialized **lazily** on the first operation call so the constructor stays synchronous.

---

## 8. Operation Pattern

Each operation file follows this shape (shown for `analyze`; all others identical in structure):

```ts
import { createLogger } from "@journeyman/core"
import { logSessionEvent } from "../utils/sdk-logger.ts"
import type { OpenCodeProviderConfig } from "../types.ts"
import type { AnalyzeOptions, AnalyzeResult } from "@journeyman/core"

const log = createLogger("opencode:analyze")

export async function analyze(
  client: OpenCodeClient,
  config: OpenCodeProviderConfig,
  opts: AnalyzeOptions,
): Promise<AnalyzeResult> {
  const session = await client.session.create({ body: { title: "analyze" } })
  const sessionId = session.data.id
  log.info({ sessionId, dirPath: opts.dirPath }, "analyze start")

  const result = await client.session.prompt({
    path: { id: sessionId },
    body: {
      parts: [{ type: "text", text: buildPrompt(opts) }],
      model: config.model,
      tools: config.tools,
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
  })

  logSessionEvent(log, sessionId, result.data.info)

  const msg = result.data.info
  if (msg.error) {
    log.error({ sessionId, error: msg.error }, "analyze failed")
    return { ...EMPTY_RESULT, sessionId, error: msg.error }
  }
  if (!msg.structured_output) return { ...EMPTY_RESULT, sessionId }
  return { ...(msg.structured_output as AnalyzeResult), sessionId }
}
```

`buildPrompt()` and `OUTPUT_SCHEMA` are **identical** to the Claude `analyze.ts` equivalents.

---

## 9. Logging Utility (`utils/sdk-logger.ts`)

```ts
import type { Logger } from "@journeyman/core"

export function logSessionEvent(log: Logger, sessionId: string, msg: AssistantMessage): void {
  log.debug({
    sessionId,
    hasError: !!msg.error,
    hasStructuredOutput: !!msg.structured_output,
    tokens: msg.tokens,
  }, "opencode session result")
}
```

---

## 10. Error Handling

| Condition | Behaviour |
|---|---|
| `msg.error` set | Log error, return `EMPTY_RESULT` with `error` field |
| `msg.structured_output` missing | Return `EMPTY_RESULT` with `sessionId` |
| `session.create()` throws | Propagate — caller (phase) handles via `unwrap()` |
| `mode: "external"`, daemon not running | `createOpencodeClient` succeeds; first `session.create()` will throw HTTP error — propagates |

---

## 11. Pipeline Integration

### Registration (two files)

`packages/pipeline/src/cli-commands/run-once.ts` — add `OpenCodeProvider` to the registration array:
```ts
import { ClaudeProvider, GeminiProvider, CodexProvider, OpenCodeProvider } from "@journeyman/coding-cli"
// ...
for (const c of [
  ClaudeProvider, GeminiProvider, CodexProvider, OpenCodeProvider,  // ← add
  ...
]) providers.register(c as any)
```

Same change in `packages/pipeline/src/cli-commands/sweep.ts`.

### Flow YAML config

```yaml
providers:
  coding: opencode   # replaces "claude"

# in products.<name>.providerConfig:
providerConfig:
  coding:
    mode: managed
    model:
      providerID: anthropic
      modelID: claude-sonnet-4-6
    permission:
      bash: allow
      edit: allow
    # optional MCP:
    mcp:
      github:
        type: local
        command: ["npx", "@modelcontextprotocol/server-github"]
```

No changes to any pipeline phase files.

---

## 12. Package Changes

### `packages/coding-cli/package.json`
```json
"dependencies": {
  "@opencode-ai/sdk": "latest"
}
```

### `packages/coding-cli/src/index.ts`
```ts
export { OpenCodeProvider } from "./providers/opencode/index.ts"
```

---

## 13. Files Changed Summary

| File | Type |
|---|---|
| `packages/coding-cli/src/providers/opencode/types.ts` | New |
| `packages/coding-cli/src/providers/opencode/client.ts` | New |
| `packages/coding-cli/src/providers/opencode/index.ts` | New |
| `packages/coding-cli/src/providers/opencode/utils/sdk-logger.ts` | New |
| `packages/coding-cli/src/providers/opencode/operations/scan-repos.ts` | New |
| `packages/coding-cli/src/providers/opencode/operations/checkout-repo.ts` | New |
| `packages/coding-cli/src/providers/opencode/operations/commit-push-repos.ts` | New |
| `packages/coding-cli/src/providers/opencode/operations/cleanup-repos.ts` | New |
| `packages/coding-cli/src/providers/opencode/operations/create-workspace.ts` | New |
| `packages/coding-cli/src/providers/opencode/operations/analyze.ts` | New |
| `packages/coding-cli/src/providers/opencode/operations/plan.ts` | New |
| `packages/coding-cli/src/providers/opencode/operations/implement.ts` | New |
| `packages/coding-cli/src/index.ts` | Modified — add export |
| `packages/coding-cli/package.json` | Modified — add dependency |
| `packages/pipeline/src/cli-commands/run-once.ts` | Modified — register provider |
| `packages/pipeline/src/cli-commands/sweep.ts` | Modified — register provider |

**Not changed:** `@journeyman/core`, all pipeline phases, git/ticket/notification providers.

---

## 14. Out of Scope

- Streaming/SSE event subscription for real-time progress (not needed — `session.prompt()` is synchronous)
- OpenCode session reuse across operations (each operation creates its own ephemeral session)
- `GeminiProvider` / `CodexProvider` implementation (existing stubs unchanged)
