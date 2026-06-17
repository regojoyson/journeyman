import { describe, it, expect, vi, beforeEach } from "vitest";

const generateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (args: unknown) => generateText(args),
  stepCountIs: (n: number) => n,
  Output: { object: (x: unknown) => x },
  jsonSchema: (x: unknown) => x,
  tool: (x: unknown) => x,
  wrapLanguageModel: ({ model }: { model: unknown }) => model,
  extractJsonMiddleware: () => ({}),
}));
vi.mock("../model.ts", () => ({
  resolveModel: vi.fn(async () => ({ fake: "model" })),
  configError: (m: string) => Object.assign(new Error(m), { name: "ConfigurationError" }),
}));

import { runCustomPrompt, describeError } from "./run-custom-prompt.ts";
import { resolveModel } from "../model.ts";

beforeEach(() => generateText.mockReset());

describe("runCustomPrompt (aisdk)", () => {
  it("returns text for outputMode=text", async () => {
    generateText.mockResolvedValue({ text: "the answer", steps: [] });
    const r = await runCustomPrompt({ prompt: "hi", outputMode: "text", model: "anthropic-id", modelConfig: { npm: "@ai-sdk/anthropic" } } as any);
    expect(r.result).toBe("the answer");
    expect(r.sessionId).toBeTruthy();
  });

  it("returns structured output for outputMode=structured", async () => {
    generateText.mockResolvedValue({ text: "", output: { ok: true }, steps: [] });
    const r = await runCustomPrompt({ prompt: "hi", outputMode: "structured", outputSchema: { type: "object" }, model: "x", modelConfig: {} } as any);
    expect(r.structured).toEqual({ ok: true });
  });

  // The AI SDK throws NoOutputGeneratedError reading result.output when the
  // final step's finishReason isn't "stop" (tool-using steps; vercel/ai#11348).
  // We recover the JSON from the model's text. These mocks simulate that throw.
  function resultWithThrowingOutput(fields: { text?: string; steps?: unknown[] }) {
    const o: Record<string, unknown> = { text: fields.text ?? "", steps: fields.steps ?? [] };
    Object.defineProperty(o, "output", { get() { throw new Error("No output generated."); } });
    return o;
  }
  const structuredOpts = { prompt: "hi", outputMode: "structured", outputSchema: { type: "object" }, model: "x", modelConfig: {} } as any;

  it("recovers structured output from result.text when result.output throws", async () => {
    generateText.mockResolvedValue(resultWithThrowingOutput({ text: '{"branch":"b","status":"failed"}' }));
    const r = await runCustomPrompt(structuredOpts);
    expect(r.structured).toEqual({ branch: "b", status: "failed" });
    expect(r.error).toBeUndefined();
  });

  it("recovers from the newest non-empty step when result.text is empty", async () => {
    generateText.mockResolvedValue(resultWithThrowingOutput({ text: "", steps: [{ text: "" }, { text: '{"ok":1}' }] }));
    const r = await runCustomPrompt(structuredOpts);
    expect(r.structured).toEqual({ ok: 1 });
  });

  it("recovers from <think>+fenced JSON when result.output throws", async () => {
    const text = "<think>\nreport it\n</think>\n```json\n{\"ok\":true}\n```";
    generateText.mockResolvedValue(resultWithThrowingOutput({ text }));
    const r = await runCustomPrompt(structuredOpts);
    expect(r.structured).toEqual({ ok: true });
  });

  it("returns a clear error (does not throw) when no JSON is present", async () => {
    generateText.mockResolvedValue(resultWithThrowingOutput({ text: "no json here" }));
    const r = await runCustomPrompt(structuredOpts);
    expect(r.structured).toBeUndefined();
    expect(r.error).toMatch(/no parseable JSON/i);
  });

  it("errors when structured mode has no schema", async () => {
    const r = await runCustomPrompt({ prompt: "hi", outputMode: "structured", model: "x", modelConfig: {} } as any);
    expect(r.error).toMatch(/outputSchema/);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("captures thrown errors into result.error", async () => {
    (resolveModel as any).mockImplementationOnce(() => { throw new Error("boom"); });
    const r = await runCustomPrompt({ prompt: "hi", outputMode: "text", model: "x", modelConfig: {} } as any);
    expect(r.error).toMatch(/boom/);
  });

  it("surfaces the underlying reason when the catch is an API error", async () => {
    (resolveModel as any).mockImplementationOnce(() => {
      throw Object.assign(new Error("Bad Request"), {
        statusCode: 400,
        url: "http://host.docker.internal:1234/v1/chat/completions",
        responseBody: '{"error":"response_format json_schema not supported"}',
      });
    });
    const r = await runCustomPrompt({ prompt: "hi", outputMode: "text", model: "x", modelConfig: {} } as any);
    expect(r.error).toContain("Bad Request");
    expect(r.error).toContain("status=400");
    expect(r.error).toContain("response_format json_schema not supported");
  });
});

describe("describeError", () => {
  it("includes status, url, and responseBody from an APICallError-shaped error", () => {
    const e = Object.assign(new Error("Bad Request"), {
      statusCode: 400,
      url: "http://x/v1",
      responseBody: "schema invalid",
    });
    const s = describeError(e);
    expect(s).toContain("Bad Request");
    expect(s).toContain("status=400");
    expect(s).toContain("url=http://x/v1");
    expect(s).toContain("body=schema invalid");
  });

  it("falls back to the plain message for ordinary errors", () => {
    expect(describeError(new Error("nope"))).toBe("nope");
  });
});
