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

type Mutable = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number };

export interface UsageAccumulator {
  /** Fold one streamed SDK message; only `assistant` messages with `message.usage` contribute. */
  add(msg: unknown): void;
  /** Snapshot the accumulated usage as one TokenUsage per model. */
  toTokenUsage(): TokenUsage[];
}

/**
 * Accumulates per-assistant-message usage across a streaming `query()` run. Used to recover
 * partial usage when the run throws/aborts before emitting a final `result` message (whose
 * `modelUsage` we'd otherwise rely on). Keyed by `message.model`.
 */
export function createUsageAccumulator(): UsageAccumulator {
  const byModel = new Map<string, Mutable>();
  return {
    add(msg: unknown) {
      const m = msg as { type?: string; message?: { model?: string; usage?: Record<string, number | undefined> } };
      if (m?.type !== "assistant" || !m.message?.usage) return;
      const model = m.message.model ?? "unknown";
      const u = m.message.usage;
      const cur = byModel.get(model) ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
      cur.inputTokens += u.input_tokens ?? 0;
      cur.outputTokens += u.output_tokens ?? 0;
      cur.cacheReadTokens += u.cache_read_input_tokens ?? 0;
      cur.cacheCreationTokens += u.cache_creation_input_tokens ?? 0;
      byModel.set(model, cur);
    },
    toTokenUsage(): TokenUsage[] {
      return [...byModel.entries()].map(([model, c]) => ({
        provider: "claude", vendor: "anthropic", model,
        inputTokens: c.inputTokens, outputTokens: c.outputTokens,
        cacheReadTokens: c.cacheReadTokens, cacheCreationTokens: c.cacheCreationTokens,
        totalTokens: c.inputTokens + c.outputTokens,
      }));
    },
  };
}
