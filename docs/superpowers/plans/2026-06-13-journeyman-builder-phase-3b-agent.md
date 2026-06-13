# Journeyman Builder — Phase 3b: The Agent (LLM brain) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Builder conversational: an env-configured, provider-agnostic LLM that (per turn) reads the injected context, either asks a clarifying question or calls a `proposePlan` tool, and — when it proposes — assembles + returns a `BuildPlan`. Exposed over an SSE chat route that persists the conversation and the latest plan to the session.

**Architecture:** The deterministic, testable engine lives in `@journeyman/builder/src/agent/`: the env **model factory** (`ai` + `@ai-sdk/*`, dynamic-imported), the **prompt assembly** (static system prompt + serialized context), the **`AssemblerIntent` zod schema**, and a **runner** (`runBuilderTurn`) that takes an injected `BuilderModelCaller` so it's unit-testable with a fake model. The real `makeAiSdkCaller` (generateText + `proposePlan` tool) and the **SSE chat route** (api-server) are integration glue — typecheck-verified; running them needs the `BUILDER_LLM_*` env vars.

**Tech Stack:** TypeScript (ESM), `ai`@6 + `@ai-sdk/*`, `zod`@4, Fastify SSE, Vitest.

**Constraints (from the user):** **No `git commit` steps.** **Final step is `npm run check`.** Each task ends by running its tests.

**Reference:** Spec `docs/superpowers/specs/2026-06-13-journeyman-builder-design.md` ("Builder instructions & prompt strategy", "LLM layer"). Builds on Phase 2a (`AssemblerIntent`, `assemble`), Phase 3a (serializers).

**Verified contracts:**
- Model factory mirrors agent-runtime's `resolveModel`: pick `@ai-sdk/*` by npm name, `createOpenAI/createAnthropic/createGoogleGenerativeAI/createOpenAICompatible({ apiKey, baseURL })`, dynamic `import(npm)`. `BUILDER_LLM_PROVIDER` is the **npm package name** (e.g. `@ai-sdk/openai`).
- Generation: `generateText({ model, system, messages, tools, stopWhen: stepCountIs(n) })`; a tool is `tool({ description, inputSchema, execute })`; read `result.text`.
- SSE: `openSseStream(reply)` from `../sse/sse-stream.ts`; route takes `(app, c: Composition)`, registered in the `/api`-prefix block; heartbeat via `setInterval(() => stream.ping(), 15_000)`, cleanup on `reply.raw.on("close")`.
- Inventory list fns: `listCustomAiSteps(pool,orgId,userId)`, `listMcpInstances(...)`, `listSkillPackages(...)`, `listVisibleSandboxes(pool,orgId,userId)`, `new PostgresWebhookStore(pool).listByScope({userId})` (from `@journeyman/orchestrator`), `listPresets()`.

---

## File Structure (Phase 3b)

**Create:**
- `packages/builder/src/agent/intent-schema.ts` — zod schema for `AssemblerIntent` (+ `newCustomSteps`)
- `packages/builder/src/agent/intent-schema.test.ts`
- `packages/builder/src/agent/prompt.ts` — `buildSystemPrompt()` + `buildContextMessage(parts)`
- `packages/builder/src/agent/prompt.test.ts`
- `packages/builder/src/agent/model.ts` — `resolveBuilderModel(env, deps)` + `builderLlmEnvFromProcess()`
- `packages/builder/src/agent/model.test.ts`
- `packages/builder/src/agent/runner.ts` — `runBuilderTurn`, `planFromIntent`, `makeAiSdkCaller`, types
- `packages/builder/src/agent/runner.test.ts`
- `packages/api-server/src/routes/builder-chat.ts` — SSE chat route + inventory loader

**Modify:**
- `packages/builder/package.json` — add `ai`, `@ai-sdk/*`, `zod`
- `packages/builder/src/assembler/intent.ts` — add `newCustomSteps?` to `AssemblerIntent`
- `packages/builder/src/index.ts` — export the agent surface
- `packages/api-server/src/server.ts` — register the chat route

---

## Task 1: Deps + intent zod schema (+ `newCustomSteps`)

