import type { ModelPricing, ModelPriceInput } from "@journeyman/core";

/** The active price (effectiveTo === null) for a provider+model, mapped to the form's input shape. */
export function activePriceFor(
  prices: ModelPricing[], provider: string, model: string,
): ModelPriceInput | null {
  const active = prices.find(
    (p) => p.effectiveTo === null && p.provider === provider && p.model === model,
  );
  if (!active) return null;
  return {
    inputPer1m: active.inputPer1m, outputPer1m: active.outputPer1m,
    cacheReadPer1m: active.cacheReadPer1m, cacheCreationPer1m: active.cacheCreationPer1m,
    reasoningPer1m: active.reasoningPer1m, currency: active.currency,
  };
}
