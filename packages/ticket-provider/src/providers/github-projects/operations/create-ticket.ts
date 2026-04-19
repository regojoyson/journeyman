import type {
  CreateTicketOptions,
  CreateTicketResult,
  Ticket,
} from "@journeyman/core";
import {
  ADD_DRAFT_ISSUE,
  formatGitHubError,
  type GitHubClient,
} from "@journeyman/github-api";
import { parseProjectId } from "../utils/parse-project-id.ts";
import { resolveProjectNodeId } from "../utils/resolve-project-id.ts";

type AddResp = {
  addProjectV2DraftIssue: { projectItem: { id: string } };
};

export async function createTicket(
  client: GitHubClient,
  opts: CreateTicketOptions,
): Promise<CreateTicketResult> {
  const { owner, project_number } = parseProjectId(opts.projectId);
  try {
    const projectId = await resolveProjectNodeId(client, owner, project_number);
    const r = await client.graphql<AddResp>(ADD_DRAFT_ISSUE, {
      projectId,
      title: opts.title,
      body: opts.description ?? null,
    });
    const itemId = r.addProjectV2DraftIssue.projectItem.id;
    const ticket: Ticket = {
      id: `${owner}/${project_number}#${itemId}`,
      title: opts.title,
      description: opts.description,
    };
    return { ticket };
  } catch (err) {
    return { error: formatGitHubError("graphql.addProjectV2DraftIssue", err) };
  }
}
