# GitHub MCP Server Integration for `@journeyman/git-provider`

**Date:** 2026-04-18
**Package:** `@journeyman/git-provider`
**Status:** Design approved, awaiting implementation plan

## Goal

Implement `GitHubProvider.getRepo` and `GitHubProvider.createPR` (currently stubs) by integrating the official remote-hosted GitHub MCP server (`https://api.githubcopilot.com/mcp/`), authenticated with a Personal Access Token.

## Non-Goals

- Local/Docker GitHub MCP server transport.
- Adding new methods to `IGitProvider` beyond what the interface already declares.
- Implementing `GitLabProvider`.
- Automated test infrastructure for providers (the repo has none today; out of scope).
- Letting an LLM agent decide which MCP tool to call. This integration calls MCP tools directly as RPC.

## Architectural Decisions

1. **MCP-as-RPC, not MCP-as-agent-tools.** `git-provider` is the deterministic remote-API layer per CLAUDE.md ("`git-provider` calls remote REST APIs"). The MCP server replaces direct REST calls; we invoke its tools via the MCP TS SDK with no LLM in the loop.
2. **Remote hosted transport only.** No local binary or Docker dependency. Uses `StreamableHTTPClientTransport` against `https://api.githubcopilot.com/mcp/`.
3. **PAT via constructor option with env fallback.** Explicit `opts.token` wins; otherwise `process.env.GITHUB_PERSONAL_ACCESS_TOKEN`. Validated at construction (fail-fast).
4. **Lazy, reused MCP client.** One client/transport per `GitHubProvider` instance, connected on first operation, reused across subsequent calls.

## Dependencies

Add to `packages/git-provider/package.json`:

```json
"dependencies": {
  "@journeyman/core": "*",
  "@modelcontextprotocol/sdk": "^1.0.0"
}
```

(Pin to whatever the latest `1.x` is at implementation time.)

## File Layout

```
packages/git-provider/src/providers/github/
├── index.ts              ← GitHubProvider class
├── mcp-client.ts         ← connectGitHubMcp() + callTool() helpers
└── operations/
    ├── get-repo.ts       ← getRepo() — wraps MCP `get_repository`
    └── create-pr.ts      ← createPR() — wraps MCP `create_pull_request`
```

Mirrors `packages/coding-cli/src/providers/claude/` (operations + shared utility).

## Component: `GitHubProvider` (`github/index.ts`)

```ts
import type { IGitProvider, GetRepoOptions, GetRepoResult, CreatePROptions, CreatePRResult } from "@journeyman/core";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { connectGitHubMcp } from "./mcp-client.ts";
import { getRepo } from "./operations/get-repo.ts";
import { createPR } from "./operations/create-pr.ts";

export type GitHubProviderOptions = {
  /** Personal Access Token. Falls back to GITHUB_PERSONAL_ACCESS_TOKEN env var. */
  token?: string;
};

export class GitHubProvider implements IGitProvider {
  private readonly token: string;
  private client?: Client;

  constructor(opts: GitHubProviderOptions = {}) {
    const token = opts.token ?? process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    if (!token) {
      throw new Error(
        "GitHubProvider: PAT required. Pass opts.token or set GITHUB_PERSONAL_ACCESS_TOKEN."
      );
    }
    this.token = token;
  }

  async getRepo(opts: GetRepoOptions): Promise<GetRepoResult> {
    return getRepo(await this.getClient(), opts);
  }

  async createPR(opts: CreatePROptions): Promise<CreatePRResult> {
    return createPR(await this.getClient(), opts);
  }

  private async getClient(): Promise<Client> {
    if (!this.client) this.client = await connectGitHubMcp(this.token);
    return this.client;
  }
}
```

## Component: MCP Client Wrapper (`github/mcp-client.ts`)

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/";

export async function connectGitHubMcp(token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(GITHUB_MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client(
    { name: "journeyman-git-provider", version: "0.0.1" },
    { capabilities: {} }
  );
  await client.connect(transport);
  return client;
}

export async function callTool<T>(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<T> {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) {
    throw new Error(`MCP tool '${name}' failed: ${JSON.stringify(res.content)}`);
  }
  const text = (res.content as Array<{ type: string; text?: string }>)
    .find((c) => c.type === "text")?.text;
  if (!text) throw new Error(`MCP tool '${name}' returned no text content`);
  return JSON.parse(text) as T;
}
```

## Component: `getRepo` Operation (`github/operations/get-repo.ts`)

Maps to MCP tool `get_repository` (exact name to be verified against the live server during implementation; correct via `client.listTools()` if it differs).

```ts
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { GetRepoOptions, GetRepoResult } from "@journeyman/core";
import { callTool } from "../mcp-client.ts";

type GitHubRepoPayload = {
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
};

export async function getRepo(client: Client, opts: GetRepoOptions): Promise<GetRepoResult> {
  try {
    const r = await callTool<GitHubRepoPayload>(client, "get_repository", {
      owner: opts.owner,
      repo: opts.repo,
    });
    return {
      name: r.name,
      fullName: r.full_name,
      url: r.html_url,
      defaultBranch: r.default_branch,
    };
  } catch (e) {
    return { name: "", fullName: "", url: "", defaultBranch: "", error: (e as Error).message };
  }
}
```

## Component: `createPR` Operation (`github/operations/create-pr.ts`)

Maps to MCP tool `create_pull_request`.

```ts
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CreatePROptions, CreatePRResult } from "@journeyman/core";
import { callTool } from "../mcp-client.ts";

type GitHubPRPayload = {
  id: number;
  number: number;
  html_url: string;
};

export async function createPR(client: Client, opts: CreatePROptions): Promise<CreatePRResult> {
  try {
    const r = await callTool<GitHubPRPayload>(client, "create_pull_request", {
      owner: opts.owner,
      repo: opts.repo,
      title: opts.title,
      body: opts.body,
      head: opts.sourceBranch,
      base: opts.targetBranch,
    });
    return { id: String(r.id), url: r.html_url, number: r.number };
  } catch (e) {
    return { id: "", url: "", number: 0, error: (e as Error).message };
  }
}
```

## Error Handling

- **Missing PAT:** thrown synchronously from the constructor.
- **MCP transport / connect failure:** propagated from `getClient()` — the operation's `try/catch` converts it to the result's `error` field.
- **MCP tool error (`isError: true`):** thrown by `callTool`, caught by the operation, surfaced via `error` field.
- **Malformed tool response:** thrown by `callTool` (no text content / JSON parse failure), caught and surfaced via `error` field.

This matches the existing repo pattern (e.g. `CloneResult`, `ResetResult` in `git.types.ts`).

## Verification

- **Type-check:** `npm run typecheck` must pass for the whole monorepo.
- **Manual smoke test:** the operation files include a runnable `main()` block (matching the `clone-repos.ts` pattern) executable via `npx tsx packages/git-provider/src/providers/github/operations/get-repo.ts`. Reads `GITHUB_PERSONAL_ACCESS_TOKEN` from env.
  - `getRepo`: against a known public repo (e.g. `octocat/Hello-World`).
  - `createPR`: against a scratch repo/branch the developer controls.
- **Tool name verification:** during implementation, run `client.listTools()` once against the live MCP server to confirm `get_repository` and `create_pull_request` exist with the assumed argument shapes; adjust the operation files if names differ.

## Open Questions (defer to implementation)

1. Exact MCP tool names and response shapes — verify against `client.listTools()` at implementation time.
2. Whether to expose an explicit `close()` on `GitHubProvider` to tear down the MCP transport. Defer until a caller needs it.
