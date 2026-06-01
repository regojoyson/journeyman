import { spawn } from "node:child_process";

export interface DockerRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface DockerRunOptions {
  stdin?: string;
  signal?: AbortSignal;
  /** Called for each complete stderr line as it arrives. */
  onStderr?: (line: string) => void;
}

/** Runs a command (default the `docker` binary) and captures stdout/stderr/exit. */
export type DockerCommandRunner = (args: string[], opts?: DockerRunOptions) => Promise<DockerRunResult>;

export function makeProcessCommandRunner(binary = "docker"): DockerCommandRunner {
  return (args, opts = {}) =>
    new Promise<DockerRunResult>((resolve, reject) => {
      const child = spawn(binary, args, { signal: opts.signal });
      let stdout = "";
      let stderr = "";
      let stderrBuf = "";

      child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
      child.stderr.on("data", (d: Buffer) => {
        const text = d.toString("utf8");
        stderr += text;
        if (opts.onStderr) {
          stderrBuf += text;
          const parts = stderrBuf.split("\n");
          stderrBuf = parts.pop() ?? "";
          for (const line of parts) opts.onStderr(line);
        }
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (opts.onStderr && stderrBuf.length) opts.onStderr(stderrBuf);
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });

      if (opts.stdin !== undefined) {
        child.stdin.write(opts.stdin);
        child.stdin.end();
      }
    });
}
