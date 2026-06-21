import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Find .env by walking up from cwd and from this file's location
// (npm workspaces change cwd to the package dir, so cwd alone misses the repo root).
function findEnvFile(): string | null {
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const start of [process.cwd(), dirname(fileURLToPath(import.meta.url))]) {
    let dir = start;
    while (true) {
      if (!seen.has(dir)) { seen.add(dir); candidates.push(resolve(dir, ".env")); }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function loadEnv(): void {
  const envFile = findEnvFile();
  if (envFile) loadDotenv({ path: envFile, override: false });
}

export function compositionConfig() {
  return {
    databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/journeyman",
    conductorBaseUrl: process.env.CONDUCTOR_BASE_URL ?? "http://localhost:8080/api",
  };
}
