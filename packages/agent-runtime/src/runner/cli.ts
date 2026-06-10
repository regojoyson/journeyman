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

async function main(): Promise<void> {
  guardRunnerStdout();
  ensureNodeOnPath();
  markSandbox();
  if (process.argv.includes("--selftest")) {
    process.stdout.write(JSON.stringify({ ok: true, structured: { selftest: true } }));
    return;
  }
  const input = await readStdin();
  const out = await runRunnerCli(
    input,
    (key) => createCodingProvider(key, { env: process.env as Record<string, string> }),
    (line, meta) => process.stderr.write(JSON.stringify({ line, meta }) + "\n"),
  );
  process.stdout.write(out);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ ok: false, error: String((err as Error)?.message ?? err) }));
  process.exit(1);
});
