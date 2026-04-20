// packages/coding-cli/src/providers/opencode/operations/cleanup-repos.ts
import { rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createLogger } from "@journeyman/core";
import type {
  CleanupEntry,
  CleanupReposOptions,
  CleanupReposResult,
  CleanupRepoResult,
} from "@journeyman/core";

const log = createLogger("opencode:cleanup-repos");

function normalizeEntries(opts: CleanupReposOptions): CleanupEntry[] {
  const raw = Array.isArray(opts.repos) ? opts.repos : [opts.repos];
  return raw.map((r) => (typeof r === "string" ? { dirPath: r } : r));
}

function unsafeReason(absPath: string): string | null {
  if (!absPath) return "empty path";
  if (absPath === "/") return "refusing to delete filesystem root";
  if (absPath === process.env.HOME) return "refusing to delete user home";
  if (absPath === process.cwd()) return "refusing to delete current working directory";
  return null;
}

async function cleanupOne(entry: CleanupEntry): Promise<CleanupRepoResult> {
  const absPath = resolve(entry.dirPath);
  const folderName = basename(absPath);
  const refusal = unsafeReason(absPath);
  if (refusal) {
    log.warn({ dirPath: absPath, reason: refusal }, "cleanup refused — unsafe path");
    return { folderName, dirPath: absPath, success: false, error: refusal };
  }
  try {
    await rm(absPath, { recursive: true, force: true });
    log.debug({ dirPath: absPath }, "cleanup removed");
    return { folderName, dirPath: absPath, success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ dirPath: absPath, err: message }, "cleanup failed");
    return { folderName, dirPath: absPath, success: false, error: message };
  }
}

export async function cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult> {
  const entries = normalizeEntries(opts);
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  log.info({ sessionId, repoCount: entries.length }, "cleanupRepos start");
  const repos = await Promise.all(entries.map(cleanupOne));
  log.info({
    sessionId,
    successCount: repos.filter((r) => r.success).length,
    failureCount: repos.filter((r) => !r.success).length,
  }, "cleanupRepos done");
  return { repos, sessionId };
}
