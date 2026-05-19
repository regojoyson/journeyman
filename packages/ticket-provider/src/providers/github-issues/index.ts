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

export type GitHubIssuesProviderOptions = {
  /** Personal Access Token (explicit). Takes precedence over `tokenEnv`. */
  token?: string;
  /** Name of an env var to read the token from. */
  tokenEnv?: string;
};

/**
 * GitHub repo-level issue tracker provider.
 *
 * Backed by the GitHub REST API via Octokit. Deterministic — no LLM in the loop.
 * Requires a PAT with `repo` scope, sourced (in order) from `opts.token`,
 * `process.env[opts.tokenEnv]`, or `GITHUB_ACCESS_TOKEN`.
 *
 * - `opts.projectId` for create/list is `"owner/repo"`.
 * - `opts.id` for get/update is `"owner/repo#<number>"`.
 * - `status` maps to GitHub's binary `open`/`closed` (lossy).
 * - `priority`, `issueType`, `customFields` have no GitHub equivalent — ignored.
 */
export class GitHubIssuesProvider implements IIssueProvider {
  static meta: IProviderMeta = {
    id: "github-issues",
    name: "GitHub Issues",
    description: "GitHub Issues as issue provider",
    category: "issue",
  };

  private client?: GitHubClient;

  constructor(private readonly opts: GitHubIssuesProviderOptions = {}) {}

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
    return getIssueSchema(opts);
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
        throw new Error("GitHubIssuesProvider: opts.token is required.");
      }
      this.client = createGitHubClient({
        token: this.opts.token,
        userAgent: "journeyman-issue-provider/0.1.0",
      });
    }
    return this.client;
  }
}
