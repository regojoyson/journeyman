import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { buildAnalyticsServer } from "./server.ts";

// Load .env the same way api-server does, so this service shares JWT_SECRET,
// IDENTITY_ENFORCE, etc. — otherwise token verification fails ("Auth failed").
// npm workspaces change cwd to the package dir, so walk up from both cwd and
// this file's location to find the repo-root .env.
function findEnvFile(): string | null {
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const start of [process.cwd(), dirname(fileURLToPath(import.meta.url))]) {
    let dir = start;
    while (true) {
      if (!seen.has(dir)) {
        seen.add(dir);
        candidates.push(resolve(dir, ".env"));
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return candidates.find((p) => existsSync(p)) ?? null;
}

const envFile = findEnvFile();
if (envFile) loadDotenv({ path: envFile, override: false });

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/journeyman";
const pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.PG_MAX ?? 10) });

const server = await buildAnalyticsServer(pool);
// Dedicated var — NOT the shared `PORT` (the loaded .env / k8s configMap set
// PORT=4000 for api-server; reusing it would bind 4000 and collide → EADDRINUSE).
const port = Number(process.env.ANALYTICS_PORT ?? 4002);
await server.listen({ port, host: "0.0.0.0" });
server.log.info({ port }, "analytics service listening");

const shutdown = async () => {
  await server.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
