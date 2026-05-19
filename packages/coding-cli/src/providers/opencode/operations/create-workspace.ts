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
