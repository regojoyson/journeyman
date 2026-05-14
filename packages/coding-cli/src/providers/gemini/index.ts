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
  cleanupRepos(_opts: CleanupReposOptions): Promise<CleanupReposResult> { throw new Error("GeminiProvider.cleanupRepos not implemented"); }
  createWorkspace(_opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> { throw new Error("GeminiProvider.createWorkspace not implemented"); }
  runCustomPrompt(_opts: RunCustomPromptOptions): Promise<RunCustomPromptResult> { throw new Error("GeminiProvider.runCustomPrompt not implemented"); }
}
