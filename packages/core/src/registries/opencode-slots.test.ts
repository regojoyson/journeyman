import { describe, it, expect } from "vitest";
import { openCodeModelSlots, suggestedKeySlotName } from "./opencode-slots.ts";

describe("openCodeModelSlots", () => {
  it("returns one required slot when apiKeySlot is set", () => {
    expect(openCodeModelSlots({ apiKeySlot: "ANTHROPIC_API_KEY" })).toEqual([
      { name: "ANTHROPIC_API_KEY", description: "API key for this model.", optional: false },
    ]);
  });
  it("returns [] when apiKeySlot is absent", () => {
    expect(openCodeModelSlots(undefined)).toEqual([]);
    expect(openCodeModelSlots({})).toEqual([]);
    expect(openCodeModelSlots({ baseUrl: "http://x/v1" })).toEqual([]);
  });
});

describe("suggestedKeySlotName", () => {
  it("derives ${PROVIDERID}_API_KEY from the model id", () => {
    expect(suggestedKeySlotName("anthropic/claude-sonnet-4-6")).toBe("ANTHROPIC_API_KEY");
    expect(suggestedKeySlotName("openai/gpt-4o")).toBe("OPENAI_API_KEY");
    expect(suggestedKeySlotName("openrouter/meta-llama/llama-3.1")).toBe("OPENROUTER_API_KEY");
    expect(suggestedKeySlotName("mistral/large")).toBe("MISTRAL_API_KEY");
  });
  it("overrides google → GEMINI_API_KEY", () => {
    expect(suggestedKeySlotName("google/gemini-2.0-flash")).toBe("GEMINI_API_KEY");
  });
  it("returns '' for a model id with no provider prefix", () => {
    expect(suggestedKeySlotName("claude-opus")).toBe("");
    expect(suggestedKeySlotName(undefined)).toBe("");
  });
});
