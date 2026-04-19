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
import { connectGitHubMcp, type Client } from "@journeyman/github-mcp";
import { createTicket } from "./operations/create-ticket.ts";
import { updateTicket } from "./operations/update-ticket.ts";
import { getTicket } from "./operations/get-ticket.ts";
import { listTickets } from "./operations/list-tickets.ts";
import { getTicketSchema } from "./operations/get-ticket-schema.ts";
import { addComment } from "./operations/add-comment.ts";
import { updateStatus } from "./operations/update-status.ts";

export type GitHubProjectsProviderOptions = {
  /** Personal Access Token (explicit). Takes precedence over `tokenEnv`. */
  token?: string;
  /** Name of an env var to read the token from (e.g. "SAM_PORTFOLIO_GITHUB_ACCESS_TOKEN"). */
  tokenEnv?: string;
};

/**
 * GitHub Projects V2 provider (draft issues).
 *
 * Backed by GitHub's hosted MCP server (https://api.githubcopilot.com/mcp/).
 * Deterministic — no LLM in the loop. Requires a PAT with `project` + `read:project`
 * scopes, sourced (in order) from `opts.token`, `process.env[opts.tokenEnv]`, or
 * `GITHUB_ACCESS_TOKEN`.
 *
 * - `opts.projectId` is `"owner/<project_number>"` (e.g. `"anthropics/42"`).
 * - `opts.id` for get/update is `"owner/<project_number>#<item_id>"`.
 * - Creates draft items only. Real issues added to a project are visible on
 *   read but not created through this provider (use `GitHubIssuesProvider`).
 * - `opts.status` maps to the project's Status field.
 * - `opts.customFields` keys are pass-through to `projects_write.updated_field`.
 * - `opts.labels` has no direct Projects V2 equivalent — surfaced via custom
 *   fields only if the project defines a field named "Labels".
 */
export class GitHubProjectsProvider implements ITicketProvider {
  static meta: IProviderMeta = {
    id: "github-projects",
    name: "GitHub Projects",
    description: "GitHub Projects (v2) as ticket provider",
    category: "ticket",
  };

  private client?: Client;

  constructor(private readonly opts: GitHubProjectsProviderOptions = {}) {}

  async createTicket(opts: CreateTicketOptions): Promise<CreateTicketResult> {
    return createTicket(await this.getClient(), opts);
  }
  async updateTicket(opts: UpdateTicketOptions): Promise<UpdateTicketResult> {
    return updateTicket(await this.getClient(), opts);
  }
  async getTicket(opts: GetTicketOptions): Promise<GetTicketResult> {
    return getTicket(await this.getClient(), opts);
  }
  async listTickets(opts: ListTicketsOptions): Promise<ListTicketsResult> {
    return listTickets(await this.getClient(), opts);
  }
  async getTicketSchema(opts: GetTicketSchemaOptions): Promise<GetTicketSchemaResult> {
    return getTicketSchema(await this.getClient(), opts);
  }
  async addComment(opts: AddCommentOptions): Promise<AddCommentResult> {
    return addComment(await this.getClient(), opts);
  }
  async updateStatus(opts: UpdateStatusOptions): Promise<UpdateStatusResult> {
    return updateStatus(await this.getClient(), opts);
  }

  private async getClient(): Promise<Client> {
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
      this.client = await connectGitHubMcp({
        token,
        clientName: "journeyman-ticket-provider",
      });
    }
    return this.client;
  }
}
