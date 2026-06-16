import { spawn } from "node:child_process";

export interface SpawnRunnerOpts {
  command: string;
  args: string[];
  cwd: string;
  requestJson: string;
  env: Record<string, string>;
  onLog?: (line: string, meta?: Record<string, unknown>) => void;
  signal?: AbortSignal;
}
export interface RunnerResult { ok: boolean; structured?: unknown; error?: string; }

/** Spawn the runner, write the JSON request to stdin, stream stderr NDJSON logs, parse the single stdout JSON. */
export function spawnRunner(opts: SpawnRunnerOpts): Promise<RunnerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env, IS_SANDBOX: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    let stdout = "";
    let stderrBuf = "";
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => {
      stderrBuf += b.toString();
      let nl: number;
      while ((nl = stderrBuf.indexOf("\n")) >= 0) {
        const line = stderrBuf.slice(0, nl); stderrBuf = stderrBuf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { line?: string; meta?: Record<string, unknown> };
          if (typeof parsed.line === "string") { opts.onLog?.(parsed.line, parsed.meta); continue; }
        } catch { /* not NDJSON */ }
        opts.onLog?.(line);
      }
    });
    child.on("error", reject);
    child.on("close", () => {
      const text = stdout.trim();
      if (!text) return resolve({ ok: false, error: "runner produced no JSON output" });
      try {
        const parsed = JSON.parse(text) as RunnerResult & { result?: string };
        resolve({ ok: parsed.ok, structured: parsed.structured ?? parsed.result, error: parsed.error });
      } catch {
        resolve({ ok: false, error: `runner produced non-JSON output: ${text.slice(0, 200)}` });
      }
    });
    child.stdin.write(opts.requestJson);
    child.stdin.end();
  });
}
