import type { ITicketProvider } from "@journeyman/core";
import type { CreateTicketOptions, CreateTicketResult, UpdateTicketOptions, UpdateTicketResult, GetTicketOptions, GetTicketResult, ListTicketsOptions, ListTicketsResult } from "@journeyman/core";

/** Monday.com ticket provider. Not yet implemented. */
export class MondayProvider implements ITicketProvider {
  createTicket(_opts: CreateTicketOptions): Promise<CreateTicketResult> { throw new Error("MondayProvider.createTicket not implemented"); }
  updateTicket(_opts: UpdateTicketOptions): Promise<UpdateTicketResult> { throw new Error("MondayProvider.updateTicket not implemented"); }
  getTicket(_opts: GetTicketOptions): Promise<GetTicketResult> { throw new Error("MondayProvider.getTicket not implemented"); }
  listTickets(_opts: ListTicketsOptions): Promise<ListTicketsResult> { throw new Error("MondayProvider.listTickets not implemented"); }
}
