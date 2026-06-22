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
  // OpenCode splits the model string on the first slash, so `info.modelID` is the
  // part AFTER the provider (e.g. "qwen/qwen3.6-35b-a3b" for "lmstudio/qwen/..."),
  // and `info.providerID` is the first segment ("lmstudio"). Pricing and the model
  // dashboard are keyed by the FULL coding-model id ("lmstudio/qwen/..."), so
  // recombine them — otherwise cost never matches the pricing row and the model
  // breakdown shows an unrecognized name.
  const model = info.providerID && info.modelID
    ? `${info.providerID}/${info.modelID}`
    : (info.modelID ?? "");
  return [{
    provider: "opencode",
    vendor: info.providerID,
    model,
    inputTokens: t.input,
    outputTokens: t.output,
    reasoningTokens: t.reasoning,
    cacheReadTokens: t.cache?.read,
    cacheCreationTokens: t.cache?.write,
    totalTokens,
    raw: info,
  }];
}
