import type { ICodingCLI } from "../../interface.ts";
import type { ScanReposOptions, ScanReposResult, ResetReposOptions, ResetReposResult, CommitPushReposOptions, CommitPushReposResult, CleanupReposOptions, CleanupReposResult, CreateWorkspaceOptions, CreateWorkspaceResult, AnalyzeOptions, AnalyzeResult, PlanOptions, PlanResult, ImplementOptions, ImplementResult, IProviderMeta } from "@journeyman/core";

/** Codex coding CLI provider. Not yet implemented. */
export class CodexProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "codex",
    name: "Codex CLI",
    description: "OpenAI Codex CLI",
    category: "coding-cli",
  };

  scanRepos(_opts: ScanReposOptions): Promise<ScanReposResult> { throw new Error("CodexProvider.scanRepos not implemented"); }
  resetRepos(_opts: ResetReposOptions): Promise<ResetReposResult> { throw new Error("CodexProvider.resetRepos not implemented"); }
  commitPushRepos(_opts: CommitPushReposOptions): Promise<CommitPushReposResult> { throw new Error("CodexProvider.commitPushRepos not implemented"); }
  cleanupRepos(_opts: CleanupReposOptions): Promise<CleanupReposResult> { throw new Error("CodexProvider.cleanupRepos not implemented"); }
  createWorkspace(_opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> { throw new Error("CodexProvider.createWorkspace not implemented"); }
  analyze(_opts: AnalyzeOptions): Promise<AnalyzeResult> { throw new Error("CodexProvider.analyze not implemented"); }
  plan(_opts: PlanOptions): Promise<PlanResult> { throw new Error("CodexProvider.plan not implemented"); }
  implement(_opts: ImplementOptions): Promise<ImplementResult> { throw new Error("CodexProvider.implement not implemented"); }
}
