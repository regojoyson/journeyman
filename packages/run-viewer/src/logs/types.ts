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
  phaseName: string;
  line: string;
  kind: LogKind;
  meta?: Record<string, unknown>;
}

export const KIND_COLOR: Record<LogKind, string> = {
  assistant: "#74b9ff",
  tool: "#fdcb6e",
  tool_result: "#a4b0be",
  result_ok: "#55efc4",
  result_err: "#ff7675",
  other: "#ddd",
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
