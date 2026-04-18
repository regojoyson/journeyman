import type { UpdateStatusOptions, UpdateStatusResult } from "@journeyman/core";
import { callTool, type Client } from "@journeyman/github-mcp";
import { getTicket } from "./get-ticket.ts";

const UPDATE_FIELD_METHOD = "update_item_field";

export async function updateStatus(
  client: Client,
  opts: UpdateStatusOptions,
): Promise<UpdateStatusResult> {
  const match = /^([^/]+)\/(\d+)#(.+)$/.exec(opts.id);
  if (!match) {
    return {
      error: `GitHubProjectsProvider: id must be "owner/<project_number>#<item_id>", got ${opts.id}`,
    };
  }
  const [, owner, numStr, itemId] = match;
  try {
    await callTool(client, "projects_write", {
      method: UPDATE_FIELD_METHOD,
      owner,
      project_number: Number(numStr),
      item_id: itemId,
      updated_field: "Status",
      value: opts.status,
    });
    return getTicket(client, { id: opts.id });
  } catch (err) {
    return { error: (err as Error).message };
  }
}
