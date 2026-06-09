#!/usr/bin/env node
/**
 * journeyman-sandbox — operator cleanup for leftover run sandboxes.
 *   journeyman-sandbox list                 # show active tracked sandboxes
 *   journeyman-sandbox prune                # destroy all tracked sandboxes (use with care)
 *   journeyman-sandbox prune --run <runId>  # destroy one
 */
import { Pool } from "pg";
import { listActiveSandboxInstances, getSandboxInstance, markSandboxInstanceDestroyed, type SandboxInstanceRecord } from "./sandbox-instance-store.ts";
import { DockerExecutionEnvironment } from "./backends/docker/docker-execution-environment.ts";
import { makeDockerClient, type DockerConnection } from "./backends/docker/docker-client.ts";

const url = process.env.DATABASE_URL;
if (!url) { process.stderr.write("DATABASE_URL not set\n"); process.exit(1); }
const pool = new Pool({ connectionString: url });
const RUNNER_IMAGE = process.env.JOURNEYMAN_RUNNER_IMAGE ?? "journeyman/runner-base:dev";

async function destroy(sb: SandboxInstanceRecord): Promise<void> {
  const client = makeDockerClient(sb.connection as DockerConnection);
  const env = new DockerExecutionEnvironment({ client, defaultImage: RUNNER_IMAGE });
  await env.destroy({ runId: sb.runId, type: "docker", handle: sb.handle, volume: sb.volume ?? undefined, workspaceDir: "/workspace" });
  await markSandboxInstanceDestroyed(pool, sb.runId);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "list") {
    const rows = await listActiveSandboxInstances(pool);
    for (const r of rows) process.stdout.write(`${r.runId}\t${r.type}\t${r.handle}\t${r.volume ?? "-"}\n`);
    process.stdout.write(`${rows.length} active sandbox(es)\n`);
    return;
  }
  if (cmd === "prune") {
    const runFlagIdx = rest.indexOf("--run");
    if (runFlagIdx >= 0) {
      const runId = rest[runFlagIdx + 1];
      const sb = await getSandboxInstance(pool, runId);
      if (!sb || sb.status !== "active") { process.stderr.write(`no active sandbox for ${runId}\n`); process.exit(1); }
      await destroy(sb);
      process.stdout.write(`pruned ${runId}\n`);
      return;
    }
    const rows = await listActiveSandboxInstances(pool);
    for (const r of rows) { await destroy(r); process.stdout.write(`pruned ${r.runId}\n`); }
    process.stdout.write(`pruned ${rows.length} sandbox(es)\n`);
    return;
  }
  process.stderr.write("usage: journeyman-sandbox <list|prune> [--run <runId>]\n");
  process.exit(1);
}

main().then(() => pool.end()).catch((err) => { process.stderr.write(`${String(err)}\n`); process.exit(1); });
