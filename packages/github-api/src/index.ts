import { Octokit } from "@octokit/rest";
import { graphql as defaultGraphql } from "@octokit/graphql";
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";

const OctokitWithPlugins = Octokit.plugin(retry, throttling);

export type GraphqlFn = typeof defaultGraphql;

export interface GitHubClient {
  rest: InstanceType<typeof OctokitWithPlugins>;
  graphql: GraphqlFn;
}

export interface CreateGitHubClientOptions {
  token: string;
  userAgent?: string;
}

export function createGitHubClient(opts: CreateGitHubClientOptions): GitHubClient {
  const userAgent = opts.userAgent ?? "journeyman/0.1.0";
  const rest = new OctokitWithPlugins({
    auth: opts.token,
    userAgent,
    throttle: {
      onRateLimit: (_retryAfter, _options, _octokit, retryCount) => retryCount < 3,
      onSecondaryRateLimit: () => true,
    },
    retry: { doNotRetry: [400, 401, 403, 404, 422] },
  });
  const graphql = defaultGraphql.defaults({
    headers: {
      authorization: `token ${opts.token}`,
      "user-agent": userAgent,
    },
  });
  return { rest, graphql };
}

export function formatGitHubError(endpoint: string, err: unknown): string {
  const e = err as { status?: number; message?: string };
  const status = e?.status ?? "?";
  const message = e?.message ?? String(err);
  return `GitHub ${endpoint} failed: ${status} ${message}`;
}

export * from "./graphql/projects.ts";