**Files:**
- Modify: `packages/builder/package.json`, `packages/builder/src/assembler/intent.ts`
- Create: `packages/builder/src/agent/intent-schema.ts`, `…/intent-schema.test.ts`

- [ ] **Step 1: Add dependencies to `packages/builder/package.json`**

Add to `"dependencies"`:

```json
"@ai-sdk/anthropic": "^2.0.0",
"@ai-sdk/google": "^2.0.0",
"@ai-sdk/openai": "^2.0.0",
"@ai-sdk/openai-compatible": "^1.0.0",
"ai": "^6.0.0",
"zod": "^4"
```

- [ ] **Step 2: Add `newCustomSteps` to `AssemblerIntent`** in `packages/builder/src/assembler/intent.ts`

At the top add the import:
```ts
import type { ProposedCustomStep } from "@journeyman/core";
```
Then add to the `AssemblerIntent` interface (after `gateway`):
```ts
  /** new custom-AI step definitions the plan will create; referenced by steps' customStepId. */
  newCustomSteps?: ProposedCustomStep[];
```

- [ ] **Step 3: Install**

Run: `npm install`
Expected: completes; `ai`, `@ai-sdk/*`, `zod` resolve for `@journeyman/builder`.

- [ ] **Step 4: Write the failing test**

Create `packages/builder/src/agent/intent-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assemblerIntentSchema } from "./intent-schema.ts";

describe("assemblerIntentSchema", () => {
  it("accepts a full intent with a webhook trigger, steps, a gateway, and new custom steps", () => {
    const intent = {
      summary: "Review PRs",
      triggers: [{ kind: "webhook", webhookId: null, listensFor: ["pull_request.opened"],
        inputs: [{ name: "pr", type: "number", fromPath: "$.pull_request.number" }] }],
      steps: [{ ref: "rev", kind: "ai", label: "Review", stepType: "custom-ai", customStepId: "tmp-r",
        tools: ["read-file"], inputs: [{ slot: "diff", value: { from: "workflow-input", name: "pr" } }] }],
      gateway: { ref: "g", label: "ok?", branches: [
        { label: "pass", condition: { left: { from: "step-output", stepRef: "rev", field: "ok" }, op: "==", right: true }, steps: [] },
      ] },
      newCustomSteps: [{ id: "tmp-r", step: { scope: "user", name: "Review", promptTemplate: "Review {{input.diff}}" } }],
    };
    const parsed = assemblerIntentSchema.parse(intent);
    expect(parsed.summary).toBe("Review PRs");
    expect(parsed.steps[0].ref).toBe("rev");
  });

  it("accepts the minimal manual-trigger intent", () => {
    expect(assemblerIntentSchema.parse({ summary: "x", triggers: [{ kind: "manual" }], steps: [] }).triggers[0].kind).toBe("manual");
  });

  it("rejects an intent missing triggers", () => {
    expect(() => assemblerIntentSchema.parse({ summary: "x", steps: [] })).toThrow();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run packages/builder/src/agent/intent-schema.test.ts`
Expected: FAIL — cannot resolve `./intent-schema.ts`.

- [ ] **Step 6: Create `packages/builder/src/agent/intent-schema.ts`**

