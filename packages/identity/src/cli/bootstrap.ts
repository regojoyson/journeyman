#!/usr/bin/env -S npx tsx
import { Pool } from "pg";
import { bootstrap } from "../bootstrap.ts";

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

async function main() {
  const orgName = arg("org");
  const orgSlug = arg("slug");
  const username = arg("username");
  const password = arg("password");
  const displayName = arg("display-name");

  if (!orgName || !orgSlug || !username || !password) {
    console.error("Usage: journeyman-bootstrap --org <name> --slug <slug> --username <u> --password <p> [--display-name <n>]");
    process.exit(2);
  }

  const url = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/journeyman";
  const pool = new Pool({ connectionString: url });
  try {
    const { user, org } = await bootstrap(pool, { orgName, orgSlug, username, password, displayName });
    console.log(JSON.stringify({ ok: true, org, user }, null, 2));
  } catch (err: any) {
    console.error("Bootstrap failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
