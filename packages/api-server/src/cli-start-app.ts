#!/usr/bin/env node
import { createLogger } from "@journeyman/core";
import { loadEnv, compositionConfig } from "./_env.ts";
import { buildComposition } from "./composition.ts";
import { buildHttpServer } from "./server-http.ts";

const log = createLogger("api-http:cli");
loadEnv();

const composition = buildComposition(compositionConfig());
const server = await buildHttpServer(composition);
const port = Number(process.env.PORT ?? 4000);
await server.listen({ port, host: "0.0.0.0" });
log.info({ port }, "api-http listening");

const shutdown = async () => {
  log.info("shutting down api-http");
  await server.close();
  await composition.shutdown();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
