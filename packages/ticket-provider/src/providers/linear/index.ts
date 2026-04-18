import type { ITicketProvider } from "@journeyman/core";
import type { CreateTicketOptions, CreateTicketResult, UpdateTicketOptions, UpdateTicketResult, GetTicketOptions, GetTicketResult, ListTicketsOptions, ListTicketsResult } from "@journeyman/core";

/** Linear ticket provider. Not yet implemented. */
export class LinearProvider implements ITicketProvider {
  createTicket(_opts: CreateTicketOptions): Promise<CreateTicketResult> { throw new Error("LinearProvider.createTicket not implemented"); }
  updateTicket(_opts: UpdateTicketOptions): Promise<UpdateTicketResult> { throw new Error("LinearProvider.updateTicket not implemented"); }
  getTicket(_opts: GetTicketOptions): Promise<GetTicketResult> { throw new Error("LinearProvider.getTicket not implemented"); }
  listTickets(_opts: ListTicketsOptions): Promise<ListTicketsResult> { throw new Error("LinearProvider.listTickets not implemented"); }
}
