import type { CodingModelConfig } from "@journeyman/core";
import { isAiSdkPackage } from "@journeyman/core";

/**
 * Validate provider-specific coding-model config. Enforced for "opencode" and
 * "aisdk"; other providers ignore config. Returns an error message, or null.
 */
export function validateCodingModelConfig(
  provider: string,
  config: CodingModelConfig | undefined,
): string | null {
  if (provider === "aisdk") {
    if (!config) return null;
    if (config.npm !== undefined && !isAiSdkPackage(config.npm)) {
      return `config.npm must be a bundled AI-SDK package; got ${config.npm}`;
    }
    if ((config.npm ?? "@ai-sdk/openai-compatible") === "@ai-sdk/openai-compatible" && !config.baseUrl?.trim()) {
      return "config.baseUrl is required for @ai-sdk/openai-compatible";
    }
    if (config.baseUrl !== undefined) {
      try {
        new URL(config.baseUrl);
      } catch {
        return `config.baseUrl is not a valid URL: ${config.baseUrl}`;
      }
    }
    return null;
  }

  if (provider !== "opencode" || !config) return null;

  if (config.baseUrl !== undefined) {
    if (typeof config.baseUrl !== "string" || !config.baseUrl.trim()) {
      return "config.baseUrl must be a non-empty string";
    }
    try {
      new URL(config.baseUrl);
    } catch {
      return `config.baseUrl is not a valid URL: ${config.baseUrl}`;
    }
  }
  if (config.npm !== undefined && (typeof config.npm !== "string" || !config.npm.trim())) {
    return "config.npm must be a non-empty string";
  }
  return null;
}