```ts
import { z } from "zod";

const inputIntent = z.union([
  z.object({ from: z.literal("literal"), value: z.unknown() }),
  z.object({ from: z.literal("workflow-input"), name: z.string() }),
  z.object({ from: z.literal("workflow-attribute"), name: z.string() }),
  z.object({ from: z.literal("step-output"), stepRef: z.string(), field: z.string() }),
  z.object({ from: z.literal("template"), template: z.string() }),
]);

const inputBinding = z.object({ slot: z.string(), value: inputIntent });

const inputType = z.enum(["string", "number", "boolean", "json-object", "json-array"]);
const webhookInput = z.object({ name: z.string(), type: inputType, fromPath: z.string() });

const trigger = z.union([
  z.object({ kind: z.literal("manual") }),
  z.object({ kind: z.literal("webhook"), webhookId: z.string().nullable(),
    listensFor: z.array(z.string()).optional(), inputs: z.array(webhookInput).optional() }),
  z.object({ kind: z.literal("form"), inputs: z.array(webhookInput).optional() }),
]);

const secretBinding = z.object({ slot: z.string(), secretName: z.string().nullable() });

const stepIntent = z.object({
  ref: z.string(),
  kind: z.enum(["provider", "ai", "human-task", "webhook-wait"]),
  label: z.string(),
  stepType: z.string().optional(),
  customStepId: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  mcpIds: z.array(z.string()).optional(),
  skillIds: z.array(z.string()).optional(),
  sandboxId: z.string().optional(),
  connection: z.string().optional(),
  secrets: z.array(secretBinding).optional(),
  inputs: z.array(inputBinding).optional(),
  waitWebhookId: z.string().nullable().optional(),
  assignee: z.string().optional(),
  taskPrompt: z.string().optional(),
});

const condition = z.object({
  left: z.union([
    z.object({ from: z.literal("step-output"), stepRef: z.string(), field: z.string() }),
    z.object({ from: z.literal("workflow-input"), name: z.string() }),
  ]),
  op: z.enum(["==", "!=", "<", "<=", ">", ">="]),
  right: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});

const branch = z.object({ label: z.string(), condition, steps: z.array(stepIntent) });

const gateway = z.object({
  ref: z.string(), label: z.string(),
  branches: z.array(branch),
  elseBranch: z.object({ steps: z.array(stepIntent) }).optional(),
});

const customStepInputField = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "json-object", "json-array", "workspaceDir"]),
  required: z.boolean(),
  description: z.string().optional(),
});
const customStepOutputField = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "json-object", "json-array"]),
  required: z.boolean(),
  description: z.string().optional(),
});
const customStepCreateInput = z.object({
  scope: z.enum(["user", "org"]),
  name: z.string(),
  description: z.string().optional(),
  inputFields: z.array(customStepInputField).optional(),
  outputMode: z.enum(["none", "text", "structured"]).optional(),
  outputFields: z.array(customStepOutputField).optional(),
  promptTemplate: z.string().optional(),
  defaultTools: z.array(z.string()).optional(),
  defaultMcpIds: z.array(z.string()).optional(),
  defaultSkillIds: z.array(z.string()).optional(),
});
const proposedCustomStep = z.object({ id: z.string(), step: customStepCreateInput });

export const assemblerIntentSchema = z.object({
  summary: z.string(),
  triggers: z.array(trigger),
  steps: z.array(stepIntent),
  gateway: gateway.optional(),
  newCustomSteps: z.array(proposedCustomStep).optional(),
  defaults: z.object({ sandboxId: z.string().nullable().optional(), model: z.string().nullable().optional() }).optional(),
});
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run packages/builder/src/agent/intent-schema.test.ts`
Expected: PASS (3 tests).

---

## Task 2: Prompt assembly

**Files:**
- Create: `packages/builder/src/agent/prompt.ts`, `…/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/builder/src/agent/prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildContextMessage } from "./prompt.ts";

describe("buildSystemPrompt", () => {
  it("states the intent contract and the proposePlan tool, and the no-invented-steps rule", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("proposePlan");
    expect(p.toLowerCase()).toContain("only");        // only-real-steps rule
    expect(p.toLowerCase()).toContain("clarify");      // ask clarifying questions
  });
});

describe("buildContextMessage", () => {
  it("includes catalog, providers, node types, and inventory sections", () => {
    const msg = buildContextMessage({
      catalog: "Available step types:\n- get-issue",
      providers: "Implemented providers:\n  git-provider: github",
      nodeTypes: "Supported node types: step, gateway-xor",
      inventory: "Your existing custom steps:\n  (none)",
    });
    expect(msg).toContain("get-issue");
    expect(msg).toContain("github");
    expect(msg).toContain("gateway-xor");
    expect(msg).toContain("custom steps");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/builder/src/agent/prompt.test.ts`
Expected: FAIL — cannot resolve `./prompt.ts`.

- [ ] **Step 3: Create `packages/builder/src/agent/prompt.ts`**

