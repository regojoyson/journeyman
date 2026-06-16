import { mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { extract } from "tar";
import type { RunInfo } from "@journeyman/agent-protocol";

export async function provisionDir(root: string, runId: string): Promise<{ handle: string; workspaceDir: string }> {
  const workspaceDir = join(root, runId);
  await mkdir(workspaceDir, { recursive: true });
  return { handle: `win:${runId}`, workspaceDir };
}

export async function destroyDir(root: string, runId: string): Promise<void> {
  await rm(join(root, runId), { recursive: true, force: true });
}

export async function listRuns(root: string): Promise<RunInfo[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => ({
    run_id: e.name, handle: `win:${e.name}`, workspace_dir: join(root, e.name),
  }));
}

/**
 * Replace destDir's contents with the tar. Maps the container `/workspace`
 * convention onto the real Windows workspace dir; uses Node fs (no shell `rm`).
 */
export async function materializeTar(workspaceDir: string, destDir: string, tar: Buffer): Promise<void> {
  const abs = destDir.startsWith(workspaceDir)
    ? destDir
    : destDir.startsWith("/workspace")
      ? join(workspaceDir, destDir.replace(/^\/workspace\/?/, ""))
      : join(workspaceDir, destDir.replace(/^[/\\]/, ""));
  await rm(abs, { recursive: true, force: true });
  await mkdir(abs, { recursive: true });
  if (tar.length === 0) return;
  await new Promise<void>((resolve, reject) => {
    Readable.from(tar).pipe(extract({ cwd: abs })).on("finish", resolve).on("error", reject);
  });
}
