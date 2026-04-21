import type { ICodingCLI } from "../../interface.ts";
import type {
  ScanReposOptions, ScanReposResult,
  CheckoutRepoOptions, CheckoutRepoResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
  AnalyzeOptions, AnalyzeResult,
  PlanOptions, PlanResult,
  ImplementOptions, ImplementResult,
  IProviderMeta,
  CodingCLIProviderConfig,
} from "@journeyman/core";

/** Gemini coding CLI provider. Not yet implemented. */
export class GeminiProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "gemini",
    name: "Gemini CLI",
    description: "Google Gemini coding CLI",
    category: "coding-cli",
  };

  constructor(private _config: CodingCLIProviderConfig = {}) {}

  scanRepos(_opts: ScanReposOptions): Promise<ScanReposResult> { throw new Error("GeminiProvider.scanRepos not implemented"); }
  checkoutRepo(_opts: CheckoutRepoOptions): Promise<CheckoutRepoResult> { throw new Error("GeminiProvider.checkoutRepo not implemented"); }
  commitPushRepos(_opts: CommitPushReposOptions): Promise<CommitPushReposResult> { throw new Error("GeminiProvider.commitPushRepos not implemented"); }
  cleanupRepos(_opts: CleanupReposOptions): Promise<CleanupReposResult> { throw new Error("GeminiProvider.cleanupRepos not implemented"); }
  createWorkspace(_opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> { throw new Error("GeminiProvider.createWorkspace not implemented"); }
  analyze(_opts: AnalyzeOptions): Promise<AnalyzeResult> { throw new Error("GeminiProvider.analyze not implemented"); }
  plan(_opts: PlanOptions): Promise<PlanResult> { throw new Error("GeminiProvider.plan not implemented"); }
  implement(_opts: ImplementOptions): Promise<ImplementResult> { throw new Error("GeminiProvider.implement not implemented"); }
}
