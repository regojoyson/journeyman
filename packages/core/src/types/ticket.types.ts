import type { SessionOptions, SessionResult } from "./session.types.ts";

export type TicketComment = {
  id: string;
  author?: string;
  body: string;
  createdAt?: string;
};

export type Attachment = {
  id: string;
  filename: string;
  url: string;
  mimeType?: string;
  size?: number;
};

export type TicketField = {
  id: string;
  name: string;
  type?: string;
  required?: boolean;
  allowedValues?: string[];
};

export type Ticket = {
  id: string;
  title: string;
  description?: string;
  status?: string;
  assignee?: string;
  labels?: string[];
  url?: string;
  priority?: string;
  issueType?: string;
  reporter?: string;
  createdAt?: string;
  updatedAt?: string;
  comments?: TicketComment[];
  attachments?: Attachment[];
  customFields?: Record<string, unknown>;
};

export type CreateTicketOptions = SessionOptions & {
  title: string;
  description?: string;
  assignee?: string;
  labels?: string[];
  projectId?: string;
  status?: string;
  customFields?: Record<string, unknown>;
};

export type CreateTicketResult = SessionResult & {
  ticket?: Ticket;
  error?: string;
};

export type UpdateTicketOptions = SessionOptions & {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  assignee?: string;
  labels?: string[];
  priority?: string;
  customFields?: Record<string, unknown>;
};

export type UpdateTicketResult = SessionResult & {
  ticket?: Ticket;
  error?: string;
};

export type GetTicketOptions = SessionOptions & {
  id: string;
};

export type GetTicketResult = SessionResult & {
  ticket?: Ticket;
  error?: string;
};

export type ListTicketsOptions = SessionOptions & {
  projectId?: string;
  status?: string;
  assignee?: string;
};

export type ListTicketsResult = SessionResult & {
  tickets: Ticket[];
  error?: string;
};

export type GetTicketSchemaOptions = SessionOptions & {
  ticketId: string;
  projectId?: string;
};

export type GetTicketSchemaResult = SessionResult & {
  fields: TicketField[];
  error?: string;
};

export type AddCommentOptions = SessionOptions & {
  id: string;
  body: string;
};

export type AddCommentResult = SessionResult & {
  comment?: TicketComment;
  error?: string;
};

export type UpdateStatusOptions = SessionOptions & {
  id: string;
  status: string;
};

export type UpdateStatusResult = SessionResult & {
  ticket?: Ticket;
  error?: string;
};
