import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveSession } from "../utils/session.ts";
import type {
  CreateWorkspaceOptions,
  CreateWorkspaceResult,
} from "@journeyman/core";

export type { CreateWorkspaceOptions, CreateWorkspaceResult };

function buildTimestamp(now: Date = new Date()): string {
  // "2026-04-18T14:30:22.123Z" -> "2026-04-18T14-30-22Z"
  return now.toISOString().slice(0, 19).replace(/:/g, "-") + "Z";
}

/**
 * Creates a fresh directory for a ticket/flow under `parentDir`, named
 * `<ticketId>-<ISO-timestamp>` (e.g. "PROJ-123-2026-04-18T14-30-22Z").
 *
 * The parent directory is created recursively if missing. If the target
 * directory already exists (unlikely — collisions require two calls in the
 * same second for the same ticket), it is silently reused.
 *
 * Returns per-call success with folderName + absolute dirPath. On failure
 * the error field is populated — never throws.
 *
 * @example
 * ```ts
 * const result = await createWorkspace({
 *   ticketId: "PROJ-123",
 *   parentDir: "/tmp/journeyman-workspace",
 * });
 * // result.dirPath === "/tmp/journeyman-workspace/PROJ-123-2026-04-18T14-30-22Z"
 * ```
 */
export async function createWorkspace(
  opts: CreateWorkspaceOptions
): Promise<CreateWorkspaceResult> {
  const { sessionId } = resolveSession(opts.sessionId);

  if (!opts.ticketId) {
    return { folderName: "", dirPath: "", error: "ticketId is required", sessionId };
  }
  if (!opts.parentDir) {
    return { folderName: "", dirPath: "", error: "parentDir is required", sessionId };
  }

  const folderName = `${opts.ticketId}-${buildTimestamp()}`;
  const dirPath = resolve(opts.parentDir, folderName);

  try {
    await mkdir(dirPath, { recursive: true });
    return { folderName, dirPath, sessionId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { folderName, dirPath, error: message, sessionId };
  }
}

// Run directly: npx tsx create-workspace.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await createWorkspace({
    ticketId: "PROJ-123",
    parentDir: "/tmp/journeyman-workspace",
  });

  console.log(JSON.stringify(result, null, 2));
}
