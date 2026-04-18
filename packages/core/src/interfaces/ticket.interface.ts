import type {
  CreateTicketOptions,
  CreateTicketResult,
  UpdateTicketOptions,
  UpdateTicketResult,
  GetTicketOptions,
  GetTicketResult,
  ListTicketsOptions,
  ListTicketsResult,
  GetTicketSchemaOptions,
  GetTicketSchemaResult,
  AddCommentOptions,
  AddCommentResult,
  UpdateStatusOptions,
  UpdateStatusResult,
} from "../types/ticket.types.ts";

/**
 * Interface for issue tracker operations.
 * Implement this to add support for Jira, Linear, Monday, GitHub Issues, etc.
 */
export interface ITicketProvider {
  createTicket(opts: CreateTicketOptions): Promise<CreateTicketResult>;
  updateTicket(opts: UpdateTicketOptions): Promise<UpdateTicketResult>;
  getTicket(opts: GetTicketOptions): Promise<GetTicketResult>;
  listTickets(opts: ListTicketsOptions): Promise<ListTicketsResult>;
  getTicketSchema(opts: GetTicketSchemaOptions): Promise<GetTicketSchemaResult>;
  addComment(opts: AddCommentOptions): Promise<AddCommentResult>;
  updateStatus(opts: UpdateStatusOptions): Promise<UpdateStatusResult>;
}
