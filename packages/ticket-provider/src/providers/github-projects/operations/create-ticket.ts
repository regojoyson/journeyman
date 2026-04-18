import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  CreateTicketOptions,
  CreateTicketResult,
  Ticket,
} from "@journeyman/core";
import { callTool } from "../../_shared/github-mcp-client.ts";
import { parseProjectId } from "../utils/parse-project-id.ts";

// TOOL-SPECIFIC: sub-method names below are placeholders — the implementer
// replaces them with the exact strings captured in Task 6's discovery notes.
// If discovery reveals a materially different shape (e.g. no draft support),
// STOP and escalate.
const CREATE_DRAFT_METHOD = "add_draft_item";

type ProjectItemPayload = {
  id: string;
  content?: { title: string; body: string | null };
  title?: string;
  body?: string | null;
};

export async function createTicket(
  client: Client,
  opts: CreateTicketOptions,
): Promise<CreateTicketResult> {
  const { owner, project_number } = parseProjectId(opts.projectId);
  const args: Record<string, unknown> = {
    method: CREATE_DRAFT_METHOD,
    owner,
    project_number,
    body: opts.description ?? "",
  };
  // title passes via body's leading line OR a dedicated `title` param depending
  // on the tool schema — the implementer sets the correct field per discovery.
  args.title = opts.title;

  if (opts.status) args.status = opts.status;
  if (opts.customFields) {
    Object.assign(args, opts.customFields);
  }

  try {
    const item = await callTool<ProjectItemPayload>(client, "projects_write", args);
    const ticket: Ticket = {
      id: String(item.id),
      title: item.content?.title ?? item.title ?? opts.title,
      description: item.content?.body ?? item.body ?? opts.description,
    };
    return { ticket };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
