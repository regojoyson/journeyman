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
  inputCostPer1M?: number;
  outputCostPer1M?: number;
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
  inputCostPer1M?: number;
  outputCostPer1M?: number;
};

export type CodingModelUpdateInput = Partial<CodingModelCreateInput>;
