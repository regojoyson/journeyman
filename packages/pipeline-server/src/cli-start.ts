#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createLogger } from "@journeyman/core";
import { startServer } from "./main.ts";

const log = createLogger("server:cli");

// Load .env if present — never overrides variables already set in process.env.
// This means: real env vars (Docker, systemd, CI) always win; .env fills in the rest.
const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile)) {
  const result = loadDotenv({ path: envFile, override: false });
  if (result.parsed) {
    log.info(`Loaded ${Object.keys(result.parsed).length} variable(s) from .env`);
  }
} else {
  log.info("No .env file found — using process environment only");
}

const configPath = process.argv[2] ?? "./config/pipeline.yaml";
startServer(configPath).catch(err => {
  log.error({ err }, "Server failed to start");
  process.exit(1);
});
