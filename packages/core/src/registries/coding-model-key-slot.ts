import type { CodingModelConfig } from "../types/coding-models.types.ts";
import { suggestedKeySlotName } from "./key-slot-name.ts";

/**
 * The internal env-var label the bound API key is placed under at run time.
 * Single source of truth: the worker writes env[label] and the runner reads
 * env[label], both calling this with the same inputs, so they always agree.
 *
 * The label only matters on cloud fallback paths (claude SDK, opencode built-in
 * catalog) which read a specific name from process.env; explicit-apiKey paths
 * (aisdk, opencode custom endpoint) accept any label.
 */
export function codingModelKeySlot(input: {
  provider: string;
  config: CodingModelConfig | undefined;
  modelId: string | undefined;
}): string {
  const { provider, config, modelId } = input;
  if (provider === "claude") return "ANTHROPIC_API_KEY";
  if (provider === "aisdk") {
    const byNpm: Record<string, string> = {
      "@ai-sdk/anthropic": "ANTHROPIC_API_KEY",
      "@ai-sdk/openai": "OPENAI_API_KEY",
      "@ai-sdk/google": "GOOGLE_GENERATIVE_AI_API_KEY",
    };
    return byNpm[config?.npm ?? ""] ?? "AISDK_API_KEY";
  }
  if (provider === "opencode") {
    return suggestedKeySlotName(modelId) || "OPENCODE_API_KEY";
  }
  return "API_KEY";
}
