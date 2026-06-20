import { describe, it, expect } from "vitest";
import { codingModelKeySlot } from "./coding-model-key-slot.ts";

describe("codingModelKeySlot", () => {
  it("claude → ANTHROPIC_API_KEY", () => {
    expect(codingModelKeySlot({ provider: "claude", config: undefined, modelId: "claude-opus" }))
      .toBe("ANTHROPIC_API_KEY");
  });

  it("aisdk maps by npm package", () => {
    expect(codingModelKeySlot({ provider: "aisdk", config: { npm: "@ai-sdk/anthropic" }, modelId: "x" }))
      .toBe("ANTHROPIC_API_KEY");
    expect(codingModelKeySlot({ provider: "aisdk", config: { npm: "@ai-sdk/openai" }, modelId: "x" }))
      .toBe("OPENAI_API_KEY");
    expect(codingModelKeySlot({ provider: "aisdk", config: { npm: "@ai-sdk/google" }, modelId: "x" }))
      .toBe("GOOGLE_GENERATIVE_AI_API_KEY");
  });

  it("aisdk openai-compatible (label is cosmetic) → stable fallback", () => {
    expect(codingModelKeySlot({
      provider: "aisdk",
      config: { npm: "@ai-sdk/openai-compatible", baseUrl: "https://api.minimax.io/v1" },
      modelId: "MiniMax-M3",
    })).toBe("AISDK_API_KEY");
  });

  it("opencode cloud → standard name from model id", () => {
    expect(codingModelKeySlot({ provider: "opencode", config: {}, modelId: "anthropic/claude-sonnet-4-6" }))
      .toBe("ANTHROPIC_API_KEY");
    expect(codingModelKeySlot({ provider: "opencode", config: {}, modelId: "google/gemini-2.0" }))
      .toBe("GEMINI_API_KEY");
  });

  it("opencode with no provider prefix → fallback", () => {
    expect(codingModelKeySlot({ provider: "opencode", config: { baseUrl: "http://gw/v1" }, modelId: "local-model" }))
      .toBe("OPENCODE_API_KEY");
  });

  it("unknown provider → generic fallback", () => {
    expect(codingModelKeySlot({ provider: "mystery", config: undefined, modelId: undefined }))
      .toBe("API_KEY");
  });
});
