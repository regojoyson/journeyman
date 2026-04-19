import {
  GET_PROJECT_FIELDS,
  type GitHubClient,
  type ProjectFieldNode,
} from "@journeyman/github-api";

const cache = new Map<string, ProjectFieldNode[]>();

export async function getProjectFields(
  client: GitHubClient,
  projectId: string,
): Promise<ProjectFieldNode[]> {
  const hit = cache.get(projectId);
  if (hit) return hit;
  const r = await client.graphql<{ node?: { fields?: { nodes: ProjectFieldNode[] } } | null }>(
    GET_PROJECT_FIELDS,
    { projectId },
  );
  const nodes = r.node?.fields?.nodes ?? [];
  cache.set(projectId, nodes);
  return nodes;
}

export function findField(
  fields: ProjectFieldNode[],
  name: string,
): ProjectFieldNode | undefined {
  const lower = name.toLowerCase();
  return fields.find((f) => f.name.toLowerCase() === lower);
}

export function findOptionId(field: ProjectFieldNode, value: string): string | undefined {
  return field.options?.find((o) => o.name === value || o.id === value)?.id;
}