```ts
/** The Builder's static system prompt (its rulebook). */
export function buildSystemPrompt(): string {
  return [
    "You are the Journeyman Builder. You turn a user's goal into a workflow plan.",
    "",
    "How you work:",
    "- Ask clarifying questions ONE at a time until you understand the goal. Reply in plain language.",
    "- You do NOT write graph JSON, node ids, reference strings, or JSONPath. You express INTENT; a deterministic assembler emits the wiring.",
    "- When you have enough information, call the `proposePlan` tool with the full intent. Otherwise just reply with your question.",
    "",
    "Hard rules:",
    "- Use ONLY step types, providers, and node types listed in the context message. Never invent one.",
    "- Only propose a provider step whose provider is in the implemented-providers list. If the goal needs an unavailable provider, prefer an implemented alternative and say so, or describe it as a gap.",
    "- If an action has no step type, route it through a custom-AI step (define it in newCustomSteps) using tools/an MCP, or describe it as a gap.",
    "- Reuse an existing custom step when one closely matches; only define a new one when needed.",
    "- A coding step that is followed by opening a PR/MR must also commit and push (say so in its prompt).",
    "- For Jira/ticket status changes, ask the user for the exact status names (do not guess).",
    "- In-flow error branches do not run; for failure handling offer retry or an out-of-band alert.",
    "- Mark steps that touch production or hold broad credentials as risky and suggest a human-task gate before irreversible actions.",
  ].join("\n");
}

export interface ContextParts {
  catalog: string;
  providers: string;
  nodeTypes: string;
  inventory: string;
}

/** The dynamic context injected each turn (what actually exists right now). */
export function buildContextMessage(parts: ContextParts): string {
  return [
    "# Current Journeyman context (authoritative — build only on these)",
    "",
    parts.catalog,
    "",
    parts.providers,
    "",
    parts.nodeTypes,
    "",
    "# Your existing inventory (select from these; flag anything missing as a gap)",
    parts.inventory,
  ].join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/builder/src/agent/prompt.test.ts`
Expected: PASS (2 tests).

---

## Task 3: Env model factory

**Files:**
- Create: `packages/builder/src/agent/model.ts`, `…/model.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/builder/src/agent/model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveBuilderModel } from "./model.ts";

function fakeImporter() {
  const calls: any[] = [];
  const make = (name: string) => (opts: any) => {
    calls.push({ name, opts });
    return (modelId: string) => ({ provider: name, modelId, opts });
  };
  const importer = async (_npm: string) => ({
    createOpenAI: make("openai"),
    createAnthropic: make("anthropic"),
    createGoogleGenerativeAI: make("google"),
    createOpenAICompatible: make("compat"),
  });
  return { importer, calls };
}

describe("resolveBuilderModel", () => {
  it("builds an OpenAI model, passing apiKey/baseURL", async () => {
    const { importer, calls } = fakeImporter();
    const m: any = await resolveBuilderModel(
      { provider: "@ai-sdk/openai", model: "gpt-4o", apiKey: "k", baseUrl: "http://x" }, { importer });
    expect(m.provider).toBe("openai");
    expect(m.modelId).toBe("gpt-4o");
    expect(calls[0].opts).toEqual({ apiKey: "k", baseURL: "http://x" });
  });

  it("rejects an unknown provider package", async () => {
    await expect(resolveBuilderModel({ provider: "openai", model: "x" }, {} as never)).rejects.toThrow();
  });

  it("requires a model id", async () => {
    const { importer } = fakeImporter();
    await expect(resolveBuilderModel({ provider: "@ai-sdk/openai" }, { importer })).rejects.toThrow(/model/i);
  });

  it("requires baseUrl for the openai-compatible package", async () => {
    const { importer } = fakeImporter();
    await expect(resolveBuilderModel({ provider: "@ai-sdk/openai-compatible", model: "x" }, { importer })).rejects.toThrow(/baseUrl|base url/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/builder/src/agent/model.test.ts`
Expected: FAIL — cannot resolve `./model.ts`.

- [ ] **Step 3: Create `packages/builder/src/agent/model.ts`**

