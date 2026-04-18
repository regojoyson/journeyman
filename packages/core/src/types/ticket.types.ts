export type Ticket = {
  id: string;
  title: string;
  description?: string;
  status?: string;
  assignee?: string;
  labels?: string[];
  url?: string;
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
