import { createLogger } from "@journeyman/core";
import type {
  IGitProvider, IStepHandler, StepContext, StepInput, StepRunResult, ProviderFactory,
} from "@journeyman/core";
import { SandboxGitProvider } from "../../sandbox/sandbox-git-provider.ts";

const log = createLogger("worker:clone-repos");

/**
 * Wraps IGitProvider.cloneRepos.
 *
 * Required input keys:
 *   - repos  — single URL string, comma-separated URLs, or string[]
 *
 * Optional:
 *   - branch — branch to clone (defaults to remote default)
 *
 * Context:
 *   - ctx.workspaceDir — directory under which the repo(s) will be cloned;
 *                        provisioned automatically by the worker (not wired as an input).
 *
 * Returns:
 *   - repos  — array of CloneResult { folderName, repoDir, url, branch, error? }
 */
export class CloneReposStepHandler implements IStepHandler {
  readonly stepType = "clone-repos";
  readonly requiresWorkspace = true;

  constructor(private deps: { git: ProviderFactory<IGitProvider> }) {}

  async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
    const reposRaw = input.repos;
    const workspaceDir = ctx.workspaceDir;
    const branch = typeof input.branch === "string" ? input.branch : undefined;

    let repos: string | string[] | undefined;
    if (typeof reposRaw === "string") repos = reposRaw.includes(",") ? reposRaw.split(",").map(s => s.trim()).filter(Boolean) : reposRaw;
    else if (Array.isArray(reposRaw) && reposRaw.every((r) => typeof r === "string")) repos = reposRaw as string[];

    if (!repos) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "clone-repos requires string `repos`",
          retryable: false,
        },
      };
    }

    const git: Pick<IGitProvider, "cloneRepos"> = ctx.exec
      ? new SandboxGitProvider(ctx.exec)
      : this.deps.git(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
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
