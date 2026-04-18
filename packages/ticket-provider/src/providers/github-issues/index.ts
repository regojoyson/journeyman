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
 * GitHub repo-level issue tracker provider.
 *
 * Backed by GitHub's hosted MCP server (https://api.githubcopilot.com/mcp/).
 * Deterministic — no LLM in the loop. Requires `GITHUB_ACCESS_TOKEN` env var
 * with `repo` scope.
 *
 * - `opts.projectId` for create/list is `"owner/repo"`.
 * - `opts.id` for get/update is `"owner/repo#<number>"`.
 * - `status` maps to GitHub's binary `open`/`closed` (lossy).
 * - `priority`, `issueType`, `customFields` have no GitHub equivalent — ignored.
 */
export class GitHubIssuesProvider implements ITicketProvider {
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
    return getTicketSchema(opts);
  }

  private async getClient(): Promise<Client> {
    if (!this.client) this.client = await connectGitHubMcp();
    return this.client;
  }
}
