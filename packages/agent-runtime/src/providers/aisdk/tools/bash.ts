import { spawn } from "node:child_process";
import { tool, jsonSchema } from "ai";
import { findBashEscape } from "../../../workspace-guard/index.ts";

export interface ToolCtx {
  cwd?: string;
  env?: Record<string, string>;
}

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 100_000;

export function runBash(command: string, ctx: ToolCtx, signal?: AbortSignal): Promise<BashResult> {
  if (ctx.cwd) {
    const bad = findBashEscape(command, ctx.cwd);
    if (bad) {
      return Promise.resolve({
        stdout: "",
        stderr: `blocked: '${bad}' is outside the workspace root '${ctx.cwd}'. Operate only within the workspace.`,
        exitCode: 1,
      });
    }
  }
  return new Promise<BashResult>((resolve) => {
    const child = spawn("bash", ["-lc", command], {
      cwd: ctx.cwd,
      env: { ...process.env, ...(ctx.env ?? {}) },
      signal,
    });
    let stdout = "";
    let stderr = "";
    const cap = (cur: string, chunk: Buffer) =>
      cur.length < MAX_OUTPUT ? cur + chunk.toString("utf8") : cur;
    child.stdout.on("data", (c) => { stdout = cap(stdout, c); });
    child.stderr.on("data", (c) => { stderr = cap(stderr, c); });
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + String((err as Error).message), exitCode: 1 });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

export function bashTool(ctx: ToolCtx) {
  return tool({
    description: "Run a shell command in the workspace and return its stdout, stderr, and exit code.",
    inputSchema: jsonSchema<{ command: string }>({
      type: "object",
      properties: { command: { type: "string", description: "The shell command to run." } },
      required: ["command"],
    }),
    execute: async ({ command }, { abortSignal }) => runBash(command, ctx, abortSignal),
  });
}
