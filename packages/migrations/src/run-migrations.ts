import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@journeyman/core";
import type { Pool } from "pg";

const log = createLogger("migrations");
const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = join(__dirname, "sql");

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jm_schema_migrations (
      id   TEXT PRIMARY KEY,
      ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  const files = (await readdir(SQL_DIR))
    .filter(f => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const id = file.replace(/\.sql$/, "");
    const exists = await pool.query(
      "SELECT 1 FROM jm_schema_migrations WHERE id = $1", [id],
    );
    if (exists.rowCount && exists.rowCount > 0) {
      log.info(`skip ${id} (already applied)`);
      continue;
    }
    const sql = await readFile(join(SQL_DIR, file), "utf8");
    log.info(`applying ${id}`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO jm_schema_migrations (id) VALUES ($1)", [id],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
