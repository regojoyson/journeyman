import { rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createLogger } from "@journeyman/core";
import { resolveSession } from "../utils/session.ts";
import type {
  CleanupEntry,
  CleanupReposOptions,
  CleanupReposResult,
  CleanupRepoResult,
} from "@journeyman/core";

const log = createLogger("claude:cleanup-repos");

export type { CleanupEntry, CleanupReposOptions, CleanupReposResult, CleanupRepoResult };

function normalizeEntries(opts: CleanupReposOptions): CleanupEntry[] {
  const raw = Array.isArray(opts.repos) ? opts.repos : [opts.repos];
  return raw.map((r) => (typeof r === "string" ? { repoDir: r } : r));
}

function unsafeReason(absPath: string): string | null {
  if (!absPath) return "empty path";
  if (absPath === "/") return "refusing to delete filesystem root";
  if (absPath === process.env.HOME) return "refusing to delete user home";
  if (absPath === process.cwd()) return "refusing to delete current working directory";
  return null;
}

async function cleanupOne(entry: CleanupEntry): Promise<CleanupRepoResult> {
  const absPath = resolve(entry.repoDir);
  const folderName = basename(absPath);

  const refusal = unsafeReason(absPath);
  if (refusal) {
    log.warn({ repoDir: absPath, reason: refusal }, "cleanup refused — unsafe path");
    return { folderName, repoDir: absPath, success: false, error: refusal };
  }

  try {
    await rm(absPath, { recursive: true, force: true });
    log.debug({ repoDir: absPath }, "cleanup removed");
    return { folderName, repoDir: absPath, success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ repoDir: absPath, err: message }, "cleanup failed");
    return { folderName, repoDir: absPath, success: false, error: message };
  }
}

/**
 * Deletes each target directory entirely (recursive, force). Use as the final
 * step of a flow/issue so the next run starts from a fresh workspace.
 *
 * Idempotent: missing paths are reported as success. Refuses to delete `/`,
 * `$HOME`, or `process.cwd()` — those entries return success=false with an
 * explanatory error, while other entries still run.
 *
 * @param opts - Repos to delete. Strings are treated as repoDirs.
 * @returns A CleanupReposResult with per-repo success/error details.
 *
 * @example
 * ```ts
 * const result = await cleanupRepos({
 *   repos: ["/tmp/workspace/issue-123/api", "/tmp/workspace/issue-123/web"],
 * });
 * ```
 */
export async function cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult> {
  const entries = normalizeEntries(opts);
  const { sessionId } = resolveSession(opts.sessionId);
  log.info({ sessionId, repoCount: entries.length }, "cleanupRepos start");
  const repos = await Promise.all(entries.map(cleanupOne));
  log.info(
    {
      sessionId,
      successCount: repos.filter((r) => r.success).length,
      failureCount: repos.filter((r) => !r.success).length,
    },
    "cleanupRepos done",
  );
  return { repos, sessionId };
}

// Run directly: npx tsx cleanup-repos.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await cleanupRepos({
    repos: [
      "/tmp/journeyman-cleanup-test-a",
      "/tmp/journeyman-cleanup-test-b",
    ],
  });

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
