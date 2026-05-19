#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@journeyman/core";
import { WorkflowInstanceSyncer } from "@journeyman/orchestrator";
import { buildComposition } from "./composition.ts";
import { buildServer } from "./server.ts";

const log = createLogger("api-server:cli");

// Find .env by walking up from cwd and from this file's location
// (npm workspaces change cwd to the package dir, so cwd alone misses the repo root).
function findEnvFile(): string | null {
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const start of [process.cwd(), dirname(fileURLToPath(import.meta.url))]) {
    let dir = start;
    while (true) {
      if (!seen.has(dir)) {
        seen.add(dir);
        candidates.push(resolve(dir, ".env"));
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return candidates.find(p => existsSync(p)) ?? null;
}

const envFile = findEnvFile();
if (envFile) {
  loadDotenv({ path: envFile, override: false });
  log.info({ envFile }, "loaded .env");
}

const cfg = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/journeyman",
  conductorBaseUrl: process.env.CONDUCTOR_BASE_URL ?? "http://localhost:8080/api",
  storeBackend: (process.env.STORE_BACKEND as "memory" | "postgres" | undefined) ?? "postgres",
};

const composition = buildComposition(cfg);

const syncer = new WorkflowInstanceSyncer({
  workflowInstances: composition.workflowInstances,
  orchestrator: composition.orchestrator,
  events: composition.events,
  intervalMs: Number(process.env.RUN_SYNC_INTERVAL_MS ?? 1500),
});
syncer.start();

const server = await buildServer(composition);
const port = Number(process.env.PORT ?? 4000);
await server.listen({ port, host: "0.0.0.0" });
log.info({ port }, "api-server listening");

const shutdown = async () => {
  log.info("shutting down");
  syncer.stop();
  await server.close();
  await composition.shutdown();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
