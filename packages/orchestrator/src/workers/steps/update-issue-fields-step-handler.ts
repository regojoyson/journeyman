import { createLogger } from "@journeyman/core";
import type { IIssueProvider, IStepHandler, StepContext, StepInput, StepRunResult, ProviderFactory } from "@journeyman/core";

const log = createLogger("worker:update-issue");

export class UpdateIssueFieldsStepHandler implements IStepHandler {
  readonly stepType = "update-issue-fields";
  constructor(private deps: { issue: ProviderFactory<IIssueProvider> }) {}

  async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
    const id = typeof input.id === "string" ? input.id
      : typeof input.issueRef === "string" ? input.issueRef : undefined;
    if (!id) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "update-issue requires `id`/`issueRef`", retryable: false } };
    }
    const title = typeof input.title === "string" ? input.title : undefined;
    const description = typeof input.description === "string" ? input.description : undefined;
    const status = typeof input.status === "string" ? input.status : undefined;
    const assignee = typeof input.assignee === "string" ? input.assignee : undefined;
    const labels = Array.isArray(input.labels) && input.labels.every((l) => typeof l === "string") ? (input.labels as string[]) : undefined;
    const issueProvider = this.deps.issue(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Update issue ${id}`);
    const result = await issueProvider.updateIssue({ id, title, description, status, assignee, labels, sessionId: ctx.workflowInstanceId });
    if (result?.error) {
      log.error({ result }, "update-issue failed");
      return { kind: "failure", failure: { errorClass: "UpdateIssueFailed", message: String(result.error), retryable: true } };
    }
    return { kind: "success", output: { id: result.issue?.id ?? id, status: result.issue?.status } };
  }
}
