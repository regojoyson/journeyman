# @journeyman/github-api

Shared GitHub REST and GraphQL client for Journeyman. Wraps `@octokit/rest` and `@octokit/graphql` with retry and throttling plugins. Used internally by `@journeyman/git-provider` and `@journeyman/ticket-provider`.

## Usage

```typescript
import { createGitHubClient } from "@journeyman/github-api";
import type { GitHubClient } from "@journeyman/github-api";

const client: GitHubClient = createGitHubClient({
  token: process.env.GITHUB_ACCESS_TOKEN!,
  userAgent: "my-app/1.0",  // optional
});

// REST (Octokit)
const { data } = await client.rest.repos.get({ owner: "acme", repo: "api" });

// GraphQL
const result = await client.graphql<{ repository: { id: string } }>(
  `query { repository(owner: "acme", name: "api") { id } }`
);
```

## API

### `createGitHubClient(opts)`

Creates a new GitHub client with retry and throttling enabled.

| Option | Type | Required | Description |
|---|---|---|---|
| `token` | string | Yes | GitHub Personal Access Token |
| `userAgent` | string | No | Custom User-Agent header |

**Returns:** `GitHubClient`

### `GitHubClient`

| Property | Type | Description |
|---|---|---|
| `rest` | `Octokit` (with retry + throttling plugins) | REST API client |
| `graphql` | `GraphqlFn` | GraphQL client (pre-authenticated) |

## Plugins

- **`@octokit/plugin-retry`** — automatic retries on 5xx and rate-limit responses
- **`@octokit/plugin-throttling`** — respects GitHub's rate limits via `Retry-After` headers
