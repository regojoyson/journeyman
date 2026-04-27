#!/usr/bin/env node
/**
 * Standalone worker process. Polls Conductor for tasks of the registered
 * phase types and dispatches them to handlers.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createLogger } from "@journeyman/core";
import { ClaudeProvider } from "@journeyman/coding-cli";
import { ConductorClient } from "./engines/conductor/conductor-client.ts";
import { InMemoryPhaseRegistry } from "./registry/in-memory-phase-registry.ts";
import { DirectoryWorkspaceProvider } from "./workspace/directory-workspace-provider.ts";
import { EnvCredentialStore } from "./credentials/env-credential-store.ts";
import { MemoryEventBus } from "./stores/memory/memory-event-bus.ts";
import { WorkerHarness } from "./workers/worker-harness.ts";
import { AnalyzePhaseHandler } from "./workers/phases/analyze-phase-handler.ts";

const log = createLogger("worker:cli");
const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile)) loadDotenv({ path: envFile, override: false });

const baseUrl = process.env.CONDUCTOR_BASE_URL ?? "http://localhost:8080/api";
const client = new ConductorClient({ baseUrl });

const registry = new InMemoryPhaseRegistry();
registry.register(new AnalyzePhaseHandler({ coding: new ClaudeProvider() }));

// Register matching task definitions (idempotent)
for (const handler of registry.list()) {
  await client.putTaskDef({
    name: handler.phaseType,
    retryCount: 0,
    timeoutSeconds: 600,
    timeoutPolicy: "TIME_OUT_WF",
    retryLogic: "FIXED",
    retryDelaySeconds: 0,
    responseTimeoutSeconds: 600,
    ownerEmail: "ops@journeyman.local",
  });
}

const harness = new WorkerHarness({
  client,
  registry,
  workspace: new DirectoryWorkspaceProvider(),
  credentials: new EnvCredentialStore(),
  events: new MemoryEventBus(),
  workerId: process.env.WORKER_ID ?? `worker-${process.pid}`,
  pollIntervalMs: 500,
});

log.info({ phases: registry.list().map(h => h.phaseType) }, "worker starting");
await harness.start(registry.list().map(h => h.phaseType));
