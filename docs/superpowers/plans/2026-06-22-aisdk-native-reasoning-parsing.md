# aisdk Native Reasoning Parsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the aisdk provider's hand-rolled `extractJsonPayload` reasoning/JSON regex with the SDK-native `extractReasoningMiddleware` chain, and drop the schema-restating forced-turn prompt while keeping the schema-validation guard.

**Architecture:** `wrapForStructuredOutput` wraps the model with three chained `extractReasoningMiddleware` instances (`<think>`, `<thinking>`, `<reasoning>`) that peel reasoning into the SDK `reasoning` field, leaving clean JSON in the content channel for `Output.object`. The structured recovery path becomes a plain `JSON.parse` (text is already reasoning-stripped). `missingRequiredKeys` validation stays as a correctness guard.

**Tech Stack:** TypeScript, AI SDK v6 (`ai@6`), `@ai-sdk/openai-compatible`, vitest, `ai/test` `MockLanguageModelV3`.

**Execution preferences (from the user):** No commits — leave all changes in the working tree. No per-task typecheck; a single `tsc` run is the final task. Work on `master`; no branch/worktree.

**Spec:** [docs/superpowers/specs/2026-06-22-aisdk-native-reasoning-parsing-design.md](../specs/2026-06-22-aisdk-native-reasoning-parsing-design.md)

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/agent-runtime/src/providers/aisdk/structured.ts` | Build structured-output spec + wrap model for reasoning models | Remove `extractJsonPayload` + 3 helpers; rewrite `wrapForStructuredOutput` to native middleware chain |
| `packages/agent-runtime/src/providers/aisdk/structured.test.ts` | Test the parsing layer | Drop `extractJsonPayload` suite; rewrite `wrapForStructuredOutput` suite to assert native reasoning extraction for 3 tags |
| `packages/agent-runtime/src/providers/aisdk/operations/run-custom-prompt.ts` | Structured custom-prompt flow | Drop `extractJsonPayload` import + use; plain `JSON.parse` recovery; delete `forceJsonInstruction`; forced turn uses `FORCE_JSON_INSTRUCTION`; keep `missingRequiredKeys` gate |
| `packages/agent-runtime/src/providers/aisdk/operations/run-custom-prompt.test.ts` | Test the structured flow | Mock `extractReasoningMiddleware`; remove the `<think>+fenced` recovery test and the schema-in-forced-prompt test |
| `scripts/minimax-structured-probe.ts` | Throwaway diagnostic probe | Delete (imports the removed `extractJsonPayload`) |
| `.claude/.../memory/aisdk-reasoning-json-parse.md` (user memory) | Memory note | Update: fix moved to native `extractReasoningMiddleware` |

---

## Task 1: Native reasoning middleware in `structured.ts`

**Files:**
- Modify: `packages/agent-runtime/src/providers/aisdk/structured.ts` (full rewrite)
- Test: `packages/agent-runtime/src/providers/aisdk/structured.test.ts` (full rewrite)

- [ ] **Step 1: Rewrite the test file**

Replace the entire contents of `packages/agent-runtime/src/providers/aisdk/structured.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { wrapForStructuredOutput } from "./structured.ts";

// Reasoning models (e.g. MiniMax-M3) leak chain-of-thought as <think>…</think>
// in the *content* channel. wrapForStructuredOutput wraps the model with the
// SDK-native extractReasoningMiddleware chain, which moves that reasoning into a
// separate `reasoning` content part and leaves clean JSON for Output.object.

const OBJ = { branch: "b", source_branch: "main", results: [{ project: "HireIQ", status: "failed" }] };
const JSON_TEXT = JSON.stringify(OBJ);

function modelReturning(text: string) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: [],
    }),
  } as unknown as ConstructorParameters<typeof MockLanguageModelV3>[0]);
}