```ts
import { AISDK_PROVIDER_PACKAGES, isAiSdkPackage } from "@journeyman/core";

type Factory = (mod: any, o: { apiKey?: string; baseURL?: string }) => (modelId: string) => unknown;

const LOADERS: Record<string, Factory> = {
  "@ai-sdk/anthropic":         (m, o) => m.createAnthropic({ apiKey: o.apiKey, baseURL: o.baseURL }),
  "@ai-sdk/openai":            (m, o) => m.createOpenAI({ apiKey: o.apiKey, baseURL: o.baseURL }),
  "@ai-sdk/google":            (m, o) => m.createGoogleGenerativeAI({ apiKey: o.apiKey, baseURL: o.baseURL }),
  "@ai-sdk/openai-compatible": (m, o) => m.createOpenAICompatible({ name: "builder", baseURL: o.baseURL, apiKey: o.apiKey, supportsStructuredOutputs: true }),
};

export interface BuilderLlmEnv {
  provider?: string; // an @ai-sdk/* npm package name
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface ResolveModelDeps {
  importer?: (npm: string) => Promise<any>;
}

/** Build a provider-agnostic AI-SDK model from BUILDER_LLM_* config. */
export async function resolveBuilderModel(env: BuilderLlmEnv, deps: ResolveModelDeps = {}): Promise<unknown> {
  const npm = env.provider;
  if (!npm || !isAiSdkPackage(npm) || !LOADERS[npm]) {
    throw new Error(`BUILDER_LLM_PROVIDER must be one of: ${AISDK_PROVIDER_PACKAGES.map((p) => p.npm).join(", ")}`);
  }
  if (!env.model) throw new Error("BUILDER_LLM_MODEL is required");
  if (npm === "@ai-sdk/openai-compatible" && !env.baseUrl?.trim()) {
    throw new Error("@ai-sdk/openai-compatible requires BUILDER_LLM_BASE_URL");
  }
  const importer = deps.importer ?? ((n: string) => import(n));
  let mod: any;
  try {
    mod = await importer(npm);
  } catch {
    throw new Error(`Builder LLM provider package not installed: ${npm}`);
  }
  return LOADERS[npm](mod, { apiKey: env.apiKey, baseURL: env.baseUrl })(env.model);
}

export function builderLlmEnvFromProcess(): BuilderLlmEnv {
  return {
    provider: process.env.BUILDER_LLM_PROVIDER,
    model: process.env.BUILDER_LLM_MODEL,
    apiKey: process.env.BUILDER_LLM_API_KEY,
    baseUrl: process.env.BUILDER_LLM_BASE_URL,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/builder/src/agent/model.test.ts`
Expected: PASS (4 tests).

---

## Task 4: The runner + the real AI-SDK caller

**Files:**
- Create: `packages/builder/src/agent/runner.ts`, `…/runner.test.ts`
- Modify: `packages/builder/src/index.ts`

- [ ] **Step 1: Write the failing test (runner with a fake caller)**

Create `packages/builder/src/agent/runner.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runBuilderTurn, planFromIntent, type BuilderModelCaller } from "./runner.ts";
import type { AssemblerIntent } from "../assembler/intent.ts";

const intent: AssemblerIntent = {
  summary: "Get a ticket",
  triggers: [{ kind: "manual" }],
  steps: [{ ref: "g", kind: "provider", label: "Get", stepType: "get-issue", provider: "jira" }],
  newCustomSteps: [{ id: "tmp", step: { scope: "user", name: "X" } }],
};

describe("runBuilderTurn", () => {
  it("returns just an assistant message when the model asks a question", async () => {
    const caller: BuilderModelCaller = { call: async () => ({ text: "Which repo?", proposedIntent: null }) };
    const res = await runBuilderTurn({ caller }, { system: "s", messages: [{ role: "user", content: "hi" }] });
    expect(res.assistantMessage).toBe("Which repo?");
    expect(res.plan).toBeNull();
  });

  it("assembles a plan when the model proposes an intent", async () => {
    const caller: BuilderModelCaller = { call: async () => ({ text: "Here's the plan.", proposedIntent: intent }) };
    const res = await runBuilderTurn({ caller }, { system: "s", messages: [{ role: "user", content: "go" }] });
    expect(res.plan).not.toBeNull();
    expect(res.plan!.summary).toBe("Get a ticket");
    expect(res.plan!.newCustomSteps).toHaveLength(1);
    expect(res.plan!.workflow.nodes.some((n) => n.stepType === "get-issue")).toBe(true);
  });
});

describe("planFromIntent", () => {
  it("carries newCustomSteps and summary through to the plan", () => {
    const plan = planFromIntent(intent);
    expect(plan.newCustomSteps[0].id).toBe("tmp");
    expect(plan.summary).toBe("Get a ticket");
    expect(Array.isArray(plan.gaps)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/builder/src/agent/runner.test.ts`
