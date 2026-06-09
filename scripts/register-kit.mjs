#!/usr/bin/env node
// Read <base>/kit/kit.json (written by build:kit) and upsert the digests into
// the kit_images table. Requires DATABASE_URL and an applied 042 migration.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";
import { upsertKitImage } from "@journeyman/sandbox";

loadDotenv();

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { console.error("ERROR: DATABASE_URL is required"); process.exit(1); }

const base = process.env.JOURNEYMAN_BASE_DIR ?? join(homedir(), ".journeyman");
const outDir = process.env.KIT_OUT_DIR ?? join(base, "kit");
const kitJsonPath = join(outDir, "kit.json");

let kit;
try {
  kit = JSON.parse(readFileSync(kitJsonPath, "utf8"));
} catch (err) {
  console.error(`ERROR: cannot read ${kitJsonPath} — run 'npm run build:kit' first. (${err.message})`);
  process.exit(1);
}
if (!kit.base || !kit.bundle) {
  console.error(`ERROR: ${kitJsonPath} is missing base/bundle refs`);
  process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl });
try {
  await upsertKitImage(pool, "base", kit.base);
  await upsertKitImage(pool, "bundle", kit.bundle);
  console.log("✓ registered kit_images:");
  console.log(`  base:   ${kit.base}`);
  console.log(`  bundle: ${kit.bundle}`);
} finally {
  await pool.end();
}
