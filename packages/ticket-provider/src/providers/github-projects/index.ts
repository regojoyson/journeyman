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
export class GitHubProjectsProvider implements ITicketProvider {
  static meta: IProviderMeta = {
    id: "github-projects",
    name: "GitHub Projects",
    description: "GitHub Projects (v2) as ticket provider",
    category: "ticket",
  };

  private client?: GitHubClient;

  constructor(private readonly opts: GitHubProjectsProviderOptions = {}) {}

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
    return getTicketSchema(this.getClient(), opts);
  }
  async addComment(opts: AddCommentOptions): Promise<AddCommentResult> {
    return addComment(this.getClient(), opts);
  }
  async updateStatus(opts: UpdateStatusOptions): Promise<UpdateStatusResult> {
    return updateStatus(this.getClient(), opts);
  }

  private getClient(): GitHubClient {
    if (!this.client) {
      const token =
        this.opts.token
        ?? (this.opts.tokenEnv ? process.env[this.opts.tokenEnv] : undefined)
        ?? process.env.GITHUB_ACCESS_TOKEN;
      if (!token) {
        throw new Error(
          "GitHubProjectsProvider: PAT required. Pass opts.token, set opts.tokenEnv to a populated env var, or set GITHUB_ACCESS_TOKEN.",
        );
      }
      this.client = createGitHubClient({
        token,
        userAgent: "journeyman-ticket-provider/0.1.0",
      });
    }
    return this.client;
  }
}
