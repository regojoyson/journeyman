import type { SessionOptions, SessionResult } from "./session.types.ts";

export type AnalyzeOptions = SessionOptions & {
  dirPath: string;
  ticketContent?: string;
  focus?: string;
};

export type AnalyzeResult = SessionResult & {
  summary: string;
  insights: string[];
  error?: string;
};

export type PlanOptions = SessionOptions & {
  dirPath: string;
  goal: string;
  context?: string;
};

export type PlanResult = SessionResult & {
  steps: string[];
  error?: string;
};

export type ImplementOptions = SessionOptions & {
  dirPath: string;
  plan: string;
  branch: string;
};

export type ImplementResult = SessionResult & {
  success: boolean;
  filesChanged?: string[];
  error?: string;
};
