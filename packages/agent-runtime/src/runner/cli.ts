#!/usr/bin/env node
/**
 * journeyman-runner — reads a RunnerRequest JSON on stdin, runs the operation
 * via the selected provider, and writes a RunnerResponse JSON on stdout. SDK log
 * lines go to stderr. `--selftest` prints a fixed ok response without invoking
 * the SDK (used by the image smoke test; needs no API key).
 */
import { delimiter, dirname } from "node:path";
import { createCodingProvider } from "../index.ts";
import { runRunnerCli } from "./run-cli.ts";
import { guardRunnerStdout } from "./stdout-guard.ts";

/**
 * Guarantee the current Node binary is resolvable by bare name on PATH.
 *
 * The Claude Agent SDK launches its engine (cli.js) as a child process via the
 * bare command `node` — its `executable` option only accepts a runtime name
 * ('node' | 'bun' | 'deno'), never a path. The runner itself is started with an
 * ABSOLUTE node path (e.g. /opt/journeyman/node), so if that directory isn't on
 * PATH the engine spawn fails with ENOENT, which the SDK misreports as
 * "Claude Code executable not found … cli.js". Prepending dirname(process.execPath)
 * makes bare `node` resolve regardless of whether the image provides a symlink.
 */
function ensureNodeOnPath(): void {
  const dir = dirname(process.execPath);
  const parts = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  if (!parts.includes(dir)) {
    process.env.PATH = [dir, ...parts].join(delimiter);
  }
}

/**
 * Declare this runner as a sandbox so the Claude engine permits bypassPermissions
 * as root. The runner always executes inside an isolated, throwaway container, so
 * the engine's "--dangerously-skip-permissions cannot be used as root" guard is
 * inappropriate here; IS_SANDBOX=1 is the engine's intended opt-out for exactly
 * this case. Applies to every operation (scan/checkout/custom-prompt).
 */
function markSandbox(): void {
  if (!process.env.IS_SANDBOX) process.env.IS_SANDBOX = "1";
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Emit a runner diagnostic on stderr in the `{line, meta}` NDJSON shape the worker
 * forwards as a step.log event (see DockerExecutionEnvironment.forwardLog), so these
 * lines show up in the workflow instance's events for post-hoc debugging. stderr is
 * a separate channel from the stdout protocol, so this never corrupts the response.
 */
function diag(line: string, meta?: Record<string, unknown>): void {
  process.stderr.write(JSON.stringify({ line, meta: { ns: "runner", ...meta } }) + "\n");
}

/**
 * Names of the resources still keeping the event loop alive at this moment
 * (timers, sockets, child-process pipes, …). Logged right before exit so that if a
 * provider ever leaves a handle open again (the OpenCode SSE-subscription hang), the
 * culprit's resource type is visible in the run's events instead of a silent stall.
 * `getActiveResourcesInfo` exists on Node 18.4+; guard for older runtimes.
 */
function activeHandles(): string[] {
  const fn = (process as { getActiveResourcesInfo?: () => string[] }).getActiveResourcesInfo;
  return typeof fn === "function" ? fn.call(process) : [];
}

/**
 * Write the final RunnerResponse to stdout, then exit once it has flushed.
 *
 * The runner is one-shot: the worker reads it via `docker exec`, which only
 * returns when this process exits and the exec stream closes (see
 * DockerExecutionEnvironment.exec / docker-client.exec's `stream.on("end")`).
 * Returning from main() and letting the event loop drain is NOT enough — provider
 * SDKs can leave persistent handles on the loop (notably OpenCode's managed-server
 * SSE subscription), so the process would stay alive forever and the run would hang
 * with the result already computed but never delivered. Exiting explicitly
 * guarantees the stream ends. The write callback fires once the buffer is flushed
 * to the OS, so the response is never truncated by the exit.
 */
function writeResponseAndExit(out: string, code: number): void {
  // Diagnostic breadcrumb: reaching here proves the operation produced a response.
  // The active-handles list reveals anything still pinning the loop open — if a
  // future run hangs, either this line is absent (it stalled earlier, inside the
  // provider) or it names the leaked resource type.
  const handles = activeHandles();
  diag(`response ready (${out.length}B); exiting code=${code}; active handles: ${handles.join(",") || "none"}`, {
    bytes: out.length,
    code,
    handles,
  });
  process.stdout.write(out, () => process.exit(code));
}

/**
 * The operation's workspace (`opts.cwd`, e.g. /workspace), or undefined. Pure so
 * it can be unit-tested; the chdir side-effect stays in main().
 */
export function parseRequestCwd(input: string): string | undefined {
  try {
    const cwd = (JSON.parse(input) as { opts?: { cwd?: unknown } })?.opts?.cwd;
    return typeof cwd === "string" && cwd ? cwd : undefined;
  } catch {
    return undefined; // invalid JSON is reported by runRunnerCli downstream
  }
}

/**
 * Make the runner's cwd the operation's workspace before any provider runs.
 *
 * The OpenCode SDK spawns `opencode serve` with the runner's inherited cwd as its
 * project root (createOpencode passes no cwd to cross-spawn), and OpenCode judges
 * `external_directory` permissions against that root. Without this, the cloned repo
 * under /workspace is treated as OUTSIDE the project, so `external_directory:"deny"`
 * blocks every read/glob/bash against it and the agent falls back to remote/MCP.
 * The docker runner is one-shot per operation, so a process-wide chdir is safe.
 * Best-effort: a missing dir leaves cwd unchanged (paths are still absolute).
 */
function chdirToWorkspace(input: string): void {
  const cwd = parseRequestCwd(input);
  if (!cwd) return;
  try {
    process.chdir(cwd);
    diag(`runner cwd set to ${cwd}`, { cwd });
  } catch (err) {
    diag(`could not chdir to ${cwd}: ${String((err as Error)?.message ?? err)}`, { cwd });
  }
}

async function main(): Promise<void> {
  guardRunnerStdout();
  ensureNodeOnPath();
  markSandbox();
  if (process.argv.includes("--selftest")) {
    writeResponseAndExit(JSON.stringify({ ok: true, structured: { selftest: true } }), 0);
    return;
  }
  const input = await readStdin();
  chdirToWorkspace(input);
  const out = await runRunnerCli(
    input,
    (key) => createCodingProvider(key, { env: process.env as Record<string, string> }),
    (line, meta) => process.stderr.write(JSON.stringify({ line, meta }) + "\n"),
  );
  writeResponseAndExit(out, 0);
}

main().catch((err) => {
  writeResponseAndExit(JSON.stringify({ ok: false, error: String((err as Error)?.message ?? err) }), 1);
});
