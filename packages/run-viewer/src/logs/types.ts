export type LogKind =
  | "assistant"
  | "tool"
  | "tool_result"
  | "result_ok"
  | "result_err"
  | "other";

export interface ParsedLog {
  id: number;
  ts: Date;
  nodeId: string | null;
  stepName: string;
  line: string;
  kind: LogKind;
  meta?: Record<string, unknown>;
}

export const KIND_COLOR: Record<LogKind, string> = {
  assistant: "rgb(var(--color-info) / 1)",
  tool: "rgb(var(--color-warning) / 1)",
  tool_result: "rgb(var(--color-text) / 1)",
  result_ok: "rgb(var(--color-success) / 1)",
  result_err: "rgb(var(--color-danger) / 1)",
  other: "rgb(var(--color-text) / 1)",
};

export const KIND_LABEL: Record<LogKind, string> = {
  assistant: "Assistant",
  tool: "Tools",
  tool_result: "Tool results",
  result_ok: "Results",
  result_err: "Errors",
  other: "Other",
};

export const ALL_KINDS: LogKind[] = [
  "assistant",
  "tool",
  "tool_result",
  "result_ok",
  "result_err",
  "other",
];
