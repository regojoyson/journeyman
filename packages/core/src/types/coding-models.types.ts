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
  /** Name of the secret slot holding the endpoint API key; blank = no key. */
  apiKeySlot?: string;
}

export type CodingModel = {
  id: string;
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
};

export type CodingModelUpdateInput = Partial<CodingModelCreateInput>;
