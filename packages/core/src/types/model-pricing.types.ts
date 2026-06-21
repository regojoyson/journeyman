/** Per-(provider×model) price, org-scoped and effective-dated. Rates are USD per 1M tokens. */
export type ModelPricing = {
  id: string;
  orgId: string;
  provider: string;
  vendor?: string;
  model: string;
  inputPer1m: number | null;
  outputPer1m: number | null;
  cacheReadPer1m: number | null;
  cacheCreationPer1m: number | null;
  reasoningPer1m: number | null;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ModelPricingCreateInput = {
  provider: string;
  vendor?: string;
  model: string;
  inputPer1m?: number | null;
  outputPer1m?: number | null;
  cacheReadPer1m?: number | null;
  cacheCreationPer1m?: number | null;
  reasoningPer1m?: number | null;
  currency?: string;
  /** ISO timestamp; defaults to now() server-side when omitted. */
  effectiveFrom?: string;
};

export type ModelPricingUpdateInput = Partial<Omit<ModelPricingCreateInput, "provider" | "model">>;

/** Editable rate fields surfaced in the coding-model form. USD per 1M tokens. */
export type ModelPriceInput = {
  inputPer1m?: number | null;
  outputPer1m?: number | null;
  cacheReadPer1m?: number | null;
  cacheCreationPer1m?: number | null;
  reasoningPer1m?: number | null;
  currency?: string;
};
