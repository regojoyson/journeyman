import type { SessionOptions, SessionResult } from "./session.types.ts";

export type IssueComment = {
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

export type IssueField = {
  id: string;
  name: string;
  type?: string;
  required?: boolean;
  allowedValues?: string[];
};

export type Issue = {
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
  comments?: IssueComment[];
  attachments?: Attachment[];
  customFields?: Record<string, unknown>;
};

export type CreateIssueOptions = SessionOptions & {
  title: string;
  description?: string;
  assignee?: string;
  labels?: string[];
  projectId?: string;
  status?: string;
  customFields?: Record<string, unknown>;
};

export type CreateIssueResult = SessionResult & {
  issue?: Issue;
  error?: string;
};

export type UpdateIssueOptions = SessionOptions & {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  assignee?: string;
  labels?: string[];
  priority?: string;
  customFields?: Record<string, unknown>;
};

export type UpdateIssueResult = SessionResult & {
  issue?: Issue;
  error?: string;
};

export type GetIssueOptions = SessionOptions & {
  id: string;
};

export type GetIssueResult = SessionResult & {
  issue?: Issue;
  error?: string;
};

export type ListIssuesOptions = SessionOptions & {
  projectId?: string;
  status?: string;
  assignee?: string;
};

export type ListIssuesResult = SessionResult & {
  issues: Issue[];
  error?: string;
};

export type GetIssueSchemaOptions = SessionOptions & {
  issueRef: string;
  projectId?: string;
};

export type GetIssueSchemaResult = SessionResult & {
  fields: IssueField[];
  error?: string;
};

export type AddCommentOptions = SessionOptions & {
  id: string;
  body: string;
};

export type AddCommentResult = SessionResult & {
  comment?: IssueComment;
  error?: string;
};

export type UpdateStatusOptions = SessionOptions & {
  id: string;
  status: string;
};

export type UpdateStatusResult = SessionResult & {
  issue?: Issue;
  error?: string;
};
