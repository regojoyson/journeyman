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
import { createGitHubClient, type GitHubClient } from "@journeyman/github-api";
import { createIssue } from "./operations/create-issue.ts";
import { updateIssue } from "./operations/update-issue.ts";
import { getIssue } from "./operations/get-issue.ts";
import { listIssues } from "./operations/list-issues.ts";
import { getIssueSchema } from "./operations/get-issue-schema.ts";
import { addComment } from "./operations/add-comment.ts";
import { updateStatus } from "./operations/update-status.ts";

export type GitHubProjectsProviderOptions = {
  token?: string;
  tokenEnv?: string;
};

/**
 * GitHub Projects V2 provider (draft issues).
 *
 * Backed by the GitHub GraphQL v4 API via Octokit. Deterministic — no LLM in
 * the loop. Requires a PAT with `project` + `read:project` scopes.
 *
 * - `opts.projectId` is `"owner/<project_number>"` (e.g. `"anthropics/42"`).
 * - `opts.id` for get/update is `"owner/<project_number>#<item_node_id>"`.
 *   `<item_node_id>` is the Projects V2 item global node ID (e.g. `PVTI_...`).
 * - Creates draft items only. Real issues added to a project are visible on
 *   read but not created through this provider (use `GitHubIssuesProvider`).
 * - `opts.status` maps to the project's Status field (single-select or text).
 * - `opts.customFields` keys are matched by field name (case-insensitive).
 */
export class GitHubProjectsProvider implements IIssueProvider {
  static meta: IProviderMeta = {
    id: "github-projects",
    name: "GitHub Projects",
    description: "GitHub Projects (v2) as issue provider",
    category: "issue",
  };

  private client?: GitHubClient;

  constructor(private readonly opts: GitHubProjectsProviderOptions = {}) {}

  async createIssue(opts: CreateIssueOptions): Promise<CreateIssueResult> {
    return createIssue(this.getClient(), opts);
  }
  async updateIssue(opts: UpdateIssueOptions): Promise<UpdateIssueResult> {
    return updateIssue(this.getClient(), opts);
  }
  async getIssue(opts: GetIssueOptions): Promise<GetIssueResult> {
    return getIssue(this.getClient(), opts);
  }
  async listIssues(opts: ListIssuesOptions): Promise<ListIssuesResult> {
    return listIssues(this.getClient(), opts);
  }
  async getIssueSchema(opts: GetIssueSchemaOptions): Promise<GetIssueSchemaResult> {
    return getIssueSchema(this.getClient(), opts);
  }
  async addComment(opts: AddCommentOptions): Promise<AddCommentResult> {
    return addComment(this.getClient(), opts);
  }
  async updateStatus(opts: UpdateStatusOptions): Promise<UpdateStatusResult> {
    return updateStatus(this.getClient(), opts);
  }

  private getClient(): GitHubClient {
    if (!this.client) {
      if (!this.opts.token) {
        throw new Error("GitHubProjectsProvider: opts.token is required.");
      }
      this.client = createGitHubClient({
        token: this.opts.token,
        userAgent: "journeyman-issue-provider/0.1.0",
      });
    }
    return this.client;
  }
}
