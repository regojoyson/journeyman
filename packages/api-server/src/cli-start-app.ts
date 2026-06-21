#!/usr/bin/env node
import { createLogger } from "@journeyman/core";
import { loadEnv, compositionConfig } from "./_env.ts";
import { buildComposition } from "./composition.ts";
import { buildAppServer } from "./server-app.ts";

const log = createLogger("api-app:cli");
loadEnv();

const composition = buildComposition(compositionConfig());
const server = await buildAppServer(composition);
const port = Number(process.env.PORT ?? 4000);
await server.listen({ port, host: "0.0.0.0" });
log.info({ port }, "api-app listening");

const shutdown = async () => {
  log.info("shutting down api-app");
  await server.close();
  await composition.shutdown();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
