
import type { GetTicketOptions, GetTicketResult, Ticket } from "@journeyman/core";
import { callTool, type Client } from "@journeyman/github-mcp";

// Replace with the discovered sub-method name.
const GET_ITEM_METHOD = "get_item";

type ProjectItem = {
  id: string;
  content?: {
    title: string;
    body: string | null;
    assignees?: { login: string }[];
  };
  fields?: Record<string, unknown>;
};

export async function getTicket(
  client: Client,
  opts: GetTicketOptions,
): Promise<GetTicketResult> {
  // GetTicketOptions only has `id` — the MCP tool needs owner+project_number.
  // The caller therefore encodes the id as "owner/project_number#item_id".
  const match = /^([^/]+)\/(\d+)#(.+)$/.exec(opts.id);
  if (!match) {
    return { error: `GitHubProjectsProvider: id must be "owner/<project_number>#<item_id>", got ${opts.id}` };
  }
  const [, owner, numStr, itemId] = match;
  try {
    const item = await callTool<ProjectItem>(client, "projects_get", {
      method: GET_ITEM_METHOD,
      owner,
      project_number: Number(numStr),
      item_id: itemId,
    });
    const ticket: Ticket = {
      id: opts.id,
      title: item.content?.title ?? "",
      description: item.content?.body ?? undefined,
      assignee: item.content?.assignees?.[0]?.login,
      customFields: item.fields,
    };
    return { ticket };
  } catch (err) {
    return { error: `not found: ${opts.id} (${(err as Error).message})` };
  }
}
