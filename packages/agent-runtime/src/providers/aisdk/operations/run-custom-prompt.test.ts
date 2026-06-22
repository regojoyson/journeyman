import { describe, it, expect, vi, beforeEach } from "vitest";

const generateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (args: unknown) => generateText(args),
  stepCountIs: (n: number) => n,
  Output: { object: (x: unknown) => x },
  jsonSchema: (x: unknown) => x,
  tool: (x: unknown) => x,
  wrapLanguageModel: ({ model }: { model: unknown }) => model,
  extractReasoningMiddleware: () => ({}),
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

  it("returns a clear error (does not throw) when no JSON is present even after the forced turn", async () => {
    generateText.mockResolvedValue(resultWithThrowingOutput({ text: "no json here" }));
    const r = await runCustomPrompt(structuredOpts);
    expect(r.structured).toBeUndefined();
    expect(r.error).toMatch(/no parseable JSON/i);
  });

  it("forces a final tool-free JSON turn when the agent loop ends without JSON", async () => {
    generateText
      .mockResolvedValueOnce(resultWithThrowingOutput({ text: "<think>ran out of steps</think>", steps: [] }))
      .mockResolvedValueOnce({ output: { branch: "b", status: "failed" }, steps: [] });
    const r = await runCustomPrompt(structuredOpts);
    expect(r.structured).toEqual({ branch: "b", status: "failed" });
    expect(generateText).toHaveBeenCalledTimes(2);
    const forcedArgs = generateText.mock.calls[1][0];
    expect(forcedArgs.tools).toBeUndefined();          // forced call uses no tools
    expect(Array.isArray(forcedArgs.messages)).toBe(true);
  });

  it("does not force a second turn when the first call already yields JSON", async () => {
    generateText.mockResolvedValue({ output: { ok: true }, steps: [] });
    await runCustomPrompt(structuredOpts);
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  // The schema declares the exact output field names the downstream steps read
  // (e.g. `review-path`). A reasoning model over an openai-compatible endpoint
  // ignores response_format and freely renames keys (`review_file_path`); nothing
  // in the recovery path validated against the schema, so the wrong-keyed object
  // sailed downstream and the next step failed with "Missing required input".
  const schemaWithRequired = {
    type: "object",
    properties: { "review-path": { type: "string" }, status: { type: "string" } },
    required: ["review-path"],
  };
  const requiredOpts = { prompt: "review it", outputMode: "structured", outputSchema: schemaWithRequired, model: "x", modelConfig: {} } as any;

  it("forces another turn when recovered JSON is missing a required schema field", async () => {
    generateText
      // first turn: recovered JSON has the WRONG key name (model renamed it)
      .mockResolvedValueOnce(resultWithThrowingOutput({ text: '{"review_file_path":"/ws/r.md","status":"success"}' }))
      // forced turn: model now uses the declared key
      .mockResolvedValueOnce({ output: { "review-path": "/ws/r.md", status: "success" }, steps: [] });
    const r = await runCustomPrompt(requiredOpts);
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(r.structured).toEqual({ "review-path": "/ws/r.md", status: "success" });
    expect(r.error).toBeUndefined();
  });

  it("errors naming the missing required field when the model never produces it", async () => {
    // Both the agent loop and the forced turn emit the wrong key.
    generateText.mockResolvedValue(resultWithThrowingOutput({ text: '{"review_file_path":"/ws/r.md","status":"success"}' }));
    const r = await runCustomPrompt(requiredOpts);
    expect(r.structured).toBeUndefined();
    expect(r.error).toMatch(/review-path/);
    expect(r.error).toMatch(/required/i);
  });


  it("uses a configured maxSteps as the step budget", async () => {
    generateText.mockResolvedValue({ output: { ok: true }, steps: [] });
    await runCustomPrompt({ ...structuredOpts, maxSteps: 200 });
    expect(generateText.mock.calls[0][0].stopWhen).toBe(200); // stepCountIs is mocked to identity
  });

  it("defaults the step budget to 80 when maxSteps is unset", async () => {
    generateText.mockResolvedValue({ output: { ok: true }, steps: [] });
    await runCustomPrompt(structuredOpts);
    expect(generateText.mock.calls[0][0].stopWhen).toBe(80);
  });

  it("puts stable text in `system` and only the task in `prompt` (caching prefix)", async () => {
    generateText.mockResolvedValue({ text: "ok", steps: [] });
    await runCustomPrompt({ prompt: "the task", outputMode: "text", cwd: "/ws", model: "x", modelConfig: {} } as any);
    const args = generateText.mock.calls[0][0];
    expect(typeof args.system).toBe("string");
    expect(args.system).toContain("WORKSPACE BOUNDARY");
    expect(args.prompt).toBe("the task"); // dynamic task only — confinement is not inlined
  });

  it("omits `system` when there is no stable text", async () => {
    generateText.mockResolvedValue({ text: "ok", steps: [] });
    await runCustomPrompt({ prompt: "x", outputMode: "text", model: "x", modelConfig: {} } as any);
    expect(generateText.mock.calls[0][0].system).toBeUndefined();
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

  it("returns usage accumulated from onStepFinish when the run throws mid-stream", async () => {
    generateText.mockImplementationOnce((args: any) => {
      args.onStepFinish?.({ usage: { inputTokens: 100, outputTokens: 20 } });
      args.onStepFinish?.({ usage: { inputTokens: 50, outputTokens: 10 } });
      throw new Error("rate limit");
    });
    const r = await runCustomPrompt({ prompt: "hi", outputMode: "text", model: "x", modelConfig: {} } as any);
    expect(r.error).toMatch(/rate limit/);
    expect(r.usage).toBeDefined();
    expect(r.usage).toHaveLength(1);
    expect(r.usage![0]).toMatchObject({ provider: "aisdk", model: "x", inputTokens: 150, outputTokens: 30 });
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
