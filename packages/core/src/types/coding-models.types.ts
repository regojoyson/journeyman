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
  /** Org secret (jm_secrets.id, workspace_id IS NULL) that fills config.apiKeySlot at run time. */
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
};

export type CodingModelUpdateInput = Partial<CodingModelCreateInput>;
