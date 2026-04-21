export type RunStatus = 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled';
export type StepStatus = 'ok' | 'running' | 'failed' | 'blocked' | 'cancelled' | 'skipped' | 'pending';

export interface RunListItem {
  sessionId: string;
  productId: string;
  flowName: string;
  ticketKey: string;
  title: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export interface RunStep {
  id: string;       // step id, e.g. "fetch-ticket"
  phase: string;    // phase key, e.g. "getTicket"
  attempt: number;
  status: StepStatus;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string | Record<string, unknown>;
  waitFor?: string;
}

export interface ArtifactMeta {
  key: string;
  name: string;
  size: number;
  createdAt: string;
}

export interface RunDetail extends RunListItem {
  ticketShortKey: string;
  currentStep: string | null;
  steps: RunStep[];
  /** Accumulated step outputs keyed by artifact name (e.g. ticket, plan, pr). */
  artifacts: Record<string, unknown>;
  /** File artifact metadata — only present if blobs were stored. */
  artifactFiles?: ArtifactMeta[];
  flowSnapshot?: {
    name: string;
    steps: { id: string; phase: string }[];
  };
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
  total?: number;
}

export type FilterStatus = RunStatus | 'all';
