# Design: `aisdk` — a multi-model coding provider built on Vercel AI SDK 6

**Date:** 2026-06-09
**Status:** Approved design — ready for implementation planning
**Package:** `@journeyman/agent-runtime`

## 1. Goal

Add a new coding-cli provider, `aisdk`, that behaves like the existing Claude
provider (same `ICodingCLI` surface, same interactive logs, MCP, skills, tools,
and **guaranteed structured output**) but works across **any model vendor**
(Anthropic, OpenAI, Google, plus any OpenAI-compatible local/gateway endpoint).

The engine is the **Vercel AI SDK 6** (`ai` + `@ai-sdk/*`), Apache-2.0 licensed.
We build a thin coding-agent layer on top; we do not fork or modify the SDK.

### Why AI SDK over Pi / OpenCode

The AI SDK natively provides the two capabilities that are the hardest to get
right and that the user cares most about:

- **Guaranteed structured output** — `generateText({ output: Output.object(...) })`
  constrains the final answer to a schema (provider-enforced, not salvaged-from-text).
- **Native MCP** — `experimental_createMCPClient` (tools + resources + prompts).

Pi has neither natively (bridge + salvage); OpenCode has weak structured output.
AI SDK is also battle-tested and fully in-process (no engine binary, no
PATH/socat packaging pain), and leaves the agent loop and tools under our control
— important given the prior opaque failures with OpenCode.

## 2. What AI SDK provides vs what we build

**AI SDK (engine — we write none of this):** multi-vendor model calls; the
multi-step tool-calling agent loop (`stopWhen`); structured output
(`Output.object` + `jsonSchema`); the MCP *client*; per-step callbacks
(`onStepFinish`, tool-call hooks); `abortSignal` forwarding.

**Our layer (new code):**

| # | Layer | Responsibility |
|---|---|---|
| 1 | Provider + `run-custom-prompt` | Assemble model+tools+mcp+skills+output+logging, call `generateText`, map result/errors, wire abort/env/cwd |
| 2 | Tools (the "nouns") | `execute()` bodies: bash (spawn/cwd/env/timeout/abort), read/write/edit, search (ripgrep/glob), web-fetch; `tool-mapping.ts` |
| 3 | Model loader | `config.npm` → dynamic import + factory registry → `provider(modelId)`; key from `env[apiKeySlot]`; `baseURL` from `config.baseUrl` |
| 4 | MCP bridge | `createMCPClient` per `ResolvedMcpInstance`, merge tools as `mcp__name__*`, collision-suffix, `close()` lifecycle |
| 5 | Skills (emulation) | Read enabled `SKILL.md` from `localPath` → system-prompt menu + a `Skill` tool that lazy-loads bodies |
| 6 | Structured mapping | raw `outputSchema` → `Output.object(jsonSchema(...))`; `outputMode` → `RunCustomPromptResult`; `stopWhen` step cap |
| 7 | Interactive logging | `onStepFinish` + tool hooks → `onLog` one-liners, gated by `AgentLogLevel` |
| 8 | Wiring | catalog entry, factory case, tool-maps, validate-config, slot surfacing, admin form, packaging |

**Reused as-is:** DB table + CRUD routes, secret vault + binding resolver,
`ResolvedMcpInstance`/`ResolvedSkillPackage` shapes, workspace ops
(clone/scan/checkout), the runner stdin/stdout harness, the flow editor (minus
small gate edits).

## 3. File layout

```
packages/agent-runtime/src/providers/aisdk/
├── index.ts                 ← AiSdkProvider implements ICodingCLI
├── model.ts                 ← config.npm → @ai-sdk adapter (required model)
├── tool-mapping.ts (+test)  ← canonical → AI SDK tool set
├── tools/
│   ├── bash.ts  read.ts  write.ts  edit.ts  search.ts  web.ts
├── mcp.ts (+test)           ← ResolvedMcpInstance[] → AI SDK MCP clients + merged tools
├── skills.ts                ← ResolvedSkillPackage[] → system-prompt + Skill tool
├── structured.ts            ← outputSchema → Output.object(jsonSchema(...)); result mapping
├── operations/
│   ├── scan-repos.ts  checkout-repo.ts  run-custom-prompt.ts (+test)
└── utils/
    └── sdk-logger.ts (+test) ← AI SDK callbacks → onLog one-liners
```

`packages/core/src/registries/aisdk-packages.ts` — the shared package allow-list.

## 4. Model loading

Model is **required** (no default — the vendor must be known). Resolution is
driven entirely by `CodingModelConfig` (the existing type — no schema change):

- `config.npm` — which `@ai-sdk/*` adapter (default `@ai-sdk/openai-compatible`)
- `config.baseUrl` — endpoint override (required for `openai-compatible`)
- `config.apiKeySlot` — secret slot holding the API key

