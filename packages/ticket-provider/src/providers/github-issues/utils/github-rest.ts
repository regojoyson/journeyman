const BASE_URL = "https://api.github.com";

export class GitHubRestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly rateLimitRemaining?: string,
  ) {
    super(message);
    this.name = "GitHubRestError";
  }
}

function getToken(): string {
  const token = process.env.GITHUB_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "GitHubIssuesProvider: PAT required. Set GITHUB_ACCESS_TOKEN.",
    );
  }
  return token;
}

export type RestResponse<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

export async function ghRest<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<RestResponse<T>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "journeyman",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 404) {
    return { ok: false, status: 404, message: "not found" };
  }

  if (!res.ok) {
    const rateLimitRemaining = res.headers.get("x-ratelimit-remaining") ?? undefined;
    let msg = `${res.status} ${res.statusText}`;
    try {
      const errBody = (await res.json()) as { message?: string };
      if (errBody.message) msg = `${msg}: ${errBody.message}`;
    } catch {
      // non-JSON body — keep the status line
    }
    throw new GitHubRestError(res.status, msg, rateLimitRemaining);
  }

  return { ok: true, data: (await res.json()) as T };
}

export function parseOwnerRepo(projectId: string | undefined): { owner: string; repo: string } {
  if (!projectId || !projectId.includes("/")) {
    throw new Error(
      `GitHubIssuesProvider: projectId must be "owner/repo", got ${JSON.stringify(projectId)}`,
    );
  }
  const [owner, repo] = projectId.split("/");
  if (!owner || !repo) {
    throw new Error(
      `GitHubIssuesProvider: projectId must be "owner/repo", got ${JSON.stringify(projectId)}`,
    );
  }
  return { owner, repo };
}

export function parseIssueId(id: string): { owner: string; repo: string; number: number } {
  const match = /^([^/]+)\/([^#]+)#(\d+)$/.exec(id);
  if (!match) {
    throw new Error(
      `GitHubIssuesProvider: id must be "owner/repo#<number>", got ${JSON.stringify(id)}`,
    );
  }
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}
