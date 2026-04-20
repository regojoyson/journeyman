// packages/coding-cli/src/providers/opencode/operations/create-workspace.ts
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createLogger } from "@journeyman/core";
import type { CreateWorkspaceOptions, CreateWorkspaceResult } from "@journeyman/core";

const log = createLogger("opencode:create-workspace");

function buildTimestamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 19).replace(/:/g, "-") + "Z";
}

export async function createWorkspace(opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  log.info({ sessionId, ticketId: opts.ticketId, parentDir: opts.parentDir }, "createWorkspace start");

  if (!opts.ticketId) {
    log.error({ sessionId }, "createWorkspace missing ticketId");
    return { folderName: "", dirPath: "", error: "ticketId is required", sessionId };
  }
  if (!opts.parentDir) {
    log.error({ sessionId }, "createWorkspace missing parentDir");
    return { folderName: "", dirPath: "", error: "parentDir is required", sessionId };
  }

  const folderName = `${opts.ticketId}-${buildTimestamp()}`;
  const dirPath = resolve(opts.parentDir, folderName);

  try {
    await mkdir(dirPath, { recursive: true });
    log.info({ sessionId, dirPath }, "createWorkspace done");
    return { folderName, dirPath, sessionId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ sessionId, dirPath, err: message }, "createWorkspace failed");
    return { folderName, dirPath, error: message, sessionId };
  }
}