Expected: FAIL — cannot resolve `./runner.ts`.

- [ ] **Step 3: Create `packages/builder/src/agent/runner.ts`**

```ts
import { generateText, tool, stepCountIs } from "ai";
import type { BuildPlan } from "@journeyman/core";
import type { AssemblerIntent } from "../assembler/intent.ts";
import { assemble } from "../assembler/assemble.ts";
import { assemblerIntentSchema } from "./intent-schema.ts";

export interface ChatMessage { role: "user" | "assistant"; content: string; }

export interface BuilderModelCaller {
  call(req: { system: string; messages: ChatMessage[] }): Promise<{ text: string; proposedIntent: AssemblerIntent | null }>;
}

export interface BuilderTurnResult {
  assistantMessage: string;
  plan: BuildPlan | null;
}

/** Assemble a full BuildPlan from a proposed intent. */
export function planFromIntent(intent: AssemblerIntent): BuildPlan {
  const { workflow, stepBindings, gaps } = assemble(intent);
  return {
    newCustomSteps: intent.newCustomSteps ?? [],
    workflow,
    defaults: { sandboxId: intent.defaults?.sandboxId ?? null, model: intent.defaults?.model ?? null },
    stepBindings,
    gaps,
    summary: intent.summary,
  };
}

/** Run one conversational turn: model → (question | proposed plan). */
export async function runBuilderTurn(
  deps: { caller: BuilderModelCaller },
  input: { system: string; messages: ChatMessage[] },
): Promise<BuilderTurnResult> {
  const { text, proposedIntent } = await deps.caller.call(input);
  return { assistantMessage: text, plan: proposedIntent ? planFromIntent(proposedIntent) : null };
}

/** The real caller: generateText with a proposePlan tool that captures the intent. */
export function makeAiSdkCaller(model: unknown): BuilderModelCaller {
  return {
    async call({ system, messages }) {
      let captured: AssemblerIntent | null = null;
      const proposePlan = tool({
        description: "Propose the complete workflow plan. Call this ONLY when you have enough information to build a correct plan.",
        inputSchema: assemblerIntentSchema,
        execute: async (intent: unknown) => {
          captured = intent as AssemblerIntent;
          return "Plan received.";
        },
      });
      const result = await generateText({
        model: model as never,
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        tools: { proposePlan },
        stopWhen: stepCountIs(6),
      } as never);
      return { text: (result as { text?: string }).text ?? "", proposedIntent: captured };
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/builder/src/agent/runner.test.ts`
Expected: PASS (3 tests). (The fake caller path is exercised; `makeAiSdkCaller` is covered by typecheck — running it needs a live model.)

- [ ] **Step 5: Export the agent surface from `packages/builder/src/index.ts`**

```ts
export { buildSystemPrompt, buildContextMessage, type ContextParts } from "./agent/prompt.ts";
export { resolveBuilderModel, builderLlmEnvFromProcess, type BuilderLlmEnv } from "./agent/model.ts";
export {
  runBuilderTurn, planFromIntent, makeAiSdkCaller,
  type BuilderModelCaller, type ChatMessage, type BuilderTurnResult,
} from "./agent/runner.ts";
export { assemblerIntentSchema } from "./agent/intent-schema.ts";
```

- [ ] **Step 6: Run the whole builder package's tests**

Run: `npm test -w @journeyman/builder`
Expected: PASS — all prior suites + intent-schema, prompt, model, runner.

---

## Task 5: The SSE chat route (api-server)

**Files:**
- Create: `packages/api-server/src/routes/builder-chat.ts`
- Modify: `packages/api-server/src/server.ts`

