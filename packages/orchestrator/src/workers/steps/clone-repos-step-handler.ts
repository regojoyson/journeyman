import { createLogger, toRepoEntries } from "@journeyman/core";
import type {
  IGitProvider, IStepHandler, StepContext, StepInput, StepRunResult, ProviderFactory,
} from "@journeyman/core";
import { SandboxInstanceGitProvider, type SandboxGitAuth } from "../../sandbox/sandbox-instance-git-provider.ts";

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
    const workspaceDir = ctx.workspaceDir;
    const entries = toRepoEntries(input.repos);

    if (entries.length === 0) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "clone-repos requires at least one repo URL",
          retryable: false,
        },
      };
    }

    const auth: SandboxGitAuth | undefined = ctx.connection
      ? { provider: ctx.connection.provider, token: ctx.connection.credential, baseUrl: ctx.connection.baseUrl }
      : undefined;

    const git: Pick<IGitProvider, "cloneRepos"> = ctx.exec
      ? new SandboxInstanceGitProvider(ctx.exec, auth)
      : this.deps.git(ctx.connection?.provider, ctx.env, ctx.connection);

    const agentLogLevel = typeof input.agentLogLevel === "string" ? input.agentLogLevel : "light";
    const verbose = agentLogLevel === "medium" || agentLogLevel === "all";
    for (const r of entries) ctx.log(`Cloning ${r.url}…`);

    const result = await git.cloneRepos({
      repos: entries, workspaceDir, signal: ctx.signal,
      ...(verbose ? { onLog: ctx.log } : {}),
    });
    if (result?.error) {
      ctx.log(`⚠ clone failed: ${result.error}`);
      return {
        kind: "failure",
        failure: { errorClass: "CloneReposFailed", message: String(result.error), retryable: true },
      };
    }
    for (const r of result.repos) if (!r.error) ctx.log(`Cloned ${r.folderName}`);
    return { kind: "success", output: { repos: result.repos } };
  }
}
