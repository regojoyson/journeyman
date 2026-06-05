import { describe, it, expect } from "vitest";
import { createCodingProvider } from "./factory.ts";
import { ClaudeProvider } from "./claude/index.ts";

describe("createCodingProvider", () => {
  it("returns a ClaudeProvider for 'claude'", () => {
    const p = createCodingProvider("claude", { env: { ANTHROPIC_API_KEY: "k" } });
    expect(p).toBeInstanceOf(ClaudeProvider);
  });
  it("defaults to claude when key is undefined", () => {
    const p = createCodingProvider(undefined, { env: {} });
    expect(p).toBeInstanceOf(ClaudeProvider);
  });
  it("throws a ConfigurationError for an unknown provider", () => {
    expect(() => createCodingProvider("nope", { env: {} }))
      .toThrowError(/Unknown coding provider: nope/);
  });
});
