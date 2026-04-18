
import type { UpdateTicketOptions, UpdateTicketResult } from "@journeyman/core";
import { callTool, type Client } from "@journeyman/github-mcp";
import { getTicket } from "./get-ticket.ts";

// Replace with the discovered sub-method name.
const UPDATE_FIELD_METHOD = "update_item_field";

export async function updateTicket(
  client: Client,
  opts: UpdateTicketOptions,
): Promise<UpdateTicketResult> {
  const match = /^([^/]+)\/(\d+)#(.+)$/.exec(opts.id);
  if (!match) {
    return { error: `GitHubProjectsProvider: id must be "owner/<project_number>#<item_id>", got ${opts.id}` };
  }
  const [, owner, numStr, itemId] = match;
  const project_number = Number(numStr);

  const updates: Array<Record<string, unknown>> = [];
  if (opts.title !== undefined) updates.push({ updated_field: "title", value: opts.title });
  if (opts.description !== undefined) updates.push({ updated_field: "body", value: opts.description });
  if (opts.status !== undefined) updates.push({ updated_field: "Status", value: opts.status });
  if (opts.customFields) {
    for (const [k, v] of Object.entries(opts.customFields)) {
      updates.push({ updated_field: k, value: v });
    }
  }

  if (updates.length === 0) return { error: "updateTicket: no fields to update" };

  try {
    for (const u of updates) {
      await callTool(client, "projects_write", {
        method: UPDATE_FIELD_METHOD,
        owner,
        project_number,
        item_id: itemId,
        ...u,
      });
    }
    return getTicket(client, { id: opts.id });
  } catch (err) {
    return { error: (err as Error).message };
  }
}
