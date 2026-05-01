import type { ITicketProvider, IProviderMeta } from "@journeyman/core";
import type {
  CreateTicketOptions, CreateTicketResult,
  UpdateTicketOptions, UpdateTicketResult,
  GetTicketOptions, GetTicketResult,
  ListTicketsOptions, ListTicketsResult,
  GetTicketSchemaOptions, GetTicketSchemaResult,
  AddCommentOptions, AddCommentResult,
  UpdateStatusOptions, UpdateStatusResult,
} from "@journeyman/core";
import { createGitHubClient, type GitHubClient } from "@journeyman/github-api";
import { createTicket } from "./operations/create-ticket.ts";
import { updateTicket } from "./operations/update-ticket.ts";
import { getTicket } from "./operations/get-ticket.ts";
import { listTickets } from "./operations/list-tickets.ts";
import { getTicketSchema } from "./operations/get-ticket-schema.ts";
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
export class GitHubIssuesProvider implements ITicketProvider {
  static meta: IProviderMeta = {
    id: "github-issues",
    name: "GitHub Issues",
    description: "GitHub Issues as ticket provider",
    category: "ticket",
  };

  private client?: GitHubClient;

  constructor(private readonly opts: GitHubIssuesProviderOptions = {}) {}

  async createTicket(opts: CreateTicketOptions): Promise<CreateTicketResult> {
    return createTicket(this.getClient(), opts);
  }
  async updateTicket(opts: UpdateTicketOptions): Promise<UpdateTicketResult> {
    return updateTicket(this.getClient(), opts);
  }
  async getTicket(opts: GetTicketOptions): Promise<GetTicketResult> {
    return getTicket(this.getClient(), opts);
  }
  async listTickets(opts: ListTicketsOptions): Promise<ListTicketsResult> {
    return listTickets(this.getClient(), opts);
  }
  async getTicketSchema(opts: GetTicketSchemaOptions): Promise<GetTicketSchemaResult> {
    return getTicketSchema(opts);
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
        userAgent: "journeyman-ticket-provider/0.1.0",
      });
    }
    return this.client;
  }
}
