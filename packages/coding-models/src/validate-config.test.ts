import { describe, it, expect } from "vitest";
import { validateCodingModelConfig } from "./validate-config.ts";

describe("validateCodingModelConfig", () => {
  it("returns null for a non-opencode provider regardless of config", () => {
    expect(validateCodingModelConfig("claude", { baseUrl: "not-a-url" } as any)).toBeNull();
  });
  it("returns null when opencode config is absent or empty", () => {
    expect(validateCodingModelConfig("opencode", undefined)).toBeNull();
    expect(validateCodingModelConfig("opencode", {})).toBeNull();
  });
  it("accepts a valid base URL", () => {
    expect(validateCodingModelConfig("opencode", { baseUrl: "http://host.docker.internal:1234/v1" })).toBeNull();
  });
  it("rejects an invalid base URL", () => {
    expect(validateCodingModelConfig("opencode", { baseUrl: "not a url" })).toMatch(/baseUrl/);
  });
  it("rejects a non-string npm", () => {
    expect(validateCodingModelConfig("opencode", { npm: 123 as any })).toMatch(/npm/);
  });
  it("rejects an empty-string apiKeySlot", () => {
    expect(validateCodingModelConfig("opencode", { apiKeySlot: "" })).toMatch(/apiKeySlot/);
  });
});

describe("validateCodingModelConfig (aisdk)", () => {
  it("rejects an unsupported npm package", () => {
    expect(validateCodingModelConfig("aisdk", { npm: "@ai-sdk/cohere" })).toMatch(/npm/);
  });
  it("requires baseUrl for openai-compatible", () => {
    expect(validateCodingModelConfig("aisdk", { npm: "@ai-sdk/openai-compatible" })).toMatch(/baseUrl/);
  });
  it("accepts a valid anthropic config", () => {
    expect(validateCodingModelConfig("aisdk", { npm: "@ai-sdk/anthropic", apiKeySlot: "ANTHROPIC_API_KEY" })).toBeNull();
  });
  it("accepts openai-compatible with a baseUrl", () => {
    expect(validateCodingModelConfig("aisdk", { npm: "@ai-sdk/openai-compatible", baseUrl: "http://x/v1" })).toBeNull();
  });
});
