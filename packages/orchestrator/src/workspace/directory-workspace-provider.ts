import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { IWorkspace, IWorkspaceProvider } from "@journeyman/core";

export interface DirectoryWorkspaceConfig {
  baseDir?: string;
}

export class DirectoryWorkspaceProvider implements IWorkspaceProvider {
  constructor(private cfg: DirectoryWorkspaceConfig = {}) {}

  async create(opts: { runId: string; nodeId: string }): Promise<IWorkspace> {
    const base = this.cfg.baseDir ?? join(tmpdir(), "journeyman-workspaces");
    const path = join(base, opts.runId, opts.nodeId);
    await mkdir(path, { recursive: true });
    return {
      path,
      destroy: async () => { await rm(path, { recursive: true, force: true }); },
    };
  }
}
