import type { TokenUsage, CodingModelConfig } from "@journeyman/core";

type AiSdkUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

/** Best-effort vendor for an aisdk run: prefer the configured ai-sdk package, else the model-id prefix. */
export function vendorFromConfig(
  config: CodingModelConfig | undefined,
  model: string | undefined,
): string | undefined {
  const npm = config?.npm;
  if (npm) {
    const m = /^@ai-sdk\/([a-z0-9-]+)/.exec(npm);
    if (m && m[1] !== "openai-compatible") return m[1];
  }
  const id = (model ?? "").toLowerCase();
  if (id.startsWith("gpt") || id.startsWith("o1") || id.startsWith("o3")) return "openai";
  if (id.startsWith("claude")) return "anthropic";
  if (id.startsWith("gemini")) return "google";
  return undefined;
}

/** Map one aisdk `result.usage` object → a single TokenUsage (model id known from opts, not the result). */
export function aiSdkUsageToTokenUsage(
  usage: AiSdkUsage | undefined | null,
  model: string,
  vendor: string | undefined,
): TokenUsage[] {
  if (!usage) return [];
  return [{
    provider: "aisdk",
    vendor,
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.reasoningTokens,
    cacheReadTokens: usage.cachedInputTokens,
    raw: usage,
  }];
}

const add = (a?: number, b?: number) =>
  a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);

/** Sum token fields across rows that share the same (provider, model). Used for aisdk's force-JSON retry. */
export function accumulateUsage(rows: TokenUsage[]): TokenUsage[] {
  const byKey = new Map<string, TokenUsage>();
  for (const r of rows) {
    const key = `${r.provider}::${r.model}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, { ...r }); continue; }
    byKey.set(key, {
      ...prev,
      inputTokens: add(prev.inputTokens, r.inputTokens),
      outputTokens: add(prev.outputTokens, r.outputTokens),
      totalTokens: add(prev.totalTokens, r.totalTokens),
      reasoningTokens: add(prev.reasoningTokens, r.reasoningTokens),
      cacheReadTokens: add(prev.cacheReadTokens, r.cacheReadTokens),
      cacheCreationTokens: add(prev.cacheCreationTokens, r.cacheCreationTokens),
    });
  }
  return [...byKey.values()];
}