async function generate(raw: string) {
  const model = wrapForStructuredOutput(modelReturning(raw)) as unknown as {
    doGenerate: (o: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
  return model.doGenerate({ prompt: [] });
}

describe("wrapForStructuredOutput", () => {
  it("strips a <think> block, leaving clean JSON for the parser", async () => {
    const out = await generate(`<think>\nreport the result\n</think>\n${JSON_TEXT}`);
    const textPart = out.content.find((p) => p.type === "text");
    expect(JSON.parse(textPart!.text!)).toEqual(OBJ);
    expect(out.content.some((p) => p.type === "reasoning")).toBe(true);
  });

  it("strips a <thinking> block", async () => {
    const out = await generate(`<thinking>\nthinking aloud\n</thinking>\n${JSON_TEXT}`);
    const textPart = out.content.find((p) => p.type === "text");
    expect(JSON.parse(textPart!.text!)).toEqual(OBJ);
  });

  it("strips a <reasoning> block", async () => {
    const out = await generate(`<reasoning>\nreasoning aloud\n</reasoning>\n${JSON_TEXT}`);
    const textPart = out.content.find((p) => p.type === "text");
    expect(JSON.parse(textPart!.text!)).toEqual(OBJ);
  });

  it("leaves clean JSON untouched (no reasoning tag present)", async () => {
    const out = await generate(JSON_TEXT);
    const textPart = out.content.find((p) => p.type === "text");
    expect(JSON.parse(textPart!.text!)).toEqual(OBJ);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/agent-runtime/src/providers/aisdk/structured.test.ts`
Expected: FAIL — the current `wrapForStructuredOutput` uses `extractJsonMiddleware` (transforms text only), so no `reasoning` content part is produced; the `expect(out.content.some(p => p.type === "reasoning")).toBe(true)` assertion fails.

- [ ] **Step 3: Rewrite `structured.ts`**

Replace the entire contents of `packages/agent-runtime/src/providers/aisdk/structured.ts` with:

```typescript
import { Output, jsonSchema, wrapLanguageModel, extractReasoningMiddleware } from "ai";
import type { LanguageModel } from "ai";

/** Build the AI SDK structured-output spec from a raw JSON Schema, or undefined. */
export function buildOutput(outputSchema: Record<string, unknown> | undefined) {
  if (!outputSchema) return undefined;
  return Output.object({ schema: jsonSchema(outputSchema) });
}

/**
 * Wrap a model so structured-output steps survive reasoning models. The SDK's
 * extractReasoningMiddleware peels a reasoning tag's content out of the *content*
 * channel into a separate `reasoning` field, leaving clean JSON for
 * Output.object's parser. Reasoning models served over OpenAI-compatible
 * endpoints (MiniMax-M3, many vLLM/llama.cpp gateways) emit these blocks even
 * when they ignore `response_format`. We chain the common tag variants; each is a
 * no-op when its tag is absent, so this is safe to apply to every structured step.
 *
 * Known limitation: this does NOT recover JSON wrapped in ```json fences or
 * surrounded by prose — it relies on the model emitting clean JSON after its
 * reasoning block.
 */
export function wrapForStructuredOutput(model: LanguageModel): LanguageModel {
  return wrapLanguageModel({
    // resolveModel hands back a concrete provider model; the union allows a
    // string id, which wrapLanguageModel doesn't accept. Narrow to its param.
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: [
      extractReasoningMiddleware({ tagName: "think" }),
      extractReasoningMiddleware({ tagName: "thinking" }),
      extractReasoningMiddleware({ tagName: "reasoning" }),
    ],
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/agent-runtime/src/providers/aisdk/structured.test.ts`
Expected: PASS (4 tests). Note: the recovered text part may have a leading newline (e.g. `"\n{...}"`); `JSON.parse` tolerates leading whitespace, so the assertions hold.

---

## Task 2: Simplify `run-custom-prompt.ts` to native + validation

**Files:**
- Modify: `packages/agent-runtime/src/providers/aisdk/operations/run-custom-prompt.ts`
- Test: `packages/agent-runtime/src/providers/aisdk/operations/run-custom-prompt.test.ts`

- [ ] **Step 1: Update the test mock and remove obsolete tests**

In `run-custom-prompt.test.ts`, the `vi.mock("ai", …)` block currently exports `extractJsonMiddleware: () => ({})`. `structured.ts` now imports `extractReasoningMiddleware` instead, so the mock must provide it (otherwise `wrapForStructuredOutput` calls `undefined()` and crashes). Change the mock factory's middleware line:

Replace:
```typescript
  extractJsonMiddleware: () => ({}),
```
with:
```typescript
  extractReasoningMiddleware: () => ({}),
```

Then **delete** this entire test (the `<think>`/fence stripping is now the middleware's job, exercised in `structured.test.ts`, and the `ai` mock here makes the middleware a no-op):
```typescript
  it("recovers from <think>+fenced JSON when result.output throws", async () => {
    const text = "<think>\nreport it\n</think>\n```json\n{\"ok\":true}\n```";
    generateText.mockResolvedValue(resultWithThrowingOutput({ text }));
    const r = await runCustomPrompt(structuredOpts);
    expect(r.structured).toEqual({ ok: true });
  });
```

Then **delete** this test (we are reverting the schema-restating forced prompt):
```typescript
  it("puts the declared output schema into the forced-JSON turn so the model uses the exact keys", async () => {
    generateText
      .mockResolvedValueOnce(resultWithThrowingOutput({ text: "<think>done</think>", steps: [] }))
      .mockResolvedValueOnce({ output: { "review-path": "/ws/r.md", status: "success" }, steps: [] });
    await runCustomPrompt(requiredOpts);
    const forcedArgs = generateText.mock.calls[1][0];
    const serialized = JSON.stringify(forcedArgs.messages);
    expect(serialized).toContain("review-path");
  });
```

- [ ] **Step 2: Run the test file to confirm the remaining tests still drive the change**

Run: `npx vitest run packages/agent-runtime/src/providers/aisdk/operations/run-custom-prompt.test.ts`
Expected: FAIL to import/run — `run-custom-prompt.ts` still imports `extractJsonPayload` from `structured.ts`, which Task 1 removed (`SyntaxError`/undefined import). This confirms the source must be updated next.

- [ ] **Step 3: Update the import in `run-custom-prompt.ts`**

Replace line:
```typescript
import { buildOutput, wrapForStructuredOutput, extractJsonPayload } from "../structured.ts";
```
with:
```typescript
import { buildOutput, wrapForStructuredOutput } from "../structured.ts";
```

- [ ] **Step 4: Delete the `forceJsonInstruction` function**

Remove this entire block (the function and its doc comment) from `run-custom-prompt.ts`:
```typescript
/**
 * Build the forced-JSON instruction. Models served over openai-compatible
 * endpoints (MiniMax-M3, many vLLM gateways) ignore `response_format`, so the
 * only way to make them emit the *exact* declared field names is to restate the
 * schema in the prompt. Without this, the model invents key names (e.g.
 * `review_file_path` instead of the declared `review-path`) and downstream steps
 * that read those keys fail with "Missing required input".
 */
function forceJsonInstruction(schema: Record<string, unknown> | undefined): string {
  if (!schema) return FORCE_JSON_INSTRUCTION;
  const required = schemaRequiredKeys(schema);
  const keyHint = required.length
    ? ` Use these EXACT property names (do not rename or reformat them): ${JSON.stringify(required)}.`
    : "";
  return `${FORCE_JSON_INSTRUCTION} The JSON MUST conform to this schema:\n${JSON.stringify(schema)}${keyHint}`;
}
```
Keep `schemaRequiredKeys` (used by `missingRequiredKeys`) and `missingRequiredKeys` unchanged.

- [ ] **Step 5: Use plain JSON.parse in the recovery path**

In `tryReadStructured`, replace:
```typescript
  try {
    return JSON.parse(extractJsonPayload(finalAssistantText(result)));
  } catch {
    return undefined;
  }
```
with:
```typescript
  try {
    // Text is already reasoning-stripped by wrapForStructuredOutput's middleware.
    return JSON.parse(finalAssistantText(result));
  } catch {
    return undefined;
  }
```

- [ ] **Step 6: Use the plain forced instruction**

In the forced-turn `generateText` call, replace:
```typescript
          { role: "user", content: forceJsonInstruction(opts.outputSchema) },
```
with:
```typescript
          { role: "user", content: FORCE_JSON_INSTRUCTION },
```

- [ ] **Step 7: Run the test file to verify it passes**

Run: `npx vitest run packages/agent-runtime/src/providers/aisdk/operations/run-custom-prompt.test.ts`
Expected: PASS. The kept validation tests still hold:
- `forces another turn when recovered JSON is missing a required schema field` — first turn's wrong-keyed `{"review_file_path":…}` is valid JSON, recovered via plain `JSON.parse`; `missingRequiredKeys` reports `review-path` missing → forces a turn → forced turn returns the correct key → accepted.
- `errors naming the missing required field when the model never produces it` — both turns emit the wrong key → returns an error naming `review-path`.
- `recovers structured output from result.text` / `recovers from the newest non-empty step` — plain JSON parsing, unaffected.

---

## Task 3: Cleanup — scratch script and memory

**Files:**
- Delete: `scripts/minimax-structured-probe.ts`
- Modify: user memory `aisdk-reasoning-json-parse.md`

- [ ] **Step 1: Delete the throwaway probe that imports the removed function**

Run:
```bash
rm /Users/admin/data/workspace/claude-skils/journeyman/scripts/minimax-structured-probe.ts
```
(`scripts/toolloop-agent-structured.ts` does not import `extractJsonPayload` in its current form, so it needs no change.)

- [ ] **Step 2: Confirm no other importers remain**

Run: `grep -rn "extractJsonPayload" packages scripts`
Expected: no matches.

- [ ] **Step 3: Update the memory note**

Edit `/Users/admin/.claude/projects/-Users-admin-data-workspace-claude-skils-journeyman/memory/aisdk-reasoning-json-parse.md` so the body reflects that the fix is now the SDK-native `extractReasoningMiddleware` chain (`<think>`/`<thinking>`/`<reasoning>`) in `structured.ts`, not the custom `extractJsonMiddleware`/`extractJsonPayload` regex. Keep the `name`/`description`/`metadata` frontmatter; update the one-line index entry in `MEMORY.md` accordingly.

---

## Task 4: Final verification (single typecheck + full suite)

**Files:** none (verification only)

- [ ] **Step 1: Run the full aisdk test suite**

Run: `npx vitest run packages/agent-runtime/src/providers/aisdk`
Expected: PASS — all files green (structured + run-custom-prompt + the rest of the provider).

- [ ] **Step 2: Typecheck the package once**

Run: `npx tsc -p packages/agent-runtime/tsconfig.json --noEmit`
Expected: exit 0, no output. (This is the only typecheck — no per-task typechecks.)

- [ ] **Step 3: Report**

Summarize: files changed, tests passing count, typecheck clean. Do **not** commit — leave the changes in the working tree on `master` for the user to review. Note that taking effect in real runs requires `npm run images:build` / `build:kit` + worker restart (agent-runtime ships into the sandbox container).

---

## Notes

- **No commits** anywhere in this plan — the working tree is left dirty on `master` by design.
- **Verification of chained middleware** was done during planning: `<think>reasoning</think>\n{json}` through the three-middleware chain yields `[{type:"reasoning",text:"reasoning"},{type:"text",text:"\n{json}"}]`, and `JSON.parse` tolerates the leading newline.
- The earlier session also added validation tests that **stay**; only the `<think>+fenced` recovery test and the schema-in-forced-prompt test are removed.
