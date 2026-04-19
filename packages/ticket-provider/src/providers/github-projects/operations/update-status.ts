import type { UpdateStatusOptions, UpdateStatusResult } from "@journeyman/core";
import {
  formatGitHubError,
  UPDATE_PROJECT_FIELD_SINGLE_SELECT,
  UPDATE_PROJECT_FIELD_TEXT,
  type GitHubClient,
} from "@journeyman/github-api";
import { getTicket } from "./get-ticket.ts";
import { findField, findOptionId, getProjectFields } from "../utils/resolve-fields.ts";
import { resolveProjectNodeId } from "../utils/resolve-project-id.ts";

export async function updateStatus(
  client: GitHubClient,
  opts: UpdateStatusOptions,
): Promise<UpdateStatusResult> {
  const match = /^([^/]+)\/(\d+)#(.+)$/.exec(opts.id);
  if (!match) {
    return {
      error: `GitHubProjectsProvider: id must be "owner/<project_number>#<item_id>", got ${opts.id}`,
    };
  }
  const [, owner, numStr, itemId] = match;
  const project_number = Number(numStr);

  try {
    const projectId = await resolveProjectNodeId(client, owner, project_number);
    const fields = await getProjectFields(client, projectId);
    const status = findField(fields, "Status");
    if (!status) return { error: "updateStatus: Status field not found on project" };

    if (status.dataType === "SINGLE_SELECT") {
      const optionId = findOptionId(status, opts.status);
      if (!optionId) return { error: `updateStatus: Status option "${opts.status}" not found` };
      await client.graphql(UPDATE_PROJECT_FIELD_SINGLE_SELECT, {
        projectId,
        itemId,
        fieldId: status.id,
        optionId,
      });
    } else {
      await client.graphql(UPDATE_PROJECT_FIELD_TEXT, {
        projectId,
        itemId,
        fieldId: status.id,
        text: opts.status,
      });
    }

    return getTicket(client, { id: opts.id });
  } catch (err) {
    return { error: formatGitHubError("graphql.updateProjectV2ItemFieldValue", err) };
  }
}
