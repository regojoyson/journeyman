import { describe, it, expect } from "vitest";
import { codingModelSlots } from "./opencode-slots.ts";

describe("codingModelSlots", () => {
  it("returns the declared key slot", () => {
    expect(codingModelSlots({ apiKeySlot: "ANTHROPIC_API_KEY" })).toEqual([
      { name: "ANTHROPIC_API_KEY", description: "API key for this model.", optional: false },
    ]);
  });
  it("returns [] for a keyless model", () => {
    expect(codingModelSlots({})).toEqual([]);
    expect(codingModelSlots(undefined)).toEqual([]);
  });
});
