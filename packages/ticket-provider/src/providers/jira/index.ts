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
import { createIssue } from "./operations/create-issue.ts";
import { updateIssue } from "./operations/update-issue.ts";
import { getIssue } from "./operations/get-issue.ts";
import { listIssues } from "./operations/list-issues.ts";
import { getIssueSchema } from "./operations/get-issue-schema.ts";

export interface JiraProviderOptions {
  apiToken?: string;
  email?: string;
  host?: string;
}

export class JiraProvider implements IIssueProvider {
  static meta: IProviderMeta = {
    id: "jira",
    name: "Jira Cloud",
    description: "Atlassian Jira Cloud issue provider",
    category: "issue",
  };

  constructor(_opts: JiraProviderOptions = {}) {}

  createIssue(opts: CreateIssueOptions): Promise<CreateIssueResult> {
    return createIssue(opts);
  }
  updateIssue(opts: UpdateIssueOptions): Promise<UpdateIssueResult> {
    return updateIssue(opts);
  }
  getIssue(opts: GetIssueOptions): Promise<GetIssueResult> {
    return getIssue(opts);
  }
  listIssues(opts: ListIssuesOptions): Promise<ListIssuesResult> {
    return listIssues(opts);
  }
  getIssueSchema(opts: GetIssueSchemaOptions): Promise<GetIssueSchemaResult> {
    return getIssueSchema(opts);
  }
  addComment(_opts: AddCommentOptions): Promise<AddCommentResult> { throw new Error("JiraProvider.addComment not implemented"); }
  updateStatus(_opts: UpdateStatusOptions): Promise<UpdateStatusResult> { throw new Error("JiraProvider.updateStatus not implemented"); }
}
