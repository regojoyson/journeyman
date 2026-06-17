import { describe, it, expect } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { extractJsonPayload, wrapForStructuredOutput } from "./structured.ts";

// Reasoning models served over OpenAI-compatible endpoints (e.g. MiniMax-M3)
// leak their chain-of-thought as <think>…</think> blocks and wrap the answer in
// ```json fences inside the *content* channel. The AI SDK's Output.object parser
// runs JSON.parse over the raw text and throws NoObjectGeneratedError on the
// leading "<". These payloads are reconstructed from the failing workflow run
// d8f70c61 (step "Checkout Feature Branch", model MiniMax-M3).

const OBJ = {
  branch: "16_updated-footer-with-current-ye_713386",
  source_branch: "main",
  results: [{ project: "HireIQ", status: "failed" }],
};
const JSON_TEXT = JSON.stringify(OBJ, null, 2);

describe("extractJsonPayload", () => {
  it("returns clean JSON untouched", () => {
    expect(JSON.parse(extractJsonPayload(JSON_TEXT))).toEqual(OBJ);
  });

  it("strips a leading <think> block followed by raw JSON", () => {
    const text = `<think>\nThe push failed; report it as failed.\n</think>\n${JSON_TEXT}`;
    expect(JSON.parse(extractJsonPayload(text))).toEqual(OBJ);
  });

  it("strips <think> + prose + a ```json fenced block (attempt 2 payload)", () => {
    const text =
      `<think>\nThe push failed because there are no GitHub credentials.\n</think>\n` +
      `The push failed due to GitHub authentication being unavailable. Let me report the result:\n\n` +
      `\`\`\`json\n${JSON_TEXT}\n\`\`\``;
    expect(JSON.parse(extractJsonPayload(text))).toEqual(OBJ);
  });

  it("strips <think> + a bare ```json fence (attempt 3 payload)", () => {
    const text = `<think>\nGot the base_sha. Let me output the final JSON.\n</think>\n\`\`\`json\n${JSON_TEXT}\n\`\`\``;
    expect(JSON.parse(extractJsonPayload(text))).toEqual(OBJ);
  });

  it("recovers JSON that the model emitted *inside* the think block (attempt 1 payload)", () => {
    const text = `<think>\nLet me prepare the output.\n\nOutput:\n${JSON_TEXT}\n</think>\nThe push to origin failed.`;
    expect(JSON.parse(extractJsonPayload(text))).toEqual(OBJ);
  });

  it("handles an unclosed <think> tag", () => {
    const text = `<think>\nthinking without closing\n\`\`\`json\n${JSON_TEXT}\n\`\`\``;
    expect(JSON.parse(extractJsonPayload(text))).toEqual(OBJ);
  });

  it("leaves text that contains no JSON unchanged (so the parser raises a real error)", () => {
    expect(extractJsonPayload("no json here").trim()).toBe("no json here");
  });
});

describe("wrapForStructuredOutput", () => {
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

  // The wrapped model runs the extracting middleware over the model's text
  // content, so the text that reaches Output.object's JSON.parse is already
  // clean. We drive doGenerate directly (generateText's output resolution is
  // exercised by real providers in production).
  it("cleans <think>+fenced model output before it reaches the parser", async () => {
    const raw = `<think>\nreport the result\n</think>\n\`\`\`json\n${JSON_TEXT}\n\`\`\``;
    const model = wrapForStructuredOutput(modelReturning(raw)) as unknown as {
      doGenerate: (o: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }>;
    };
    const out = await model.doGenerate({ prompt: [] });
    const textPart = out.content.find((p) => p.type === "text");
    expect(textPart?.text).toBeDefined();
    expect(JSON.parse(textPart!.text!)).toEqual(OBJ);
  });
});
