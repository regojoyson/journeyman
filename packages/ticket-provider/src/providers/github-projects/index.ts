import type { ITicketProvider } from "@journeyman/core";
import type {
  CreateTicketOptions, CreateTicketResult,
  UpdateTicketOptions, UpdateTicketResult,
  GetTicketOptions, GetTicketResult,
  ListTicketsOptions, ListTicketsResult,
  GetTicketSchemaOptions, GetTicketSchemaResult,
} from "@journeyman/core";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { connectGitHubMcp } from "../_shared/github-mcp-client.ts";
import { createTicket } from "./operations/create-ticket.ts";
import { updateTicket } from "./operations/update-ticket.ts";
import { getTicket } from "./operations/get-ticket.ts";
import { listTickets } from "./operations/list-tickets.ts";
import { getTicketSchema } from "./operations/get-ticket-schema.ts";

/**
 * GitHub Projects V2 provider (draft issues).
 *
 * Backed by GitHub's hosted MCP server (https://api.githubcopilot.com/mcp/).
 * Deterministic — no LLM in the loop. Requires `GITHUB_ACCESS_TOKEN` env var
 * with `project` + `read:project` scopes.
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
  private client?: Client;

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

  private async getClient(): Promise<Client> {
    if (!this.client) this.client = await connectGitHubMcp();
    return this.client;
  }
}
