import type { ICodingCLI } from "../../interface.ts";
import type {
  ScanReposOptions, ScanReposResult,
  CheckoutRepoOptions, CheckoutRepoResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
  RunCustomPromptOptions, RunCustomPromptResult,
  IProviderMeta,
  CodingCLIProviderConfig,
} from "@journeyman/core";

/** Codex coding CLI provider. Not yet implemented. */
export class CodexProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "codex",
    name: "Codex CLI",
    description: "OpenAI Codex CLI",
    category: "coding-cli",
  };

  constructor(private _config: CodingCLIProviderConfig = {}) {}

  scanRepos(_opts: ScanReposOptions): Promise<ScanReposResult> { throw new Error("CodexProvider.scanRepos not implemented"); }
  checkoutRepo(_opts: CheckoutRepoOptions): Promise<CheckoutRepoResult> { throw new Error("CodexProvider.checkoutRepo not implemented"); }
  cleanupRepos(_opts: CleanupReposOptions): Promise<CleanupReposResult> { throw new Error("CodexProvider.cleanupRepos not implemented"); }
  createWorkspace(_opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> { throw new Error("CodexProvider.createWorkspace not implemented"); }
  runCustomPrompt(_opts: RunCustomPromptOptions): Promise<RunCustomPromptResult> { throw new Error("CodexProvider.runCustomPrompt not implemented"); }
}
