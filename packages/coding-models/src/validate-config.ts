import type { CodingModelConfig } from "@journeyman/core";

/**
 * Validate provider-specific coding-model config. Only enforced for "opencode";
 * other providers ignore config. Returns an error message, or null if valid.
 */
export function validateCodingModelConfig(
  provider: string,
  config: CodingModelConfig | undefined,
): string | null {
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
  if (config.apiKeySlot !== undefined && (typeof config.apiKeySlot !== "string" || !config.apiKeySlot.trim())) {
    return "config.apiKeySlot must be a non-empty string";
  }
  return null;
}
