import type { GitHubClient } from "@journeyman/github-api";
import { GET_PROJECT_ID_BY_NUMBER } from "@journeyman/github-api";

const cache = new Map<string, string>();

type Resp = {
  user?: { projectV2?: { id: string } | null } | null;
  organization?: { projectV2?: { id: string } | null } | null;
};

export async function resolveProjectNodeId(
  client: GitHubClient,
  owner: string,
  project_number: number,
): Promise<string> {
  const key = `${owner}/${project_number}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = await client.graphql<Resp>(GET_PROJECT_ID_BY_NUMBER, {
    owner,
    number: project_number,
  });
  const id = r.user?.projectV2?.id ?? r.organization?.projectV2?.id;
  if (!id) throw new Error(`ProjectV2 not found for ${key}`);
  cache.set(key, id);
  return id;
}