- [ ] **Step 1: Create `packages/api-server/src/routes/builder-chat.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { makeRequireAuth } from "@journeyman/identity";
import { listCustomAiSteps } from "@journeyman/custom-steps";
import { listMcpInstances } from "@journeyman/mcp";
import { listSkillPackages } from "@journeyman/skills";
import { listVisibleSandboxes } from "@journeyman/sandbox";
import { PostgresWebhookStore } from "@journeyman/orchestrator";
import { listPresets } from "@journeyman/webhooks";
import { stepCatalog } from "@journeyman/steps/catalog";
import {
  PROVIDER_CATALOG, listSupportedNodeTypes, type BuildPlan,
} from "@journeyman/core";
import {
  getBuilderSession, updateBuilderSession,
  serializeStepCatalog, serializeProviders, serializeNodeTypes, serializeInventory,
  buildSystemPrompt, buildContextMessage,
  resolveBuilderModel, builderLlmEnvFromProcess, makeAiSdkCaller, runBuilderTurn,
  type ChatMessage, type InventorySummary,
} from "@journeyman/builder";
import type { Composition } from "../composition.ts";
import { openSseStream } from "../sse/sse-stream.ts";

const PING_MS = 15_000;

async function loadInventory(c: Composition, orgId: string, userId: string): Promise<InventorySummary> {
  const pool = c.pool!;
  const [customSteps, mcps, skills, sandboxes] = await Promise.all([
    listCustomAiSteps(pool, orgId, userId),
    listMcpInstances(pool, orgId, userId),
    listSkillPackages(pool, orgId, userId),
    listVisibleSandboxes(pool, orgId, userId),
  ]);
  const webhooks = await new PostgresWebhookStore(pool).listByScope({ userId });
  return {
    customSteps: customSteps.map((s) => ({ id: s.id, name: s.name, description: s.description })),
    mcps: mcps.map((m) => ({ id: m.id, name: m.name })),
    skills: skills.map((s) => ({ id: s.id, name: s.name })),
    sandboxes: sandboxes.map((s) => ({ id: s.id, name: s.name, type: s.type, tags: s.tags })),
    webhooks: webhooks.map((w) => ({ id: w.id, name: w.name ?? w.id, preset: w.preset })),
  };
}

function buildContext(inventory: InventorySummary): string {
  const catalog = serializeStepCatalog(stepCatalog.map((s) => ({
    stepType: s.stepType, label: s.label, category: s.category,
    inputs: Object.keys(s.inputFields ?? {}),
    outputs: Object.keys(s.outputSchema ?? {}),
  })));
  const providers = serializeProviders(
    PROVIDER_CATALOG.filter((p) => p.implemented).map((p) => ({ kind: p.kind, value: p.value, label: p.label })),
  );
  const nodeTypes = serializeNodeTypes(listSupportedNodeTypes());
  return buildContextMessage({ catalog, providers, nodeTypes, inventory: serializeInventory(inventory) });
}

export function registerBuilderChatRoute(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });

  app.post("/orgs/:orgId/users/me/builder/sessions/:id/messages",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as { message?: string };
      if (!body?.message) return reply.code(400).send({ error: "message is required" });

      const session = await getBuilderSession(c.pool!, id, orgId, ctx.user.id);
      if (!session) return reply.code(404).send({ error: "Not found" });

      const stream = openSseStream(reply);
      const ping = setInterval(() => stream.ping(), PING_MS);
      let closed = false;
      reply.raw.on("close", () => { closed = true; clearInterval(ping); });

      try {
        const history = (session.messages as ChatMessage[]) ?? [];
        const messages: ChatMessage[] = [...history, { role: "user", content: body.message }];

        const model = await resolveBuilderModel(builderLlmEnvFromProcess());
        const inventory = await loadInventory(c, orgId, ctx.user.id);
        const system = `${buildSystemPrompt()}\n\n${buildContext(inventory)}`;

        const { assistantMessage, plan } = await runBuilderTurn(
          { caller: makeAiSdkCaller(model) },
          { system, messages },
        );
        if (closed) return;

        stream.send({ event: "assistant", data: { message: assistantMessage } });
        if (plan) stream.send({ event: "plan", data: plan as BuildPlan });

        const newMessages: ChatMessage[] = [...messages, { role: "assistant", content: assistantMessage }];
        await updateBuilderSession(c.pool!, {
          id, orgId, userId: ctx.user.id,
          messages: newMessages,
          buildPlan: plan ?? undefined,
        });
        stream.send({ event: "done", data: { ok: true } });
      } catch (err) {
        if (!closed) stream.send({ event: "error", data: { message: (err as Error).message } });
      } finally {
        clearInterval(ping);
        await stream.close();
      }
    });
}
```

