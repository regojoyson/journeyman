import type { GetTicketOptions, GetTicketResult, Ticket } from "@journeyman/core";
import {
  fieldValuesToRecord,
  formatGitHubError,
  GET_PROJECT_ITEM,
  type GitHubClient,
  type ProjectItemNode,
} from "@journeyman/github-api";

type Resp = { node?: ProjectItemNode | null };

export async function getTicket(
  client: GitHubClient,
  opts: GetTicketOptions,
): Promise<GetTicketResult> {
  const match = /^([^/]+)\/(\d+)#(.+)$/.exec(opts.id);
  if (!match) {
    return {
      error: `GitHubProjectsProvider: id must be "owner/<project_number>#<item_id>", got ${opts.id}`,
    };
  }
  const [, , , itemId] = match;
  try {
    const r = await client.graphql<Resp>(GET_PROJECT_ITEM, { itemId });
    const item = r.node;
    if (!item) return { error: `not found: ${opts.id}` };
    const fields = fieldValuesToRecord(item.fieldValues?.nodes ?? []);
    const ticket: Ticket = {
      id: opts.id,
      title: item.content?.title ?? "",
      description: item.content?.body ?? undefined,
      assignee: item.content?.assignees?.nodes?.[0]?.login,
      status: typeof fields.Status === "string" ? fields.Status : undefined,
      customFields: fields,
    };
    return { ticket };
  } catch (err) {
    return { error: `not found: ${opts.id} (${formatGitHubError("graphql.projectItem", err)})` };
  }
}
