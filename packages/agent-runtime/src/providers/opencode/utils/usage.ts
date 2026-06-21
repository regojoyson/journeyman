import type { TokenUsage } from "@journeyman/core";

type OpenCodeInfo = {
  modelID?: string;
  providerID?: string;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
};

/** Map an OpenCode assistant `info` block → a single TokenUsage (or [] when no tokens reported). */
export function openCodeInfoToTokenUsage(info: OpenCodeInfo | undefined | null): TokenUsage[] {
  if (!info || !info.tokens) return [];
  const t = info.tokens;
  const totalTokens =
    t.input !== undefined || t.output !== undefined ? (t.input ?? 0) + (t.output ?? 0) : undefined;
  return [{
    provider: "opencode",
    vendor: info.providerID,
    model: info.modelID ?? "",
    inputTokens: t.input,
    outputTokens: t.output,
    reasoningTokens: t.reasoning,
    cacheReadTokens: t.cache?.read,
    cacheCreationTokens: t.cache?.write,
    totalTokens,
    raw: info,
  }];
}
