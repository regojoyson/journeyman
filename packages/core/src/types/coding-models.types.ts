/**
 * Provider-specific configuration for a coding model. Only OpenCode uses it today,
 * to point a model at a custom endpoint (local/self-hosted/gateway). Empty for
 * cloud models, which resolve via OpenCode's built-in provider catalog.
 */
export interface CodingModelConfig {
  /** Custom endpoint base URL, e.g. http://host.docker.internal:1234/v1. */
  baseUrl?: string;
  /** AI-SDK npm package for the provider; defaults to "@ai-sdk/openai-compatible". */
  npm?: string;
  /** Whether this model needs an API key bound (replaces the old typed apiKeySlot). */
  requiresApiKey?: boolean;
  /**
   * Whether to request token usage on streamed responses via
   * `stream_options.include_usage`. OpenCode streams, and OpenAI-compatible
   * servers (e.g. LM Studio, vLLM) only attach usage to streamed responses when
   * this is set. Defaults to true for the "@ai-sdk/openai-compatible" npm; set
   * false for a strict endpoint that rejects stream_options. Ignored by non-
   * openai-compatible providers unless explicitly set. OpenCode-only (the aisdk
   * provider uses non-streaming generateText and already returns usage).
   */
  includeUsage?: boolean;
  /**
   * Whether this model is a reasoning/thinking model. OpenCode-only: when true,
   * the model is declared to the OpenCode server with `reasoning: true` so the
   * server enables and parses its thinking channel (otherwise a reasoning model's
   * output is mishandled and its narration is dropped). Populated at model-resolve
   * time from the coding model's `supportsThinking` flag, not edited in the UI
   * config blob directly. Ignored by the aisdk/claude providers.
   */
  reasoning?: boolean;
  /**
   * @deprecated Legacy typed env-var label. No longer read; the label is derived
   * by codingModelKeySlot(). Kept only so old JSONB rows still parse.
   */
  apiKeySlot?: string;
}

export type CodingModel = {
  id: string;
  orgId: string;
  provider: string;
  modelId: string;
  label: string;
  description?: string;
  sortOrder: number;
  enabled: boolean;
  deprecated: boolean;
  isDefault: boolean;
  supportsThinking: boolean;
  contextWindow?: number;
  config?: CodingModelConfig;
  /** Org secret (jm_secrets.id, workspace_id IS NULL) injected under the derived key slot at run time (see codingModelKeySlot). */
  apiKeySecretId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CodingModelCreateInput = {
  provider: string;
  modelId: string;
  label: string;
  description?: string;
  sortOrder?: number;
  enabled?: boolean;
  deprecated?: boolean;
  isDefault?: boolean;
  supportsThinking?: boolean;
  contextWindow?: number;
  config?: CodingModelConfig;
  apiKeySecretId?: string;
  /** Optional pricing entered in the model form; persisted to jm_model_pricing on save. */
  pricing?: import("./model-pricing.types.ts").ModelPriceInput;
};

export type CodingModelUpdateInput = Partial<CodingModelCreateInput>;
