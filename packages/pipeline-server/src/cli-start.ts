#!/usr/bin/env node
import { startServer } from "./main.ts";

const configPath = process.argv[2] ?? "./config/pipeline.yaml";
startServer(configPath).catch(err => {
  console.error("Server failed to start:", err);
  process.exit(1);
});
