import { createLogger } from "@journeyman/core";
import type {
  ICodingCLI, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderResolver,
} from "@journeyman/core";

const log = createLogger("worker:checkout-repo");

/**
 * Wraps ICodingCLI.checkoutRepo.
 *
 * Inputs accepted (any of):
 *   - url           — repo URL (string)
 *   - workspaceDir  — directory the repo was cloned into (string, used as repo dirPath)
 *   - branch        — base branch to check out (string, optional)
 *   - ticket        — { id, title } (optional)
 *
 * Returns:
 *   - dirPath, branch, commitSha, newBranch
 */
export class CheckoutRepoPhaseHandler implements IPhaseHandler {
  readonly phaseType = "checkout-repo";

  constructor(private deps: { coding: ProviderResolver<ICodingCLI> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const url = typeof input.url === "string" ? input.url : undefined;
    const workspaceDir = typeof input.workspaceDir === "string" ? input.workspaceDir : undefined;
    const branch = typeof input.branch === "string" ? input.branch : undefined;

    // checkoutRepo accepts either URL strings or { dirPath, branch } entries.
    // If workspaceDir is provided, treat it as the local repo path; otherwise use url.
    const repos = workspaceDir
      ? [{ dirPath: workspaceDir, branch: branch ?? "main" }]
      : url ? [url] : null;
    if (!repos) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "checkout-repo requires `url` or `workspaceDir`",
          retryable: false,
        },
      };
    }

    const ticketRaw = (input as Record<string, unknown>).ticket;
    const ticket =
      ticketRaw && typeof ticketRaw === "object"
        && typeof (ticketRaw as { id?: unknown }).id === "string"
        && typeof (ticketRaw as { title?: unknown }).title === "string"
        ? { id: (ticketRaw as { id: string }).id, title: (ticketRaw as { title: string }).title }
        : undefined;

    const coding = this.deps.coding.resolve(
      typeof input.provider === "string" ? input.provider : undefined,
    );
    ctx.log(`Checking out ${workspaceDir ?? url}`);
    const result = await coding.checkoutRepo({
      repos, branch, ticket,
      sessionId: ctx.runId, signal: ctx.signal,
    });
    if (result?.error) {
      log.error({ result }, "checkout-repo failed");
      return {
        kind: "failure",
        failure: { errorClass: "CheckoutRepoFailed", message: String(result.error), retryable: true },
      };
    }
    const first = result.repos[0];
    return {
      kind: "success",
      output: {
        dirPath: first?.dirPath,
        branch: first?.baseBranch,
        commitSha: undefined,
        newBranch: result.newBranch,
        repos: result.repos,
      },
    };
  }
}
