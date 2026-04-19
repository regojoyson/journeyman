import { rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { resolveSession } from "../utils/session.ts";
import type {
  CleanupEntry,
  CleanupReposOptions,
  CleanupReposResult,
  CleanupRepoResult,
} from "@journeyman/core";

export type { CleanupEntry, CleanupReposOptions, CleanupReposResult, CleanupRepoResult };

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
    return { folderName, dirPath: absPath, success: false, error: refusal };
  }

  try {
    await rm(absPath, { recursive: true, force: true });
    return { folderName, dirPath: absPath, success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { folderName, dirPath: absPath, success: false, error: message };
  }
}

/**
 * Deletes each target directory entirely (recursive, force). Use as the final
 * step of a flow/ticket so the next run starts from a fresh workspace.
 *
 * Idempotent: missing paths are reported as success. Refuses to delete `/`,
 * `$HOME`, or `process.cwd()` — those entries return success=false with an
 * explanatory error, while other entries still run.
 *
 * @param opts - Repos to delete. Strings are treated as dirPaths.
 * @returns A CleanupReposResult with per-repo success/error details.
 *
 * @example
 * ```ts
 * const result = await cleanupRepos({
 *   repos: ["/tmp/workspace/ticket-123/api", "/tmp/workspace/ticket-123/web"],
 * });
 * ```
 */
export async function cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult> {
  const entries = normalizeEntries(opts);
  const { sessionId } = resolveSession(opts.sessionId);
  const repos = await Promise.all(entries.map(cleanupOne));
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
