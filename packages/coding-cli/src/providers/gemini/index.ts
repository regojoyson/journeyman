import type { ICodingCLI } from "../../interface.ts";
import type {
  CloneReposOptions, CloneReposResult,
  ScanReposOptions, ScanReposResult,
  ResetReposOptions, ResetReposResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
  AnalyzeOptions, AnalyzeResult,
  PlanOptions, PlanResult,
  ImplementOptions, ImplementResult,
  IProviderMeta,
} from "@journeyman/core";

/** Gemini coding CLI provider. Not yet implemented. */
export class GeminiProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "gemini",
    name: "Gemini CLI",
    description: "Google Gemini coding CLI",
    category: "coding-cli",
  };

  cloneRepos(_opts: CloneReposOptions): Promise<CloneReposResult> { throw new Error("GeminiProvider.cloneRepos not implemented"); }
  scanRepos(_opts: ScanReposOptions): Promise<ScanReposResult> { throw new Error("GeminiProvider.scanRepos not implemented"); }
  resetRepos(_opts: ResetReposOptions): Promise<ResetReposResult> { throw new Error("GeminiProvider.resetRepos not implemented"); }
  commitPushRepos(_opts: CommitPushReposOptions): Promise<CommitPushReposResult> { throw new Error("GeminiProvider.commitPushRepos not implemented"); }
  cleanupRepos(_opts: CleanupReposOptions): Promise<CleanupReposResult> { throw new Error("GeminiProvider.cleanupRepos not implemented"); }
  createWorkspace(_opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> { throw new Error("GeminiProvider.createWorkspace not implemented"); }
  analyze(_opts: AnalyzeOptions): Promise<AnalyzeResult> { throw new Error("GeminiProvider.analyze not implemented"); }
  plan(_opts: PlanOptions): Promise<PlanResult> { throw new Error("GeminiProvider.plan not implemented"); }
  implement(_opts: ImplementOptions): Promise<ImplementResult> { throw new Error("GeminiProvider.implement not implemented"); }
}
