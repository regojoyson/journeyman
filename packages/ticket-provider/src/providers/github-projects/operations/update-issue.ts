import type { UpdateIssueOptions, UpdateIssueResult } from "@journeyman/core";
import {
  formatGitHubError,
  GET_PROJECT_ITEM,
  UPDATE_DRAFT_ISSUE,
  UPDATE_PROJECT_FIELD_SINGLE_SELECT,
  UPDATE_PROJECT_FIELD_TEXT,
  type GitHubClient,
  type ProjectItemNode,
} from "@journeyman/github-api";
import { getIssue } from "./get-issue.ts";
import { findField, findOptionId, getProjectFields } from "../utils/resolve-fields.ts";
import { resolveProjectNodeId } from "../utils/resolve-project-id.ts";

export async function updateIssue(
  client: GitHubClient,
  opts: UpdateIssueOptions,
): Promise<UpdateIssueResult> {
  const match = /^([^/]+)\/(\d+)#(.+)$/.exec(opts.id);
  if (!match) {
    return { error: `GitHubProjectsProvider: id must be "owner/<project_number>#<item_id>", got ${opts.id}` };
  }
  const [, owner, numStr, itemId] = match;
  const project_number = Number(numStr);

  const hasFieldUpdate =
    opts.title !== undefined ||
    opts.description !== undefined ||
    opts.status !== undefined ||
    (opts.customFields && Object.keys(opts.customFields).length > 0);
  if (!hasFieldUpdate) return { error: "updateIssue: no fields to update" };

  try {
    const projectId = await resolveProjectNodeId(client, owner, project_number);

    if (opts.title !== undefined || opts.description !== undefined) {
      const itemResp = await client.graphql<{ node?: ProjectItemNode | null }>(
        GET_PROJECT_ITEM,
        { itemId },
      );
      const draftId = itemResp.node?.content?.id;
      if (!draftId) {
        return {
          error:
            "updateIssue: item is not a draft issue; title/description updates are only supported on draft items",
        };
      }
      await client.graphql(UPDATE_DRAFT_ISSUE, {
        draftId,
        title: opts.title ?? null,
        body: opts.description ?? null,
      });
    }

    const fieldUpdates: Array<[string, unknown]> = [];
    if (opts.status !== undefined) fieldUpdates.push(["Status", opts.status]);
    if (opts.customFields) {
      for (const [k, v] of Object.entries(opts.customFields)) fieldUpdates.push([k, v]);
    }

    if (fieldUpdates.length > 0) {
      const fields = await getProjectFields(client, projectId);
      for (const [name, value] of fieldUpdates) {
        const field = findField(fields, name);
        if (!field) continue;
        if (field.dataType === "SINGLE_SELECT") {
          const optionId = findOptionId(field, String(value));
          if (!optionId) continue;
          await client.graphql(UPDATE_PROJECT_FIELD_SINGLE_SELECT, {
            projectId,
            itemId,
            fieldId: field.id,
            optionId,
          });
        } else {
          await client.graphql(UPDATE_PROJECT_FIELD_TEXT, {
            projectId,
            itemId,
            fieldId: field.id,
            text: String(value),
          });
        }
      }
    }

    return getIssue(client, { id: opts.id });
  } catch (err) {
    return { error: formatGitHubError("graphql.updateProjectV2Item", err) };
  }
}
