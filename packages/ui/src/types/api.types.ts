// packages/ui/src/types/api.types.ts

export type RunStatus = 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled';

export interface RunListItem {
  sessionId: string;
  productId: string;
  flowName: string;
  ticketKey: string;
  title: string;
  status: RunStatus;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export interface RunStep {
  stepId: string;
  name: string;
  status: RunStatus;
  startedAt: string | null;
  endedAt: string | null;
  duration: number | null;   // seconds
  logLines: number;
  outputs?: Record<string, unknown>;
}

export interface ArtifactMeta {
  key: string;
  name: string;
  size: number;
  createdAt: string;
}

export interface RunDetail extends RunListItem {
  steps: RunStep[];
  artifacts: ArtifactMeta[];
}

export interface LogLine {
  id: string;
  timestamp: string;
  level: string;
  message: string;
  source: string;
}

export interface ProductOption {
  id: string;
  name: string;
}

export interface FlowDefinition {
  name: string;
  phases: string[];
}

export interface ProviderCategory {
  name: string;
  providers: string[];
}

export interface RunListResponse {
  runs: RunListItem[];
  total: number;
}

export type FilterStatus = RunStatus | 'all';
