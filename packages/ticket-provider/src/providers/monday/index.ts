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

/** Monday.com ticket provider. Not yet implemented. */
export class MondayProvider implements ITicketProvider {
  static meta: IProviderMeta = {
    id: "monday",
    name: "Monday.com",
    description: "Monday.com work-management provider",
    category: "ticket",
  };

  createTicket(_opts: CreateTicketOptions): Promise<CreateTicketResult> { throw new Error("MondayProvider.createTicket not implemented"); }
  updateTicket(_opts: UpdateTicketOptions): Promise<UpdateTicketResult> { throw new Error("MondayProvider.updateTicket not implemented"); }
  getTicket(_opts: GetTicketOptions): Promise<GetTicketResult> { throw new Error("MondayProvider.getTicket not implemented"); }
  listTickets(_opts: ListTicketsOptions): Promise<ListTicketsResult> { throw new Error("MondayProvider.listTickets not implemented"); }
  getTicketSchema(_opts: GetTicketSchemaOptions): Promise<GetTicketSchemaResult> { throw new Error("MondayProvider.getTicketSchema not implemented"); }
  addComment(_opts: AddCommentOptions): Promise<AddCommentResult> { throw new Error("MondayProvider.addComment not implemented"); }
  updateStatus(_opts: UpdateStatusOptions): Promise<UpdateStatusResult> { throw new Error("MondayProvider.updateStatus not implemented"); }
}
