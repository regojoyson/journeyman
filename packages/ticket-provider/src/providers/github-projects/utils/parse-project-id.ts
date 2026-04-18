export function parseProjectId(projectId: string | undefined): {
  owner: string;
  project_number: number;
} {
  if (!projectId || !projectId.includes("/")) {
    throw new Error(
      `GitHubProjectsProvider: projectId must be "owner/<number>", got ${JSON.stringify(projectId)}`,
    );
  }
  const [owner, num] = projectId.split("/");
  const n = Number(num);
  if (!owner || !Number.isInteger(n) || n <= 0) {
    throw new Error(
      `GitHubProjectsProvider: projectId must be "owner/<number>", got ${JSON.stringify(projectId)}`,
    );
  }
  return { owner, project_number: n };
}
