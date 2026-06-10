import { describe, it, expect } from "vitest";
import { AISDK_PROVIDER_PACKAGES, isAiSdkPackage } from "./aisdk-packages.ts";

describe("AISDK_PROVIDER_PACKAGES", () => {
  it("includes the four bundled adapters", () => {
    const npms = AISDK_PROVIDER_PACKAGES.map((p) => p.npm);
    expect(npms).toEqual([
      "@ai-sdk/anthropic",
      "@ai-sdk/openai",
      "@ai-sdk/google",
      "@ai-sdk/openai-compatible",
    ]);
  });

  it("flags openai-compatible as requiring a baseUrl", () => {
    const compat = AISDK_PROVIDER_PACKAGES.find((p) => p.npm === "@ai-sdk/openai-compatible");
    expect(compat?.requiresBaseUrl).toBe(true);
  });

  it("isAiSdkPackage recognizes only allow-listed packages", () => {
    expect(isAiSdkPackage("@ai-sdk/anthropic")).toBe(true);
    expect(isAiSdkPackage("@ai-sdk/cohere")).toBe(false);
    expect(isAiSdkPackage(undefined)).toBe(false);
  });
});
