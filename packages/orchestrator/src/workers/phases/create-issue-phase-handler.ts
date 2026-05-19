import { createLogger } from "@journeyman/core";
import type { IIssueProvider, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory } from "@journeyman/core";

const log = createLogger("worker:create-issue");

export class CreateIssuePhaseHandler implements IPhaseHandler {
  readonly phaseType = "create-issue";
  constructor(private deps: { issue: ProviderFactory<IIssueProvider> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const title = typeof input.title === "string" ? input.title : undefined;
    if (!title) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "create-issue requires `title`", retryable: false } };
    }
    const description = typeof input.description === "string" ? input.description : undefined;
    const assignee = typeof input.assignee === "string" ? input.assignee : undefined;
    const projectId = typeof input.projectId === "string" ? input.projectId : undefined;
    const labels = Array.isArray(input.labels) && input.labels.every((l) => typeof l === "string") ? (input.labels as string[]) : undefined;
    const issueProvider = this.deps.issue(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Create issue "${title}"`);
    const result = await issueProvider.createIssue({ title, description, assignee, projectId, labels, sessionId: ctx.workflowInstanceId });
    if (result?.error || !result?.issue) {
      log.error({ result }, "create-issue failed");
      return { kind: "failure", failure: { errorClass: "CreateIssueFailed", message: String(result?.error ?? "no issue returned"), retryable: true } };
    }
    return { kind: "success", output: { id: result.issue.id, url: result.issue.url, status: result.issue.status } };
  }
}
