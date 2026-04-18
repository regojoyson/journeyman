import type { ITicketProvider } from "@journeyman/core";
import type { CreateTicketOptions, CreateTicketResult, UpdateTicketOptions, UpdateTicketResult, GetTicketOptions, GetTicketResult, ListTicketsOptions, ListTicketsResult } from "@journeyman/core";

/** Jira ticket provider. Not yet implemented. */
export class JiraProvider implements ITicketProvider {
  createTicket(_opts: CreateTicketOptions): Promise<CreateTicketResult> { throw new Error("JiraProvider.createTicket not implemented"); }
  updateTicket(_opts: UpdateTicketOptions): Promise<UpdateTicketResult> { throw new Error("JiraProvider.updateTicket not implemented"); }
  getTicket(_opts: GetTicketOptions): Promise<GetTicketResult> { throw new Error("JiraProvider.getTicket not implemented"); }
  listTickets(_opts: ListTicketsOptions): Promise<ListTicketsResult> { throw new Error("JiraProvider.listTickets not implemented"); }
}
