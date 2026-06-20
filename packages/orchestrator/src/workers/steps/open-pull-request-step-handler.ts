import { createLogger } from "@journeyman/core";
import type {
  IGitProvider, IStepHandler, StepContext, StepInput, StepRunResult, ProviderFactory,
} from "@journeyman/core";

const log = createLogger("worker:create-pr");

interface PrTarget {
  owner: string;
  repoName: string;
  /** Per-Repo base branch (the branch the repo was cloned from). Defaults to "main". */
  base: string;
}

interface InvalidTarget {
  reason: string;
  raw: unknown;
}

/**
 * Convert the bound `repos` input (a Repo[] from clone-repos / start-feature-branch)
 * into open-PR targets. Each Repo must have `owner` and `repoName` populated
 * (clone-repos parses these from the clone URL).
 */
function buildTargets(raw: unknown): { targets: PrTarget[]; invalid: InvalidTarget[] } {
  const invalid: InvalidTarget[] = [];
  if (!Array.isArray(raw) || raw.length === 0) {
    return { targets: [], invalid: [{ reason: "`repos` is missing or empty", raw }] };
  }
  const targets: PrTarget[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") {
      invalid.push({ reason: "entry is not an object", raw: r });
      continue;
    }
    const o = r as Record<string, unknown>;
    const owner = typeof o.owner === "string" && o.owner.length > 0 ? o.owner : undefined;
    const repoName = typeof o.repoName === "string" && o.repoName.length > 0 ? o.repoName : undefined;
    if (!owner || !repoName) {
      invalid.push({
        reason: `missing owner/repoName (clone-repos may have failed to parse the URL: ${typeof o.url === "string" ? o.url : "?"})`,
        raw: r,
      });
      continue;
    }
    const base = typeof o.branch === "string" && o.branch.length > 0 ? o.branch : "main";
    targets.push({ owner, repoName, base });
  }
  return { targets, invalid };
}

export class OpenPullRequestStepHandler implements IStepHandler {
  readonly stepType = "open-pull-request";
  constructor(private deps: { git: ProviderFactory<IGitProvider> }) {}

  async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
    const title = typeof input.title === "string" ? input.title : undefined;
    const sourceBranch = typeof input.sourceBranch === "string" ? input.sourceBranch : undefined;
    const body = typeof input.body === "string" ? input.body : undefined;

    if (!title || !sourceBranch) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "open-pull-request requires `title` and `sourceBranch`",
          retryable: false,
        },
      };
    }

    const { targets, invalid } = buildTargets(input.repos);
    if (targets.length === 0) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: `open-pull-request requires a non-empty \`repos\` (Repo[]). ${
            invalid.length > 0 ? `Issues: ${invalid.map((x) => x.reason).join("; ")}` : ""
          }`,
          retryable: false,
        },
      };
    }

    const git = this.deps.git(ctx.connection?.provider, ctx.env, ctx.connection);

    const pullRequests: Array<{
      id: string; url: string; number: number;
      owner: string; repo: string; sourceBranch: string; targetBranch: string;
      error?: string;
    }> = [];

    for (const t of targets) {
      ctx.log(`Creating PR ${t.owner}/${t.repoName} ${sourceBranch} → ${t.base}`);
      const result = await git.createPR({
        owner: t.owner,
        repo: t.repoName,
        title,
        body,
        sourceBranch,
        targetBranch: t.base,
        sessionId: ctx.workflowInstanceId,
      });
      if (result?.error) {
        log.error({ target: t, error: result.error }, "create-pr failed for target");
        pullRequests.push({
          id: "", url: "", number: 0,
          owner: t.owner, repo: t.repoName, sourceBranch, targetBranch: t.base,
          error: String(result.error),
        });
        continue;
      }
      pullRequests.push({
        id: result.id,
        url: result.url,
        number: result.number,
        owner: t.owner,
        repo: t.repoName,
        sourceBranch,
        targetBranch: t.base,
      });
    }

    // Surface invalid Repo entries (e.g. URL couldn't be parsed) as per-entry errors
    // alongside the successfully-attempted PRs, so users see them in the run view.
    for (const i of invalid) {
      pullRequests.push({
        id: "", url: "", number: 0,
        owner: "", repo: "", sourceBranch, targetBranch: "",
        error: i.reason,
      });
    }

    const failed = pullRequests.filter((p) => p.error);
    if (failed.length === pullRequests.length) {
      return {
        kind: "failure",
        failure: {
          errorClass: "CreatePrFailed",
          message: `all ${pullRequests.length} PR creation(s) failed: ${failed.map((p) => p.error).join("; ")}`,
          retryable: true,
        },
      };
    }

    return {
      kind: "success",
      output: { pullRequests },
    };
  }
}
