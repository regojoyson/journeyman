export type Comment = {
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
  comments?: Comment[];
  attachments?: Attachment[];
  customFields?: Record<string, unknown>;
};

export type CreateTicketOptions = {
  title: string;
  description?: string;
  assignee?: string;
  labels?: string[];
  projectId?: string;
};

export type CreateTicketResult = {
  ticket?: Ticket;
  error?: string;
};

export type UpdateTicketOptions = {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  assignee?: string;
  labels?: string[];
  priority?: string;
  customFields?: Record<string, unknown>;
};

export type UpdateTicketResult = {
  ticket?: Ticket;
  error?: string;
};

export type GetTicketOptions = {
  id: string;
};

export type GetTicketResult = {
  ticket?: Ticket;
  error?: string;
};

export type ListTicketsOptions = {
  projectId?: string;
  status?: string;
  assignee?: string;
};

export type ListTicketsResult = {
  tickets: Ticket[];
  error?: string;
};

export type GetTicketSchemaOptions = {
  ticketId: string;
  projectId?: string;
};

export type GetTicketSchemaResult = {
  fields: TicketField[];
  error?: string;
};
