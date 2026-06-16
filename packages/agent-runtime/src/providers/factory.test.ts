import { describe, it, expect, afterEach } from "vitest";
import { createCodingProvider } from "./factory.ts";
import { ClaudeProvider } from "./claude/index.ts";
import { OpenCodeProvider } from "./opencode/index.ts";
import { AiSdkProvider } from "./aisdk/index.ts";

describe("createCodingProvider", () => {
  it("returns a ClaudeProvider for 'claude'", () => {
    const p = createCodingProvider("claude", { env: { ANTHROPIC_API_KEY: "k" } });
    expect(p).toBeInstanceOf(ClaudeProvider);
  });
  it("returns an OpenCodeProvider for 'opencode' (managed mode)", () => {
    const p = createCodingProvider("opencode", { env: {} });
    expect(p).toBeInstanceOf(OpenCodeProvider);
  });
  it("defaults to claude when key is undefined", () => {
    const p = createCodingProvider(undefined, { env: {} });
    expect(p).toBeInstanceOf(ClaudeProvider);
  });
  it("throws a ConfigurationError for an unknown provider", () => {
    expect(() => createCodingProvider("nope", { env: {} }))
      .toThrowError(/Unknown coding provider: nope/);
  });

  it("constructs an AiSdkProvider for key 'aisdk'", () => {
    expect(createCodingProvider("aisdk", { env: {} })).toBeInstanceOf(AiSdkProvider);
  });
});

describe("createCodingProvider — AISDK on Windows", () => {
  const setPlatform = (p: NodeJS.Platform) =>
    Object.defineProperty(process, "platform", { value: p, configurable: true });
  const realPlatform = process.platform;
  afterEach(() => setPlatform(realPlatform));

  it("throws a ConfigurationError for aisdk on win32", () => {
    setPlatform("win32");
    expect(() => createCodingProvider("aisdk", { env: {} })).toThrow(/not supported on Windows/i);
  });

  it("allows aisdk on non-Windows", () => {
    setPlatform("linux");
    expect(createCodingProvider("aisdk", { env: {} })).toBeInstanceOf(AiSdkProvider);
  });

  it("allows claude on win32", () => {
    setPlatform("win32");
    expect(() => createCodingProvider("claude", { env: {} })).not.toThrow();
  });
});
