# @journeyman/git-provider

Git hosting API providers for Journeyman. Implements `IGitProvider` from `@journeyman/core` with REST API clients for GitHub and GitLab.

Handles remote API operations — repository metadata, pull requests, merge requests. Local git operations (clone, push) are handled by `@journeyman/coding-cli`.

## Providers

| Provider | ID | Status | Notes |
|---|---|---|---|
| `GitHubProvider` | `github` | Implemented | REST + GraphQL via `@journeyman/github-api` |
| `GitLabProvider` | `gitlab` | Stub | Throws `not implemented` |

## GitHubProvider

Uses `@journeyman/github-api` (Octokit-based client) for all GitHub REST and GraphQL calls.

**Operations:** `getRepo`, `createPR`, `listPRs`, `cloneRepos`

**Auth:** resolves a GitHub PAT in this order:
1. `providerConfig.git.token` (explicit value)
2. `process.env[providerConfig.git.tokenEnv]` (env var name)
3. `process.env.GITHUB_ACCESS_TOKEN` (global fallback)

Throws at construction time if none resolve.

**Required PAT scopes:** `repo`, `read:org`

**Config example:**

```yaml
# pipeline.yaml — inside a product block
providerConfig:
  git:
    tokenEnv: GITHUB_ACCESS_TOKEN   # or token: "ghp_..." directly
```

## Exports

```typescript
import { GitHubProvider, GitLabProvider } from "@journeyman/git-provider";
import type { IGitProvider } from "@journeyman/core";
```

## Documentation

- [Providers reference](../../docs/providers.md#github--githubprovider) — full config + env var details
- [Setup guide](../../docs/setup.md#8-webhook-setup-per-provider) — GitHub webhook configuration
