import type { TokenUsage } from "@journeyman/core";

type ClaudeModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
};

/** Map the Claude SDK result message `modelUsage` map → one TokenUsage per model. */
export function modelUsageToTokenUsage(
  modelUsage: Record<string, ClaudeModelUsage> | undefined | null,
): TokenUsage[] {
  if (!modelUsage) return [];
  return Object.entries(modelUsage).map(([model, u]) => {
    const inputTokens = u.inputTokens;
    const outputTokens = u.outputTokens;
    const totalTokens =
      inputTokens !== undefined || outputTokens !== undefined
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : undefined;
    return {
      provider: "claude",
      vendor: "anthropic",
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens: u.cacheReadInputTokens,
      cacheCreationTokens: u.cacheCreationInputTokens,
      totalTokens,
      raw: u,
    };
  });
}
