import type { ListTicketsOptions, ListTicketsResult, Ticket } from "@journeyman/core";
import {
  fieldValuesToRecord,
  formatGitHubError,
  LIST_PROJECT_ITEMS,
  type GitHubClient,
  type ProjectItemNode,
} from "@journeyman/github-api";
import { parseProjectId } from "../utils/parse-project-id.ts";
import { resolveProjectNodeId } from "../utils/resolve-project-id.ts";

type Resp = {
  node?: { items?: { nodes: ProjectItemNode[] } } | null;
};

export async function listTickets(
  client: GitHubClient,
  opts: ListTicketsOptions,
): Promise<ListTicketsResult> {
  const { owner, project_number } = parseProjectId(opts.projectId);
  try {
    const projectId = await resolveProjectNodeId(client, owner, project_number);
    const r = await client.graphql<Resp>(LIST_PROJECT_ITEMS, { projectId, first: 100 });
    const items = r.node?.items?.nodes ?? [];
    const tickets: Ticket[] = items
      .filter((it) => !!it.content)
      .map((it) => {
        const fields = fieldValuesToRecord(it.fieldValues?.nodes ?? []);
        return {
          id: `${owner}/${project_number}#${it.id}`,
          title: it.content!.title ?? "",
          description: it.content!.body ?? undefined,
          assignee: it.content!.assignees?.nodes?.[0]?.login,
          status: typeof fields.Status === "string" ? fields.Status : undefined,
          customFields: fields,
        };
      })
      .filter((t) => !opts.status || t.status === opts.status)
      .filter((t) => !opts.assignee || t.assignee === opts.assignee);
    return { tickets };
  } catch (err) {
    return { tickets: [], error: formatGitHubError("graphql.projectV2.items", err) };
  }
}
