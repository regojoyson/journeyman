import { createLogger } from "@journeyman/core";
import type {
  ICodingCLI, IStepHandler, StepContext, StepInput, StepRunResult, ProviderFactory,
} from "@journeyman/core";
import { resolveAgentLogLevel } from "./agent-log-level.ts";

const log = createLogger("worker:checkout-repo");

/**
 * Wraps ICodingCLI.checkoutRepo.
 *
 * Inputs accepted:
 *   - repos  — array of { repoDir, branch } objects (from clone-repos output)
 *   - issue  — { id, title } (optional, drives branch name)
 *
 * Returns:
 *   - newBranch, repos[] with updated repoDir and branch info
 */
export class StartFeatureBranchStepHandler implements IStepHandler {
  readonly stepType = "start-feature-branch";

  constructor(private deps: { coding: ProviderFactory<ICodingCLI> }) {}

  async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
    const reposRaw = input.repos;
    if (!Array.isArray(reposRaw) || reposRaw.length === 0) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "start-feature-branch requires `repos` (non-empty array of { repoDir, branch })",
          retryable: false,
        },
      };
    }

    const repos = reposRaw
      .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
      .map(r => ({
        repoDir: typeof r.repoDir === "string" ? r.repoDir : "",
        branch: typeof r.branch === "string" ? r.branch : "main",
      }))
      .filter(r => r.repoDir.length > 0);

    if (repos.length === 0) {
      return {
        kind: "failure",
        failure: { errorClass: "InvalidInput", message: "start-feature-branch: no valid repos with repoDir found", retryable: false },
      };
    }

    const issueRaw = (input as Record<string, unknown>).issue;
    const issue =
      issueRaw && typeof issueRaw === "object"
        && typeof (issueRaw as { id?: unknown }).id === "string"
        && typeof (issueRaw as { title?: unknown }).title === "string"
        ? { id: (issueRaw as { id: string }).id, title: (issueRaw as { title: string }).title }
        : undefined;

    const coding = this.deps.coding(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Checking out ${repos.length} repo(s)`);
    const agentLogLevel = resolveAgentLogLevel(input.agentLogLevel);
    const result = await coding.checkoutRepo({
      repos,
      issue,
      sessionId: ctx.workflowInstanceId,
      signal: ctx.signal,
      ...(agentLogLevel !== "none" ? { onLog: ctx.log, agentLogLevel } : {}),
    });
    if (result?.error) {
      log.error({ result }, "checkout-repo failed");
      return {
        kind: "failure",
        failure: { errorClass: "CheckoutRepoFailed", message: String(result.error), retryable: true },
      };
    }
    return {
      kind: "success",
      output: {
        newBranch: result.newBranch,
        repos: result.repos,
      },
    };
  }
}
