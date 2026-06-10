import { createLogger, type AgentLogLevel, type CodingCliLogFn } from "@journeyman/core";

const log = createLogger("aisdk:sdk");
const MAX = 200;

function singleLine(s: string, max = MAX): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}
function summarize(input: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;
  if (typeof inp.command === "string") return `$ ${singleLine(inp.command, 120)}`;
  if (typeof inp.path === "string") return singleLine(inp.path, 120);
  if (typeof inp.pattern === "string") return singleLine(inp.pattern, 120);
  if (typeof inp.url === "string") return singleLine(inp.url, 120);
  const keys = Object.keys(inp);
  return keys.length ? keys.join(",") : "";
}

interface StepLike {
  text?: string;
  toolCalls?: Array<{ toolName?: string; input?: unknown; args?: unknown }>;
  toolResults?: Array<{ toolName?: string; output?: unknown; result?: unknown }>;
}

export function makeStepLogger(onLog?: CodingCliLogFn, level: AgentLogLevel = "all") {
  const ui = onLog && level !== "none" ? onLog : undefined;
  return (step: StepLike): void => {
    if (step.text) log.debug({ text: step.text }, "assistant");
    if (ui && level === "all" && step.text) ui(singleLine(`🤖 assistant: ${step.text}`), {});
    for (const c of step.toolCalls ?? []) {
      const name = c.toolName ?? "tool";
      log.debug({ tool: name }, "tool use");
      if (ui && (level === "medium" || level === "all")) {
        const a = summarize(c.input ?? c.args);
        ui(singleLine(a ? `🔧 tool: ${name}(${a})` : `🔧 tool: ${name}`), {});
      }
    }
    for (const r of step.toolResults ?? []) {
      if (ui && level === "all") {
        const out = r.output ?? r.result;
        const isErr = Boolean((out as any)?.exitCode) || Boolean((out as any)?.error);
        ui(`📥 tool_result: ${isErr ? "error" : "ok"}`, {});
      }
    }
  };
}

export function logFinal(ok: boolean, reason: string | undefined, onLog?: CodingCliLogFn, level: AgentLogLevel = "all"): void {
  log.debug({ ok, reason }, "aisdk done");
  if (!onLog || level === "none") return;
  if (level === "light" || level === "medium" || level === "all") {
    onLog(ok ? "✅ result: success" : `❌ result: ${reason ?? "failure"}`, {});
  }
}
