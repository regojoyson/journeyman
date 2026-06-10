import { describe, it, expect, vi, beforeEach } from "vitest";

const generateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (args: unknown) => generateText(args),
  stepCountIs: (n: number) => n,
  Output: { object: (x: unknown) => x },
  jsonSchema: (x: unknown) => x,
  tool: (x: unknown) => x,
}));
vi.mock("../model.ts", () => ({
  resolveModel: vi.fn(async () => ({ fake: "model" })),
  configError: (m: string) => Object.assign(new Error(m), { name: "ConfigurationError" }),
}));

import { runCustomPrompt } from "./run-custom-prompt.ts";
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
    generateText.mockResolvedValue({ text: "", experimental_output: { ok: true }, steps: [] });
    const r = await runCustomPrompt({ prompt: "hi", outputMode: "structured", outputSchema: { type: "object" }, model: "x", modelConfig: {} } as any);
    expect(r.structured).toEqual({ ok: true });
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
});
