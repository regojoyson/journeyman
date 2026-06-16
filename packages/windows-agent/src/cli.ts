#!/usr/bin/env node
import { configFromEnv } from "./config.ts";
import { createAgentServer } from "./server.ts";
import { loadServerCredentials } from "./credentials.ts";
import { runReadinessChecks } from "./readiness.ts";
import { findGitBash } from "./shell.ts";

const config = configFromEnv();
const server = createAgentServer({ config });
const ready = await runReadinessChecks({ bashPath: findGitBash(), workspaceRoot: config.workspaceRoot, probe: async () => true });
for (const c of ready.checks) process.stderr.write(`[readiness] ${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}\n`);
if (!ready.ready) { process.stderr.write("agent not ready — fix the ✗ items above and restart\n"); process.exit(1); }

server.bindAsync(`${config.host}:${config.port}`, loadServerCredentials(config.certDir), (err, port) => {
  if (err) { process.stderr.write(`bind failed: ${err.message}\n`); process.exit(1); }
  process.stderr.write(`journeyman-agent listening on ${config.host}:${port} (mTLS)\n`);
});
