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

/** Monday.com issue provider. Not yet implemented. */
export class MondayProvider implements IIssueProvider {
  static meta: IProviderMeta = {
    id: "monday",
    name: "Monday.com",
    description: "Monday.com work-management provider",
    category: "issue",
  };

  createIssue(_opts: CreateIssueOptions): Promise<CreateIssueResult> { throw new Error("MondayProvider.createIssue not implemented"); }
  updateIssue(_opts: UpdateIssueOptions): Promise<UpdateIssueResult> { throw new Error("MondayProvider.updateIssue not implemented"); }
  getIssue(_opts: GetIssueOptions): Promise<GetIssueResult> { throw new Error("MondayProvider.getIssue not implemented"); }
  listIssues(_opts: ListIssuesOptions): Promise<ListIssuesResult> { throw new Error("MondayProvider.listIssues not implemented"); }
  getIssueSchema(_opts: GetIssueSchemaOptions): Promise<GetIssueSchemaResult> { throw new Error("MondayProvider.getIssueSchema not implemented"); }
  addComment(_opts: AddCommentOptions): Promise<AddCommentResult> { throw new Error("MondayProvider.addComment not implemented"); }
  updateStatus(_opts: UpdateStatusOptions): Promise<UpdateStatusResult> { throw new Error("MondayProvider.updateStatus not implemented"); }
}
