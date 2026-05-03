import type {
  GetIssueSchemaOptions,
  GetIssueSchemaResult,
  IssueField,
} from "@journeyman/core";
import {
  formatGitHubError,
  GET_PROJECT_FIELDS,
  type GitHubClient,
  type ProjectFieldNode,
} from "@journeyman/github-api";
import { parseProjectId } from "../utils/parse-project-id.ts";
import { resolveProjectNodeId } from "../utils/resolve-project-id.ts";

type Resp = {
  node?: { fields?: { nodes: ProjectFieldNode[] } } | null;
};

export async function getIssueSchema(
  client: GitHubClient,
  opts: GetIssueSchemaOptions,
): Promise<GetIssueSchemaResult> {
  if (!opts.projectId) {
    return { fields: [], error: "projectId (owner/<project_number>) required" };
  }
  const { owner, project_number } = parseProjectId(opts.projectId);
  try {
    const projectId = await resolveProjectNodeId(client, owner, project_number);
    const r = await client.graphql<Resp>(GET_PROJECT_FIELDS, { projectId });
    const nodes = r.node?.fields?.nodes ?? [];
    const mapped: IssueField[] = nodes.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.dataType?.toLowerCase(),
      allowedValues: f.options?.map((o) => o.name),
    }));
    return { fields: mapped };
  } catch (err) {
    return { fields: [], error: formatGitHubError("graphql.projectV2.fields", err) };
  }
}
