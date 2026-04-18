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

/** Linear ticket provider. Not yet implemented. */
export class LinearProvider implements ITicketProvider {
  static meta: IProviderMeta = {
    id: "linear",
    name: "Linear",
    description: "Linear issue tracker",
    category: "ticket",
  };

  createTicket(_opts: CreateTicketOptions): Promise<CreateTicketResult> { throw new Error("LinearProvider.createTicket not implemented"); }
  updateTicket(_opts: UpdateTicketOptions): Promise<UpdateTicketResult> { throw new Error("LinearProvider.updateTicket not implemented"); }
  getTicket(_opts: GetTicketOptions): Promise<GetTicketResult> { throw new Error("LinearProvider.getTicket not implemented"); }
  listTickets(_opts: ListTicketsOptions): Promise<ListTicketsResult> { throw new Error("LinearProvider.listTickets not implemented"); }
  getTicketSchema(_opts: GetTicketSchemaOptions): Promise<GetTicketSchemaResult> { throw new Error("LinearProvider.getTicketSchema not implemented"); }
  addComment(_opts: AddCommentOptions): Promise<AddCommentResult> { throw new Error("LinearProvider.addComment not implemented"); }
  updateStatus(_opts: UpdateStatusOptions): Promise<UpdateStatusResult> { throw new Error("LinearProvider.updateStatus not implemented"); }
}
