import { describe, it, expect } from "vitest";
import { isValidCodingProvider, LIST_CODING_PROVIDERS } from "./validate-provider.ts";

describe("isValidCodingProvider", () => {
  it("accepts every coding-cli provider in the core catalog", () => {
    expect(LIST_CODING_PROVIDERS.length).toBeGreaterThan(0);
    for (const value of LIST_CODING_PROVIDERS) {
      expect(isValidCodingProvider(value)).toBe(true);
    }
  });

  it("rejects unknown provider values", () => {
    expect(isValidCodingProvider("clade")).toBe(false);
    expect(isValidCodingProvider("openai")).toBe(false);
    expect(isValidCodingProvider("")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidCodingProvider(undefined as unknown as string)).toBe(false);
    expect(isValidCodingProvider(null as unknown as string)).toBe(false);
    expect(isValidCodingProvider(123 as unknown as string)).toBe(false);
  });
});
