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
import { createTicket } from "./operations/create-ticket.ts";
import { updateTicket } from "./operations/update-ticket.ts";
import { getTicket } from "./operations/get-ticket.ts";
import { listTickets } from "./operations/list-tickets.ts";
import { getTicketSchema } from "./operations/get-ticket-schema.ts";

export class JiraProvider implements ITicketProvider {
  static meta: IProviderMeta = {
    id: "jira",
    name: "Jira Cloud",
    description: "Atlassian Jira Cloud ticket provider",
    category: "ticket",
  };

  createTicket(opts: CreateTicketOptions): Promise<CreateTicketResult> {
    return createTicket(opts);
  }
  updateTicket(opts: UpdateTicketOptions): Promise<UpdateTicketResult> {
    return updateTicket(opts);
  }
  getTicket(opts: GetTicketOptions): Promise<GetTicketResult> {
    return getTicket(opts);
  }
  listTickets(opts: ListTicketsOptions): Promise<ListTicketsResult> {
    return listTickets(opts);
  }
  getTicketSchema(opts: GetTicketSchemaOptions): Promise<GetTicketSchemaResult> {
    return getTicketSchema(opts);
  }
  addComment(_opts: AddCommentOptions): Promise<AddCommentResult> { throw new Error("JiraProvider.addComment not implemented"); }
  updateStatus(_opts: UpdateStatusOptions): Promise<UpdateStatusResult> { throw new Error("JiraProvider.updateStatus not implemented"); }
}
