import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createLogger } from "@journeyman/core";
import { resolveSession } from "../utils/session.ts";
import type {
  CreateWorkspaceOptions,
  CreateWorkspaceResult,
} from "@journeyman/core";

const log = createLogger("claude:create-workspace");

export type { CreateWorkspaceOptions, CreateWorkspaceResult };

function buildTimestamp(now: Date = new Date()): string {
  // "2026-04-18T14:30:22.123Z" -> "2026-04-18T14-30-22Z"
  return now.toISOString().slice(0, 19).replace(/:/g, "-") + "Z";
}

/**
 * Creates a fresh directory for a ticket/flow under `baseDir`, named
 * `<issueRef>-<ISO-timestamp>` (e.g. "jira:PROJ-123-2026-04-18T14-30-22Z").
 *
 * The parent directory is created recursively if missing. If the target
 * directory already exists (unlikely — collisions require two calls in the
 * same second for the same ticket), it is silently reused.
 *
 * Returns per-call success with folderName + absolute repoDir. On failure
 * the error field is populated — never throws.
 *
 * @example
 * ```ts
 * const result = await createWorkspace({
 *   issueRef: "PROJ-123",
 *   baseDir: "/tmp/journeyman-workspace",
 * });
 * // result.repoDir === "/tmp/journeyman-workspace/PROJ-123-2026-04-18T14-30-22Z"
 * ```
 */
export async function createWorkspace(
  opts: CreateWorkspaceOptions
): Promise<CreateWorkspaceResult> {
  const { sessionId } = resolveSession(opts.sessionId);
  log.info({ sessionId, issueRef: opts.issueRef, baseDir: opts.baseDir }, "createWorkspace start");

  if (!opts.issueRef) {
    log.error({ sessionId }, "createWorkspace missing issueRef");
    return { folderName: "", repoDir: "", error: "issueRef is required", sessionId };
  }
  if (!opts.baseDir) {
    log.error({ sessionId }, "createWorkspace missing baseDir");
    return { folderName: "", repoDir: "", error: "baseDir is required", sessionId };
  }

  const folderName = `${opts.issueRef}-${buildTimestamp()}`;
  const repoDir = resolve(opts.baseDir, folderName);

  try {
    await mkdir(repoDir, { recursive: true });
    log.info({ sessionId, repoDir }, "createWorkspace done");
    return { folderName, repoDir, sessionId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ sessionId, repoDir, err: message }, "createWorkspace failed");
    return { folderName, repoDir, error: message, sessionId };
  }
}

// Run directly: npx tsx create-workspace.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await createWorkspace({
    issueRef: "PROJ-123",
    baseDir: "/tmp/journeyman-workspace",
  });

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