- [ ] **Step 2: Register the route in `packages/api-server/src/server.ts`**

Add the import near the other route imports:
```ts
import { registerBuilderChatRoute } from "./routes/builder-chat.ts";
```
Add inside the `/api`-prefix `app.register` block (next to `registerBuilderApplyRoute(s, c)`):
```ts
    registerBuilderChatRoute(s, c);
```

- [ ] **Step 3: Typecheck the api-server package**

Run: `npm run typecheck -w @journeyman/api-server`
Expected: PASS. If a record field name differs (e.g. `Webhook.name`/`.preset`, `Sandbox.tags`), adjust the `loadInventory` mapping to the real field and re-run. (This route is integration-level — runtime behavior needs the `BUILDER_LLM_*` env vars + a DB; its wiring is verified by typecheck, the runner's unit tests, and the model-factory tests.)

---

## Final: Typecheck the whole repo (no commit)

- [ ] **Step 1: Run the full type + import-boundary check**

Run: `npm run check`
Expected: PASS — `npm run typecheck` (all workspaces) and `npm run check:boundaries`. If boundaries flags `@journeyman/builder` importing `ai`/`@ai-sdk/*`/`zod` (external) or `@journeyman/api-server` importing the inventory packages, those are allowed (external deps / already-depended lower layers). If it flags `@journeyman/builder → @journeyman/orchestrator` or similar internal edge, resolve by keeping that import in api-server only (the chat route already imports `PostgresWebhookStore` in api-server, not builder). **Do not commit.**

---

## How to run it end-to-end (manual, needs a key)

Set env on the api-server process, then create a session and POST a message:
```
BUILDER_LLM_PROVIDER=@ai-sdk/anthropic
BUILDER_LLM_MODEL=claude-...           # a real model id for the provider
BUILDER_LLM_API_KEY=sk-...
# BUILDER_LLM_BASE_URL=...             # only for @ai-sdk/openai-compatible
```
`POST /api/orgs/:orgId/users/me/builder/sessions` → `{id}`; then SSE `POST …/sessions/:id/messages {"message":"review my PRs for security"}` → streams `assistant` + `plan` events; then `POST …/sessions/:id/apply` (Phase 3a) creates the draft flow.

---

## Self-review checklist (run before handoff)

- **Spec coverage (Phase 3b):** env model factory ✓ (Task 3); system prompt embodying the behavioral rules + dynamic context injection ✓ (Task 2); `proposePlan` tool + `AssemblerIntent` schema (incl. `newCustomSteps`) ✓ (Tasks 1, 4); agent runner producing a `BuildPlan` ✓ (Task 4); SSE chat route persisting messages + plan ✓ (Task 5).
- **No placeholders:** complete code in every step; commands + expected results on every run step.
- **Type consistency:** `AssemblerIntent.newCustomSteps` added (Task 1) and consumed by `planFromIntent`; `BuilderModelCaller` defined once and used by runner + `makeAiSdkCaller`; `InventorySummary` shape matches the serializer (Phase 3a).
- **Testability honesty:** factory mapping, prompt assembly, runner glue, and schema are unit-tested with fakes; the live LLM call (`makeAiSdkCaller`) and the SSE route are typecheck-verified and need the `BUILDER_LLM_*` key to run.
- **No commit steps anywhere; final step is `npm run check`.** ✓

> **Phase 4 (next):** the web page — split-view chat + live plan preview (step cards, ⇄ I/O reveal, inline gaps, light edits), consuming the SSE `assistant`/`plan` events and the apply endpoint.
