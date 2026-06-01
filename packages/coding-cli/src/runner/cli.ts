#!/usr/bin/env node
/**
 * journeyman-runner — reads a RunnerRequest JSON on stdin, runs the operation
 * via the Claude provider, and writes a RunnerResponse JSON on stdout. SDK log
 * lines go to stderr. `--selftest` prints a fixed ok response without invoking
 * the SDK (used by the image smoke test; needs no API key).
 */
import { ClaudeProvider } from "../index.ts";
import { runRunnerCli } from "./run-cli.ts";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  if (process.argv.includes("--selftest")) {
    process.stdout.write(JSON.stringify({ ok: true, structured: { selftest: true } }));
    return;
  }
  const input = await readStdin();
  const provider = new ClaudeProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
  const out = await runRunnerCli(input, provider, (line, meta) =>
    process.stderr.write(JSON.stringify({ line, meta }) + "\n"));
  process.stdout.write(out);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ ok: false, error: String((err as Error)?.message ?? err) }));
  process.exit(1);
});
