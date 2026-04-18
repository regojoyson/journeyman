export type AnalyzeOptions = {
  dirPath: string;
  ticketContent?: string;
  focus?: string;
};

export type AnalyzeResult = {
  summary: string;
  insights: string[];
  error?: string;
};

export type PlanOptions = {
  dirPath: string;
  goal: string;
  context?: string;
};

export type PlanResult = {
  steps: string[];
  error?: string;
};

export type ImplementOptions = {
  dirPath: string;
  plan: string;
  branch: string;
};

export type ImplementResult = {
  success: boolean;
  filesChanged?: string[];
  error?: string;
};
