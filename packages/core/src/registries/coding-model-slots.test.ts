import { describe, it, expect } from "vitest";
import { codingModelSlots } from "./opencode-slots.ts";

describe("codingModelSlots", () => {
  it("returns the derived key slot when a key is required", () => {
    expect(codingModelSlots({ requiresApiKey: true }, "anthropic/claude-sonnet-4-6")).toEqual([
      { name: "ANTHROPIC_API_KEY", description: "API key for this model.", optional: false },
    ]);
  });
  it("returns [] for a keyless model", () => {
    expect(codingModelSlots({}, "anthropic/claude")).toEqual([]);
    expect(codingModelSlots(undefined, "anthropic/claude")).toEqual([]);
  });
});
