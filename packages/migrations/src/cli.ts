#!/usr/bin/env node
/**
 * Migration CLI. Reads DATABASE_URL from env, applies any pending SQL files
 * in src/sql/ in lexicographic order, then exits.
 */
import { Pool } from "pg";
import { createLogger } from "@journeyman/core";
import { runMigrations } from "./run-migrations.ts";

const log = createLogger("migrations:cli");

const url = process.env.DATABASE_URL;
if (!url) {
  log.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
runMigrations(pool)
  .then(() => { log.info("migrations done"); return pool.end(); })
  .catch(err => { log.error(err, "migration failed"); process.exit(1); });
