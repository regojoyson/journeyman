import type { GitHubClient } from "@journeyman/github-api";
import {
  GET_PROJECT_ID_BY_NUMBER_ORG,
  GET_PROJECT_ID_BY_NUMBER_USER,
} from "@journeyman/github-api";

const cache = new Map<string, string>();

export async function resolveProjectNodeId(
  client: GitHubClient,
  owner: string,
  project_number: number,
): Promise<string> {
  const key = `${owner}/${project_number}`;
  const hit = cache.get(key);
  if (hit) return hit;

  // Try org first, fall back to user. Each is a separate query so a missing
  // owner of the wrong kind doesn't poison the whole response with errors.
  try {
    const r = await client.graphql<{ organization?: { projectV2?: { id: string } | null } | null }>(
      GET_PROJECT_ID_BY_NUMBER_ORG,
      { owner, number: project_number },
    );
    const id = r.organization?.projectV2?.id;
    if (id) {
      cache.set(key, id);
      return id;
    }
  } catch {
    // fall through to user
  }

  const r = await client.graphql<{ user?: { projectV2?: { id: string } | null } | null }>(
    GET_PROJECT_ID_BY_NUMBER_USER,
    { owner, number: project_number },
  );
  const id = r.user?.projectV2?.id;
  if (!id) throw new Error(`ProjectV2 not found for ${key}`);
  cache.set(key, id);
  return id;
}
