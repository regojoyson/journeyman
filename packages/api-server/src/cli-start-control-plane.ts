#!/usr/bin/env node
import Fastify from "fastify";
import { createLogger } from "@journeyman/core";
import { startControlPlane } from "@journeyman/api-control-plane";
import { loadEnv, compositionConfig } from "./_env.ts";
import { buildComposition } from "./composition.ts";

const log = createLogger("api-control-plane:cli");
loadEnv();

const composition = buildComposition(compositionConfig());
const stopLoops = startControlPlane(composition);

// Health-only server so k8s readiness/liveness has a port to probe.
const health = Fastify({ logger: false });
health.get("/healthz", async () => ({ ok: true }));
const port = Number(process.env.CONTROL_PLANE_PORT ?? 4003);
await health.listen({ port, host: "0.0.0.0" });
log.info({ port }, "api-control-plane running (health-only HTTP)");

const shutdown = async () => {
  log.info("shutting down api-control-plane");
  stopLoops();
  await health.close();
  await composition.shutdown();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
