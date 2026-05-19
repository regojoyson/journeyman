import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { IWorkspace, IWorkspaceProvider } from "@journeyman/core";

export interface DirectoryWorkspaceConfig {
  baseDir?: string;
}

export class DirectoryWorkspaceProvider implements IWorkspaceProvider {
  constructor(private cfg: DirectoryWorkspaceConfig = {}) {}

  async create(opts: { workflowInstanceId: string; nodeId: string; userId?: string | null }): Promise<IWorkspace> {
    const base = this.cfg.baseDir ?? join(tmpdir(), "journeyman-workspaces");
    const userSeg = opts.userId ?? "anonymous";
    const path = join(base, userSeg, opts.workflowInstanceId, opts.nodeId);
    await mkdir(path, { recursive: true });
    return {
      path,
      destroy: async () => { await rm(path, { recursive: true, force: true }); },
    };
  }
}
