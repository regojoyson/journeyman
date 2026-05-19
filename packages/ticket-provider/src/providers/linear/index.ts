import type { IIssueProvider, IProviderMeta } from "@journeyman/core";
import type {
  CreateIssueOptions, CreateIssueResult,
  UpdateIssueOptions, UpdateIssueResult,
  GetIssueOptions, GetIssueResult,
  ListIssuesOptions, ListIssuesResult,
  GetIssueSchemaOptions, GetIssueSchemaResult,
  AddCommentOptions, AddCommentResult,
  UpdateStatusOptions, UpdateStatusResult,
} from "@journeyman/core";

/** Linear issue provider. Not yet implemented. */
export class LinearProvider implements IIssueProvider {
  static meta: IProviderMeta = {
    id: "linear",
    name: "Linear",
    description: "Linear issue tracker",
    category: "issue",
  };

  createIssue(_opts: CreateIssueOptions): Promise<CreateIssueResult> { throw new Error("LinearProvider.createIssue not implemented"); }
  updateIssue(_opts: UpdateIssueOptions): Promise<UpdateIssueResult> { throw new Error("LinearProvider.updateIssue not implemented"); }
  getIssue(_opts: GetIssueOptions): Promise<GetIssueResult> { throw new Error("LinearProvider.getIssue not implemented"); }
  listIssues(_opts: ListIssuesOptions): Promise<ListIssuesResult> { throw new Error("LinearProvider.listIssues not implemented"); }
  getIssueSchema(_opts: GetIssueSchemaOptions): Promise<GetIssueSchemaResult> { throw new Error("LinearProvider.getIssueSchema not implemented"); }
  addComment(_opts: AddCommentOptions): Promise<AddCommentResult> { throw new Error("LinearProvider.addComment not implemented"); }
  updateStatus(_opts: UpdateStatusOptions): Promise<UpdateStatusResult> { throw new Error("LinearProvider.updateStatus not implemented"); }
}