`model.ts` dynamic-imports `config.npm` and instantiates via a small factory
registry (each `@ai-sdk/*` package exports a differently-named factory):

```ts
const mod = await import(config.npm);
const apiKey  = config.apiKeySlot ? env[config.apiKeySlot] : undefined;
const baseURL = config.baseUrl;
const provider = LOADERS[config.npm](mod, { apiKey, baseURL });  // see registry
const model = provider(modelId);   // → AI SDK LanguageModel
```

```ts
const LOADERS = {
  "@ai-sdk/anthropic":         (m, o) => m.createAnthropic({ apiKey: o.apiKey, baseURL: o.baseURL }),
  "@ai-sdk/openai":            (m, o) => m.createOpenAI({ apiKey: o.apiKey, baseURL: o.baseURL }),
  "@ai-sdk/google":            (m, o) => m.createGoogleGenerativeAI({ apiKey: o.apiKey, baseURL: o.baseURL }),
  "@ai-sdk/openai-compatible": (m, o) => m.createOpenAICompatible({ name: "custom", baseURL: o.baseURL, apiKey: o.apiKey }),
};
```

The registry **is** the allow-list. `config.npm` not in it (or dep not bundled) →
clear `ConfigurationError`, never a silent network install. Missing model →
`ConfigurationError`.

### Pre-bundled packages (the allow-list)

`@ai-sdk/*` packages are **not installed at runtime**. They are declared in
`agent-runtime`'s `package.json` and baked into the runner image at build time;
`config.npm` only *selects* among them. `@ai-sdk/openai-compatible` + a
`baseUrl` covers all local/gateway/Azure cases, so the bundle stays small:

```ts
// packages/core/src/registries/aisdk-packages.ts
export interface AiSdkPackage { npm: string; label: string; requiresBaseUrl?: boolean; }
export const AISDK_PROVIDER_PACKAGES: AiSdkPackage[] = [
  { npm: "@ai-sdk/anthropic",         label: "Anthropic (Claude)" },
  { npm: "@ai-sdk/openai",            label: "OpenAI (GPT)" },
  { npm: "@ai-sdk/google",            label: "Google (Gemini)" },
  { npm: "@ai-sdk/openai-compatible", label: "OpenAI-compatible (local / gateway / Azure)", requiresBaseUrl: true },
];
```

Adding a new *model* within the bundled set = a DB row (no code, no rebuild).
Adding a new *vendor package* = one dep line + runner image rebuild (no code).

## 5. Tools

Each canonical tool (`CANONICAL_TOOLS`) maps to an AI SDK `tool({ description,
inputSchema, execute })`:

- `bash` → spawn with `cwd`, `opts.env` injection, timeout, output capture,
  `abortSignal` (reuse the sandbox patterns used by other providers) — the
  largest piece
- `read` / `write` / `edit` → `fs` wrappers
- `search` → ripgrep (`grep` + `glob` semantics)
- `web-fetch` → fetch + extract
- `web-search` → **deferred** (needs a backend choice) → mapped to unsupported

`tool-mapping.ts` (`AISDK_TOOL_MAP` / which `tool()` defs to include) follows the
per-provider pattern in `providers/tool-maps.ts`. Empty/undefined tool list →
pure-prompt step (no tools), same as Claude.

## 6. Structured output (Claude-parity)

`generateText` runs the tool loop and returns a schema-valid object in one call:

```ts
const { output, text, steps } = await generateText({
  model, prompt: fullPrompt, tools, abortSignal,
  stopWhen: stepCountIs(STEP_CAP),
  ...(outputMode === "structured"
      ? { output: Output.object({ schema: jsonSchema(opts.outputSchema) }) }
      : {}),
  onStepFinish, experimental_onToolCallStart, experimental_onToolCallFinish,
});
```

Result mapping → `RunCustomPromptResult`:
- `none` → `{ sessionId }`
- `text` → `{ sessionId, result: text }`
- `structured` → `{ sessionId, structured: output }` (schema-enforced; no salvage)

`outputMode === "structured"` without `outputSchema` → error, same as Claude.

## 7. MCP bridge

`mcp.ts`: for each `ResolvedMcpInstance`, `experimental_createMCPClient` with the
right transport — stdio (`command`/`args`/`env`), http/sse (`url` + headers from
`env`, `AUTHORIZATION` → `Authorization`). Merge each client's tools into the
`tools` map under `mcp__<name>__*`, name-collision-suffixed (`-2`, `-3`) like the
OpenCode adapter. Close all clients in a `finally`. (Resources/prompts optional,
later.)

## 8. Skills (emulation)

