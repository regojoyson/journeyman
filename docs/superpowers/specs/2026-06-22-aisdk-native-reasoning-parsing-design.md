# aisdk native reasoning parsing — design

**Date:** 2026-06-22
**Status:** approved (brainstorming) → ready for implementation plan
**Package:** `@journeyman/agent-runtime` (aisdk provider)

## Problem

Structured-output steps on the `aisdk` provider currently clean reasoning-model
output with a hand-rolled regex, `extractJsonPayload` (in
[structured.ts](../../../packages/agent-runtime/src/providers/aisdk/structured.ts)),
wired via `extractJsonMiddleware({ transform: extractJsonPayload })`. It strips
`<think>…</think>`, pulls the last ```json fence, and finds the first balanced
JSON object.

Empirical testing this session (MiniMax-M3 over `@ai-sdk/openai-compatible`,
`api.minimax.io`) established:

- The SDK **does** send `response_format: { type: "json_schema" }` correctly.
- **MiniMax-M3 ignores `response_format` entirely** — it returns
  `<think>…</think>` + prose, never native structured output. This is a model-server
  limitation, not an SDK bug.
- The AI SDK ships a **native** `extractReasoningMiddleware({ tagName })` that
  splits reasoning tags out of the content channel into a separate `reasoning`
  field — the supported way to handle reasoning models.

**Decision:** the user is switching to a model that supports structured schema
natively (honors `response_format`). Given that, we replace the bespoke regex
with the SDK-native reasoning middleware and drop the prompt-stuffing fallback,
keeping only a cheap schema-validation guard.

## Goals

1. Strip reasoning wrappers using the SDK-native `extractReasoningMiddleware`,
   not custom regex.
2. Cover the common reasoning tags across model families: `<think>`,
   `<thinking>`, `<reasoning>`.
3. Remove the hand-rolled `extractJsonPayload` and the schema-restating forced
   turn added earlier this session.
4. Keep the `missingRequiredKeys` schema-validation guard (correctness, not
   prompt-stuffing).

## Non-goals

- Recovering JSON wrapped in ```json fences or surrounded by prose. **Accepted
  limitation** — we rely on the new (schema-supporting) model emitting clean JSON
  after its reasoning block. If a future model fences its JSON, this regresses;
  documented as known.
- Streaming structured output (the provider uses non-streaming `generateText`).
- Changes to any non-aisdk provider.

## Design

### 1. `structured.ts` — parsing layer

Remove `extractJsonPayload`, `findBalancedJson`, `lastFencedBlock`,
`stripReasoning`. Rewrite `wrapForStructuredOutput` as a native middleware chain:

```ts
import { Output, jsonSchema, wrapLanguageModel, extractReasoningMiddleware } from "ai";
import type { LanguageModel } from "ai";

export function buildOutput(outputSchema: Record<string, unknown> | undefined) {
  if (!outputSchema) return undefined;
  return Output.object({ schema: jsonSchema(outputSchema) });
}

export function wrapForStructuredOutput(model: LanguageModel): LanguageModel {
  return wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: [
      extractReasoningMiddleware({ tagName: "think" }),
      extractReasoningMiddleware({ tagName: "thinking" }),
      extractReasoningMiddleware({ tagName: "reasoning" }),
    ],
  });
}
```

The reasoning content lands on the SDK `reasoning` field; the content channel is
left clean for `Output.object`. The chain is a no-op when no matching tag is
present, so it is safe to apply to every structured step regardless of model.

### 2. `run-custom-prompt.ts` — structured flow

- `tryReadStructured`: the text fallback drops `extractJsonPayload` and becomes a
  plain `JSON.parse(finalAssistantText(result))` — the text is already
  reasoning-stripped by the middleware. Still returns `undefined` on parse
  failure (never throws).
- Revert `forceJsonInstruction(schema)` back to the original `FORCE_JSON_INSTRUCTION`
  constant (no schema restated in the prompt). Delete `forceJsonInstruction` and
  `schemaRequiredKeys`'s use inside it (keep `schemaRequiredKeys` only if
  `missingRequiredKeys` still needs it).
- **Keep** the forced-turn mechanism itself (pre-existing safety net for
  tool-using agents that end without JSON) — now invoked with the simple
  instruction.
- **Keep** `missingRequiredKeys` and the validation gate: if the structured
  result is missing required schema keys, force one more turn; if still missing,
  return a diagnosable error naming the missing field(s).

### 3. Tests (`run-custom-prompt.test.ts`)

- **Remove/retarget** `recovers from <think>+fenced JSON when result.output throws`
  — think/fence stripping is no longer our code's responsibility; that text never
  reaches our code in production (the mocked `ai` only made it appear to).
- The bare-text recovery tests (`recovers structured output from result.text`,
  `recovers from the newest non-empty step`) stay — they exercise plain JSON
  recovery, which still applies.
- **Keep** `forces another turn when recovered JSON is missing a required field`
  and `errors naming the missing required field` — still valid with the simple
  forced instruction.
- Update the `forces a final tool-free JSON turn` assertion if it checked for the
  schema text in the forced prompt (it should now assert the plain instruction).
- **Add** a `structured.test.ts` (or extend) asserting `wrapForStructuredOutput`
  wraps the model with the reasoning-middleware chain (mock `wrapLanguageModel`
  and assert it receives an array of three middlewares).

### 4. Cleanup / blast radius

- Grep for `extractJsonPayload` importers before deleting: the opencode provider
  and the scratch `scripts/*probe*.ts` / `scripts/toolloop-agent-structured.ts`.
  The scratch scripts will be updated or deleted; no production code outside the
  aisdk provider should depend on it.
- Update the `aisdk-reasoning-json-parse` memory: fix moved from custom
  `extractJsonPayload` regex → native `extractReasoningMiddleware` chain.

## Risks

- **Chained `extractReasoningMiddleware`**: verify at implementation that three
  instances append cleanly and a no-op tag does not corrupt content. The live
  `scripts/toolloop-agent-structured.ts` test confirms the single-tag case
  end-to-end against a real model.
- **Fenced/prose JSON regression**: accepted and documented (see Non-goals).

## Verification

- `npx vitest run packages/agent-runtime/src/providers/aisdk` green.
- `npx tsc -p packages/agent-runtime/tsconfig.json --noEmit` exit 0.
- Live: a structured custom-ai step on the new model returns a schema-conforming
  object with the declared (incl. hyphenated) keys.
- agent-runtime ships into the sandbox container → requires
  `npm run images:build` / `build:kit` + worker restart to take effect in real
  runs.
