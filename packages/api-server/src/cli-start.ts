#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createLogger } from "@journeyman/core";
import { RunSyncer } from "@journeyman/orchestrator";
import { buildComposition } from "./composition.ts";
import { buildServer } from "./server.ts";

const log = createLogger("api-server:cli");
const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile)) loadDotenv({ path: envFile, override: false });

const cfg = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/journeyman",
  conductorBaseUrl: process.env.CONDUCTOR_BASE_URL ?? "http://localhost:8080/api",
  storeBackend: (process.env.STORE_BACKEND as "memory" | "postgres" | undefined) ?? "postgres",
};

const composition = buildComposition(cfg);

const syncer = new RunSyncer({
  runs: composition.runs,
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
