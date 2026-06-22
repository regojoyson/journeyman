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
