import { spawn } from "node:child_process";
import { redactString } from "@journeyman/core";

export interface SubprocessRecord {
  command: string;
  exitCode: number | null;
  stderrTail: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  redactArgs?: string[];
  stderrTailBytes?: number;
  signal?: AbortSignal;
}

const DEFAULT_TAIL = 2048;

export async function execTracked(
  cmd: string,
  args: string[],
  opts: ExecOptions = {},
): Promise<SubprocessRecord> {
  const tailLimit = opts.stderrTailBytes ?? DEFAULT_TAIL;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      signal: opts.signal,
    });
    let stderr = "";
    child.stderr?.on("data", chunk => {
      stderr += chunk.toString("utf8");
      if (stderr.length > tailLimit) stderr = stderr.slice(stderr.length - tailLimit);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const safeArgs = args.map(a =>
        opts.redactArgs?.includes(a) ? "[REDACTED]" : a,
      );
      const command = redactString([cmd, ...safeArgs].join(" "));
      resolve({ command, exitCode: code, stderrTail: stderr });
    });
  });
}
