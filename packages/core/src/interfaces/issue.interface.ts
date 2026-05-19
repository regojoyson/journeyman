import type {
  CreateIssueOptions,
  CreateIssueResult,
  UpdateIssueOptions,
  UpdateIssueResult,
  GetIssueOptions,
  GetIssueResult,
  ListIssuesOptions,
  ListIssuesResult,
  GetIssueSchemaOptions,
  GetIssueSchemaResult,
  AddCommentOptions,
  AddCommentResult,
  UpdateStatusOptions,
  UpdateStatusResult,
} from "../types/issue.types.ts";

/**
 * Interface for issue tracker operations.
 * Implement this to add support for Jira, Linear, Monday, GitHub Issues, etc.
 */
export interface IIssueProvider {
  createIssue(opts: CreateIssueOptions): Promise<CreateIssueResult>;
  updateIssue(opts: UpdateIssueOptions): Promise<UpdateIssueResult>;
  getIssue(opts: GetIssueOptions): Promise<GetIssueResult>;
  listIssues(opts: ListIssuesOptions): Promise<ListIssuesResult>;
  getIssueSchema(opts: GetIssueSchemaOptions): Promise<GetIssueSchemaResult>;
  addComment(opts: AddCommentOptions): Promise<AddCommentResult>;
  updateStatus(opts: UpdateStatusOptions): Promise<UpdateStatusResult>;
}
