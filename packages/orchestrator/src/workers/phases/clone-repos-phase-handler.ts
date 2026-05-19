import { createLogger } from "@journeyman/core";
import type {
  IGitProvider, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory,
} from "@journeyman/core";

const log = createLogger("worker:clone-repos");

/**
 * Wraps IGitProvider.cloneRepos.
 *
 * Required input keys:
 *   - repos      — single URL string, comma-separated URLs, or string[]
 *   - workspaceDir  — directory under which the repo(s) will be cloned (string)
 *
 * Optional:
 *   - branch     — branch to clone (defaults to remote default)
 *
 * Returns:
 *   - repos      — array of CloneResult { folderName, repoDir, url, branch, error? }
 */
export class CloneReposPhaseHandler implements IPhaseHandler {
  readonly phaseType = "clone-repos";

  constructor(private deps: { git: ProviderFactory<IGitProvider> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const reposRaw = input.repos;
    const workspaceDir = typeof input.workspaceDir === "string" ? input.workspaceDir : undefined;
    const branch = typeof input.branch === "string" ? input.branch : undefined;

    let repos: string | string[] | undefined;
    if (typeof reposRaw === "string") repos = reposRaw.includes(",") ? reposRaw.split(",").map(s => s.trim()).filter(Boolean) : reposRaw;
    else if (Array.isArray(reposRaw) && reposRaw.every((r) => typeof r === "string")) repos = reposRaw as string[];

    if (!repos || !workspaceDir) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "clone-repos requires string `repos` and string `workspaceDir`",
          retryable: false,
        },
      };
    }

    const git = this.deps.git(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Cloning repo(s) into ${workspaceDir}`);
    const result = await git.cloneRepos({ repos, workspaceDir, branch, signal: ctx.signal });
    if (result?.error) {
      log.error({ result }, "clone-repos failed");
      return {
        kind: "failure",
        failure: { errorClass: "CloneReposFailed", message: String(result.error), retryable: true },
      };
    }
    return { kind: "success", output: { repos: result.repos } };
  }
}