`skills.ts`: read each enabled skill's `SKILL.md` from
`ResolvedSkillPackage.localPath`; inject a system-prompt fragment listing
available skills (name + description, scoped to `enabledSkills`, reusing the
`buildSkillSystemPrompt` shape); expose a `Skill` tool that returns a named
skill's full body on demand (lazy disclosure). The model runs any bundled scripts
via the `bash`/`read` tools using the skill's absolute path.

Known limitation: auto-triggering reliability depends on prompt + model strength
(native Claude skills are tuned); behavior is equivalent for the common case.

## 9. Interactive logging (Claude-parity)

`utils/sdk-logger.ts` maps AI SDK callbacks to `onLog`, gated by `AgentLogLevel`
exactly like the Claude `sdk-logger`:

- tool-call start → `🔧 tool: name(args)` (level ≥ medium)
- tool-call finish → `📥 tool_result: ok/error (N chars)` (level all)
- step text → `🤖 assistant: …` (level all)
- final → `✅ result: success` / `❌ result: <reason>` (level ≥ light)

Writes to the same `onLog` channel the Claude provider uses, so `aisdk` steps
stream live in the run viewer with no UI changes.

## 10. scanRepos / checkoutRepo

Deterministic workspace ops (no LLM) — reuse the same provider-independent
clone/scan/checkout used by the other providers; thin wrappers.

## 11. Wiring into the existing system

1. **`provider-catalog.ts`** — add
   `{ kind:"coding-cli", value:"aisdk", label:"AI SDK (multi-model)", implemented:true, slots:[] }`.
2. **`factory.ts`** — `case "aisdk": return new AiSdkProvider(...)`.
3. **`tool-maps.ts`** — add `aisdk: AISDK_TOOL_MAP`, extend `ProviderId`.
4. **`validate-config.ts`** — extend (currently `opencode`-only) to validate
   `aisdk`: `npm` ∈ allow-list; `baseUrl` required when `npm ===
   "@ai-sdk/openai-compatible"`; `apiKeySlot` shape.
5. **Slot surfacing** — generalize `openCodeModelSlots` → `codingModelSlots`
   (it only reads `apiKeySlot`); update the two `=== "opencode"`-gated call sites
   ([RequiredSecretsTab.tsx](../../../packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx),
   [flows.ts](../../../packages/api-server/src/routes/flows.ts)) to also cover
   `aisdk`. The runtime handler already calls it unconditionally.
   Net behavior: a step shows exactly the key slot(s) its model declares, and
   nothing for keyless models.
6. **Admin form** ([AdminCodingModelsPage.tsx](../../../packages/web/src/routes/AdminCodingModelsPage.tsx))
   — widen the three `provider === "opencode"` gates (Authentication, Custom
   endpoint, Model-ID tooltip) to include `aisdk`; make the **npm package** field
   a `<select>` of `AISDK_PROVIDER_PACKAGES` for `aisdk` (free-text stays for
   OpenCode); mark Base URL required when the selected package
   `requiresBaseUrl`. The Provider dropdown auto-includes the new entry.
7. **Packaging** — add `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`,
   `@ai-sdk/google`, `@ai-sdk/openai-compatible` to `agent-runtime` deps and the
   esbuild `--external` list (same pattern as the existing SDKs). Fully
   in-process.

## 12. Testing (TDD)

Unit tests mirroring the other providers: model-parse + factory registry,
tool-mapping, each tool (bash/read/write/edit/search/web), MCP merge (mock
client), structured mapping, sdk-logger event mapping, run-custom-prompt (mock
`generateText`). Plus validate-config and slot-surfacing tests.

## 13. Limitations vs the Claude provider (accepted)

1. **No auto-compaction.** AI SDK does not auto-summarize a full context window;
   v1 bounds the loop with `stopWhen: stepCountIs(N)`. Fine for bounded
   ticket→code→PR; very long tasks stop at the cap. Real compaction is a later
   add.
2. **`web-search` not shipped in v1** — needs a backend (search API or MCP search
   server). `web-fetch` ships; `web-search` maps to unsupported until chosen.
3. **Skills emulated, not native** — injected `SKILL.md` + a `Skill` tool rather
   than a built-in plugin system; equivalent for the common case, slightly less
   automatic triggering on weaker models.

Everything else is full parity with Claude.

## 14. Effort

~10–11 days: provider+run (1) · tools (2.5) · model loader (1) · MCP (0.5–1) ·
skills (1) · structured (0.5) · logging (0.5) · wiring (1.5) · tests (2).

## 15. Open decisions deferred to the plan

- Structured-output **step cap** value (`STEP_CAP`) default.
- Whether `web-fetch` ships in v1 or is deferred with `web-search`.
- Exact `@ai-sdk/*` versions to pin.
