import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ListTicketsOptions, ListTicketsResult, Ticket } from "@journeyman/core";
import { callTool } from "../../_shared/github-mcp-client.ts";
import { parseProjectId } from "../utils/parse-project-id.ts";

// Replace with the discovered sub-method name.
const LIST_ITEMS_METHOD = "list_items";

type ProjectItem = {
  id: string;
  content?: {
    title: string;
    body: string | null;
    assignees?: { login: string }[];
  };
  fields?: Record<string, unknown>;
};

export async function listTickets(
  client: Client,
  opts: ListTicketsOptions,
): Promise<ListTicketsResult> {
  const { owner, project_number } = parseProjectId(opts.projectId);
  try {
    const items = await callTool<ProjectItem[]>(client, "projects_list", {
      method: LIST_ITEMS_METHOD,
      owner,
      project_number,
      per_page: 100,
    });
    const tickets: Ticket[] = items
      .filter((it) => !!it.content) // skip non-draft items for v1
      .map((it) => ({
        id: `${owner}/${project_number}#${it.id}`,
        title: it.content!.title,
        description: it.content!.body ?? undefined,
        assignee: it.content!.assignees?.[0]?.login,
        status: typeof it.fields?.Status === "string" ? it.fields.Status : undefined,
        customFields: it.fields,
      }))
      .filter((t) => !opts.status || t.status === opts.status)
      .filter((t) => !opts.assignee || t.assignee === opts.assignee);
    return { tickets };
  } catch (err) {
    return { tickets: [], error: (err as Error).message };
  }
}
