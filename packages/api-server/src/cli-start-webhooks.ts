#!/usr/bin/env node
import { createLogger } from "@journeyman/core";
import { loadEnv, compositionConfig } from "./_env.ts";
import { buildComposition } from "./composition.ts";
import { buildWebhookServer } from "./server-webhooks.ts";

const log = createLogger("api-webhooks:cli");
loadEnv();

const composition = buildComposition(compositionConfig());
const server = await buildWebhookServer(composition);
// Dedicated default port so it doesn't collide with api-app's PORT=4000
// when both read the same env (k8s configMap / .env set PORT=4000).
const port = Number(process.env.WEBHOOKS_PORT ?? 4001);
await server.listen({ port, host: "0.0.0.0" });
log.info({ port }, "api-webhooks listening");

const shutdown = async () => {
  log.info("shutting down api-webhooks");
  await server.close();
  await composition.shutdown();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
