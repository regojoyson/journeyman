# GitHub Ticket Providers + MCP Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two new `ITicketProvider` implementations for GitHub (repo-level Issues via REST, Projects V2 via GraphQL), and a new `@journeyman/mcp-server` workspace package that exposes both over stdio MCP.

**Architecture:** `GitHubIssuesProvider` and `GitHubProjectsProvider` live in `packages/ticket-provider/src/providers/github-issues/` and `…/github-projects/`. Both call GitHub's public API directly via `fetch` — no Claude Agent SDK, no LLM layer. A separate `packages/mcp-server/` workspace imports both and registers 10 MCP tools over stdio. A one-line env-var rename (`GITHUB_PERSONAL_ACCESS_TOKEN` → `GITHUB_ACCESS_TOKEN`) unifies auth across this work and the existing `GitHubProvider` in `git-provider`.

**Tech Stack:** TypeScript ESM, Node `fetch`, `@modelcontextprotocol/sdk` (for the MCP server), `zod` (for tool input schemas). No test runner is configured in this monorepo; verification is **typecheck + manual smoke via `npx tsx -e`** per-operation, matching existing patterns in the codebase.

**Spec:** [docs/superpowers/specs/2026-04-18-github-ticket-providers-and-mcp-server-design.md](../specs/2026-04-18-github-ticket-providers-and-mcp-server-design.md)

---

## File Structure

### Touched (existing)

- `packages/core/src/types/ticket.types.ts` — add `status?` and `customFields?` to `CreateTicketOptions` (non-breaking).
- `packages/git-provider/src/providers/github/index.ts` — rename env var references.
- `packages/ticket-provider/src/index.ts` — export the two new providers.
- `packages/ticket-provider/package.json` — no change (no new runtime deps).
- `docs/superpowers/specs/2026-04-18-github-mcp-integration-design.md` — update env var references.
- `docs/superpowers/plans/2026-04-18-github-mcp-integration.md` — update env var references.
- Root `package.json` — no change (workspaces glob already covers new package).

### Created — GitHub Issues adapter

- `packages/ticket-provider/src/providers/github-issues/index.ts` — `GitHubIssuesProvider` class.
- `packages/ticket-provider/src/providers/github-issues/utils/github-rest.ts` — tiny `fetch` wrapper.
- `packages/ticket-provider/src/providers/github-issues/operations/create-ticket.ts`
- `packages/ticket-provider/src/providers/github-issues/operations/update-ticket.ts`
- `packages/ticket-provider/src/providers/github-issues/operations/get-ticket.ts`
- `packages/ticket-provider/src/providers/github-issues/operations/list-tickets.ts`
- `packages/ticket-provider/src/providers/github-issues/operations/get-ticket-schema.ts`

### Created — GitHub Projects adapter

- `packages/ticket-provider/src/providers/github-projects/index.ts` — `GitHubProjectsProvider` class.
- `packages/ticket-provider/src/providers/github-projects/utils/github-graphql.ts`
- `packages/ticket-provider/src/providers/github-projects/utils/field-resolver.ts`
- `packages/ticket-provider/src/providers/github-projects/utils/user-resolver.ts`
- `packages/ticket-provider/src/providers/github-projects/operations/create-ticket.ts`
- `packages/ticket-provider/src/providers/github-projects/operations/update-ticket.ts`
- `packages/ticket-provider/src/providers/github-projects/operations/get-ticket.ts`
- `packages/ticket-provider/src/providers/github-projects/operations/list-tickets.ts`
- `packages/ticket-provider/src/providers/github-projects/operations/get-ticket-schema.ts`

### Created — MCP server package

- `packages/mcp-server/package.json`
- `packages/mcp-server/tsconfig.json`
- `packages/mcp-server/README.md`
- `packages/mcp-server/src/cli.ts`
- `packages/mcp-server/src/server.ts`
- `packages/mcp-server/src/tools/github-issues.ts`
- `packages/mcp-server/src/tools/github-projects.ts`

---

## Conventions Used Throughout

- **ESM imports with `.ts` extensions** (matches existing code — see `packages/ticket-provider/src/index.ts`).
- **Soft-fail** on read-path not-found (return `{ error: "..." }`). **Hard-throw** on misconfiguration (missing PAT, malformed IDs, unknown custom field).
- **Type-check command** used as the per-task automated verification: `npm run typecheck --workspace=@journeyman/ticket-provider` (or `@journeyman/core` / `@journeyman/mcp-server`).
- **Commit after each completed task** with a `feat:`, `chore:`, or `refactor:` prefix.
- **All code blocks in this plan are complete** — copy-paste ready. No ellipses, no "similar to above".

---

## Task 1: Rename `GITHUB_PERSONAL_ACCESS_TOKEN` → `GITHUB_ACCESS_TOKEN`

**Files:**
- Modify: `packages/git-provider/src/providers/github/index.ts:14,23,26`
- Modify: `docs/superpowers/specs/2026-04-18-github-mcp-integration-design.md` (all occurrences)
- Modify: `docs/superpowers/plans/2026-04-18-github-mcp-integration.md` (all occurrences)

- [ ] **Step 1: Update `packages/git-provider/src/providers/github/index.ts`**

Replace lines 14, 23, 26 so the JSDoc, env read, and error message use the new name:

```typescript
  /** Personal Access Token. Falls back to GITHUB_ACCESS_TOKEN env var. */
  token?: string;
};

export class GitHubProvider implements IGitProvider {
  private readonly token: string;
  private client?: Client;

  constructor(opts: GitHubProviderOptions = {}) {
    const token = opts.token ?? process.env.GITHUB_ACCESS_TOKEN;
    if (!token) {
      throw new Error(
        "GitHubProvider: PAT required. Pass opts.token or set GITHUB_ACCESS_TOKEN.",
      );
    }
    this.token = token;
  }
```

- [ ] **Step 2: Update the two docs files**

In both `docs/superpowers/specs/2026-04-18-github-mcp-integration-design.md` and `docs/superpowers/plans/2026-04-18-github-mcp-integration.md`, replace every occurrence of `GITHUB_PERSONAL_ACCESS_TOKEN` with `GITHUB_ACCESS_TOKEN`.

Run (Bash tool):
```bash
sed -i '' 's/GITHUB_PERSONAL_ACCESS_TOKEN/GITHUB_ACCESS_TOKEN/g' docs/superpowers/specs/2026-04-18-github-mcp-integration-design.md docs/superpowers/plans/2026-04-18-github-mcp-integration.md
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck --workspace=@journeyman/git-provider`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/git-provider/src/providers/github/index.ts docs/superpowers/specs/2026-04-18-github-mcp-integration-design.md docs/superpowers/plans/2026-04-18-github-mcp-integration.md
git commit -m "chore: rename GITHUB_PERSONAL_ACCESS_TOKEN to GITHUB_ACCESS_TOKEN"
```

---

## Task 2: Extend `CreateTicketOptions` in `@journeyman/core`

**Files:**
- Modify: `packages/core/src/types/ticket.types.ts:44-50`

- [ ] **Step 1: Add `status` and `customFields` to `CreateTicketOptions`**

Replace lines 44-50 in `packages/core/src/types/ticket.types.ts` with:

```typescript
export type CreateTicketOptions = SessionOptions & {
  title: string;
  description?: string;
  assignee?: string;
  labels?: string[];
  projectId?: string;
  status?: string;
  customFields?: Record<string, unknown>;
};
```

Both new fields are optional — no downstream breakage.

- [ ] **Step 2: Verify typecheck passes across the whole workspace**

Run: `npm run typecheck`
Expected: exits 0, all packages green.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/ticket.types.ts
git commit -m "feat(core): add status and customFields to CreateTicketOptions"
```

---

## Task 3: GitHub Issues — `github-rest.ts` helper

**Files:**
- Create: `packages/ticket-provider/src/providers/github-issues/utils/github-rest.ts`

- [ ] **Step 1: Create directory and write helper**

Write `packages/ticket-provider/src/providers/github-issues/utils/github-rest.ts`:

```typescript
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
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck --workspace=@journeyman/ticket-provider`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/github-issues/utils/github-rest.ts
git commit -m "feat(ticket-provider): add github-issues REST helper"
```

---

## Task 4: GitHub Issues — `create-ticket.ts`

**Files:**
- Create: `packages/ticket-provider/src/providers/github-issues/operations/create-ticket.ts`

- [ ] **Step 1: Write the operation**

```typescript
import type {
  CreateTicketOptions,
  CreateTicketResult,
  Ticket,
} from "@journeyman/core";
import { ghRest, parseOwnerRepo } from "../utils/github-rest.ts";

type GitHubIssue = {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  assignees: { login: string }[];
  labels: ({ name: string } | string)[];
  created_at: string;
  updated_at: string;
  user: { login: string } | null;
  pull_request?: unknown;
};

function mapLabel(l: { name: string } | string): string {
  return typeof l === "string" ? l : l.name;
}

function mapStatus(opts: CreateTicketOptions): "open" | "closed" | undefined {
  if (!opts.status) return undefined;
  const s = opts.status.toLowerCase();
  return s === "closed" || s === "done" ? "closed" : "open";
}

export function toTicket(
  owner: string,
  repo: string,
  issue: GitHubIssue,
): Ticket {
  return {
    id: `${owner}/${repo}#${issue.number}`,
    title: issue.title,
    description: issue.body ?? undefined,
    status: issue.state,
    assignee: issue.assignees[0]?.login,
    labels: issue.labels.map(mapLabel),
    url: issue.html_url,
    reporter: issue.user?.login,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
  };
}

export async function createTicket(
  opts: CreateTicketOptions,
): Promise<CreateTicketResult> {
  const { owner, repo } = parseOwnerRepo(opts.projectId);

  const body: Record<string, unknown> = { title: opts.title };
  if (opts.description) body.body = opts.description;
  if (opts.assignee) body.assignees = [opts.assignee];
  if (opts.labels?.length) body.labels = opts.labels;

  const res = await ghRest<GitHubIssue>(
    "POST",
    `/repos/${owner}/${repo}/issues`,
    body,
  );
  if (!res.ok) return { error: res.message };

  const ticket = toTicket(owner, repo, res.data);

  // status is lossy (open/closed only) — apply via a follow-up PATCH if requested
  const targetState = mapStatus(opts);
  if (targetState && targetState !== res.data.state) {
    const patch = await ghRest<GitHubIssue>(
      "PATCH",
      `/repos/${owner}/${repo}/issues/${res.data.number}`,
      { state: targetState },
    );
    if (patch.ok) return { ticket: toTicket(owner, repo, patch.data) };
  }

  return { ticket };
}
```

Note: `opts.customFields` is silently ignored for GitHub issues (documented in the spec §5.3). We do **not** warn here because this module is re-imported per-op; warn-once tracking adds state with no real value — a JSDoc note on the provider class covers it.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/ticket-provider`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/github-issues/operations/create-ticket.ts
git commit -m "feat(ticket-provider): github-issues createTicket"
```

---

## Task 5: GitHub Issues — `get-ticket.ts`

**Files:**
- Create: `packages/ticket-provider/src/providers/github-issues/operations/get-ticket.ts`

- [ ] **Step 1: Write the operation**

```typescript
import type { GetTicketOptions, GetTicketResult } from "@journeyman/core";
import { ghRest, parseIssueId } from "../utils/github-rest.ts";
import { toTicket } from "./create-ticket.ts";

type GitHubIssue = Parameters<typeof toTicket>[2];

export async function getTicket(
  opts: GetTicketOptions,
): Promise<GetTicketResult> {
  const { owner, repo, number } = parseIssueId(opts.id);
  const res = await ghRest<GitHubIssue>(
    "GET",
    `/repos/${owner}/${repo}/issues/${number}`,
  );
  if (!res.ok) return { error: `not found: ${opts.id}` };
  return { ticket: toTicket(owner, repo, res.data) };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/ticket-provider`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/github-issues/operations/get-ticket.ts
git commit -m "feat(ticket-provider): github-issues getTicket"
```

---

## Task 6: GitHub Issues — `update-ticket.ts`

**Files:**
- Create: `packages/ticket-provider/src/providers/github-issues/operations/update-ticket.ts`

- [ ] **Step 1: Write the operation**

```typescript
import type { UpdateTicketOptions, UpdateTicketResult } from "@journeyman/core";
import { ghRest, parseIssueId } from "../utils/github-rest.ts";
import { toTicket } from "./create-ticket.ts";

type GitHubIssue = Parameters<typeof toTicket>[2];

function mapState(status: string | undefined): "open" | "closed" | undefined {
  if (!status) return undefined;
  const s = status.toLowerCase();
  return s === "closed" || s === "done" ? "closed" : "open";
}

export async function updateTicket(
  opts: UpdateTicketOptions,
): Promise<UpdateTicketResult> {
  const { owner, repo, number } = parseIssueId(opts.id);

  const body: Record<string, unknown> = {};
  if (opts.title !== undefined) body.title = opts.title;
  if (opts.description !== undefined) body.body = opts.description;
  if (opts.assignee !== undefined) body.assignees = [opts.assignee];
  if (opts.labels !== undefined) body.labels = opts.labels;
  const state = mapState(opts.status);
  if (state !== undefined) body.state = state;

  if (Object.keys(body).length === 0) {
    return { error: "updateTicket: no fields to update" };
  }

  const res = await ghRest<GitHubIssue>(
    "PATCH",
    `/repos/${owner}/${repo}/issues/${number}`,
    body,
  );
  if (!res.ok) return { error: `not found: ${opts.id}` };
  return { ticket: toTicket(owner, repo, res.data) };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/ticket-provider`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/github-issues/operations/update-ticket.ts
git commit -m "feat(ticket-provider): github-issues updateTicket"
```

---

## Task 7: GitHub Issues — `list-tickets.ts`

**Files:**
- Create: `packages/ticket-provider/src/providers/github-issues/operations/list-tickets.ts`

- [ ] **Step 1: Write the operation**

```typescript
import type { ListTicketsOptions, ListTicketsResult } from "@journeyman/core";
import { ghRest, parseOwnerRepo } from "../utils/github-rest.ts";
import { toTicket } from "./create-ticket.ts";

type GitHubIssue = Parameters<typeof toTicket>[2];

export async function listTickets(
  opts: ListTicketsOptions,
): Promise<ListTicketsResult> {
  const { owner, repo } = parseOwnerRepo(opts.projectId);

  const params = new URLSearchParams({ per_page: "100" });
  const state = opts.status?.toLowerCase();
  if (state === "open" || state === "closed") {
    params.set("state", state);
  } else {
    params.set("state", "all");
  }
  if (opts.assignee) params.set("assignee", opts.assignee);

  const res = await ghRest<GitHubIssue[]>(
    "GET",
    `/repos/${owner}/${repo}/issues?${params.toString()}`,
  );
  if (!res.ok) return { tickets: [], error: res.message };

  const tickets = res.data
    .filter((i) => (i as { pull_request?: unknown }).pull_request == null)
    .map((i) => toTicket(owner, repo, i));

  return { tickets };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/ticket-provider`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/github-issues/operations/list-tickets.ts
git commit -m "feat(ticket-provider): github-issues listTickets"
```

---

## Task 8: GitHub Issues — `get-ticket-schema.ts`

**Files:**
- Create: `packages/ticket-provider/src/providers/github-issues/operations/get-ticket-schema.ts`

- [ ] **Step 1: Write the operation**

```typescript
import type {
  GetTicketSchemaOptions,
  GetTicketSchemaResult,
  TicketField,
} from "@journeyman/core";

const STATIC_FIELDS: TicketField[] = [
  { id: "title", name: "title", type: "string", required: true },
  { id: "body", name: "description", type: "string" },
  { id: "assignees", name: "assignees", type: "array<string>" },
  { id: "labels", name: "labels", type: "array<string>" },
  {
    id: "state",
    name: "state",
    type: "enum",
    allowedValues: ["open", "closed"],
  },
  { id: "milestone", name: "milestone", type: "string" },
];

export async function getTicketSchema(
  _opts: GetTicketSchemaOptions,
): Promise<GetTicketSchemaResult> {
  return { fields: STATIC_FIELDS };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/ticket-provider`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/github-issues/operations/get-ticket-schema.ts
git commit -m "feat(ticket-provider): github-issues getTicketSchema (static)"
```

---

## Task 9: GitHub Issues — Provider class + wire into package exports

**Files:**
- Create: `packages/ticket-provider/src/providers/github-issues/index.ts`
- Modify: `packages/ticket-provider/src/index.ts`

- [ ] **Step 1: Create the provider class**

Write `packages/ticket-provider/src/providers/github-issues/index.ts`:

```typescript
import type { ITicketProvider } from "@journeyman/core";
import type {
  CreateTicketOptions,
  CreateTicketResult,
  UpdateTicketOptions,
  UpdateTicketResult,
  GetTicketOptions,
  GetTicketResult,
  ListTicketsOptions,
  ListTicketsResult,
  GetTicketSchemaOptions,
  GetTicketSchemaResult,
} from "@journeyman/core";
import { createTicket } from "./operations/create-ticket.ts";
import { updateTicket } from "./operations/update-ticket.ts";
import { getTicket } from "./operations/get-ticket.ts";
import { listTickets } from "./operations/list-tickets.ts";
import { getTicketSchema } from "./operations/get-ticket-schema.ts";

/**
 * GitHub repo-level issue tracker provider (REST).
 *
 * - `opts.projectId` for create/list is `"owner/repo"`.
 * - `opts.id` for get/update is composite `"owner/repo#<number>"`.
 * - `status` maps to GitHub's binary `open`/`closed`; values "closed"/"done"
 *   (case-insensitive) map to `closed`, anything else to `open`.
 * - `priority`, `issueType`, `customFields` have no GitHub equivalent and are
 *   silently ignored.
 * - Requires `GITHUB_ACCESS_TOKEN` env var with `repo` scope.
 */
export class GitHubIssuesProvider implements ITicketProvider {
  createTicket(opts: CreateTicketOptions): Promise<CreateTicketResult> {
    return createTicket(opts);
  }
  updateTicket(opts: UpdateTicketOptions): Promise<UpdateTicketResult> {
    return updateTicket(opts);
  }
  getTicket(opts: GetTicketOptions): Promise<GetTicketResult> {
    return getTicket(opts);
  }
  listTickets(opts: ListTicketsOptions): Promise<ListTicketsResult> {
    return listTickets(opts);
  }
  getTicketSchema(opts: GetTicketSchemaOptions): Promise<GetTicketSchemaResult> {
    return getTicketSchema(opts);
  }
}
```

- [ ] **Step 2: Add export to `packages/ticket-provider/src/index.ts`**

After the existing exports, add:

```typescript
export { GitHubIssuesProvider } from "./providers/github-issues/index.ts";
```

Final file content:

```typescript
export { JiraProvider } from "./providers/jira/index.ts";
export { LinearProvider } from "./providers/linear/index.ts";
export { MondayProvider } from "./providers/monday/index.ts";
export { GitHubIssuesProvider } from "./providers/github-issues/index.ts";
export type { ITicketProvider } from "@journeyman/core";
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/ticket-provider`
Expected: exits 0.

- [ ] **Step 4: Smoke test (optional, requires real PAT + test repo)**

Only run this if you have a throwaway repo. Set `GITHUB_ACCESS_TOKEN` first.

```bash
GITHUB_ACCESS_TOKEN=<pat> npx tsx -e "
import('./packages/ticket-provider/src/providers/github-issues/index.ts').then(async ({ GitHubIssuesProvider }) => {
  const p = new GitHubIssuesProvider();
  const created = await p.createTicket({ projectId: '<your-owner>/<your-test-repo>', title: 'journeyman smoke', description: 'created via GitHubIssuesProvider' });
  console.log('created:', JSON.stringify(created, null, 2));
  if (created.ticket) {
    const got = await p.getTicket({ id: created.ticket.id });
    console.log('got:', JSON.stringify(got, null, 2));
    const updated = await p.updateTicket({ id: created.ticket.id, status: 'closed' });
    console.log('updated:', JSON.stringify(updated, null, 2));
  }
});
"
```

Expected: three JSON blobs, each containing a `ticket` object. Issue state transitions open → closed.

- [ ] **Step 5: Commit**

```bash
git add packages/ticket-provider/src/providers/github-issues/index.ts packages/ticket-provider/src/index.ts
git commit -m "feat(ticket-provider): GitHubIssuesProvider"
```

---

## Task 10: GitHub Projects — `github-graphql.ts` helper

**Files:**
- Create: `packages/ticket-provider/src/providers/github-projects/utils/github-graphql.ts`

- [ ] **Step 1: Write the helper**

```typescript
const GRAPHQL_URL = "https://api.github.com/graphql";

export class GitHubGraphQLError extends Error {
  constructor(
    message: string,
    public readonly errors?: unknown[],
  ) {
    super(message);
    this.name = "GitHubGraphQLError";
  }
}

function getToken(): string {
  const token = process.env.GITHUB_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "GitHubProjectsProvider: PAT required. Set GITHUB_ACCESS_TOKEN.",
    );
  }
  return token;
}

type GraphQLResponse<T> = { data?: T; errors?: { message: string; path?: string[] }[] };

export async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "journeyman",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new GitHubGraphQLError(
      `GitHub GraphQL HTTP ${res.status} ${res.statusText}`,
    );
  }

  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    const first = json.errors[0];
    throw new GitHubGraphQLError(
      `GitHub GraphQL error: ${first.message}${first.path ? ` (path: ${first.path.join(".")})` : ""}`,
      json.errors,
    );
  }
  if (!json.data) {
    throw new GitHubGraphQLError("GitHub GraphQL returned no data");
  }
  return json.data;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/ticket-provider`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/github-projects/utils/github-graphql.ts
git commit -m "feat(ticket-provider): add github-projects GraphQL helper"
```

---

## Task 11: GitHub Projects — `user-resolver.ts`

**Files:**
- Create: `packages/ticket-provider/src/providers/github-projects/utils/user-resolver.ts`

- [ ] **Step 1: Write the resolver**

```typescript
import { gql } from "./github-graphql.ts";

const USER_QUERY = `query($login: String!) { user(login: $login) { id } }`;

type UserResp = { user: { id: string } | null };

export class UserResolver {
  private cache = new Map<string, string>();

  async resolve(login: string): Promise<string> {
    const cached = this.cache.get(login);
    if (cached) return cached;
    const data = await gql<UserResp>(USER_QUERY, { login });
    if (!data.user) {
      throw new Error(
        `GitHubProjectsProvider: user '${login}' not found`,
      );
    }
    this.cache.set(login, data.user.id);
    return data.user.id;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/ticket-provider`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/github-projects/utils/user-resolver.ts
git commit -m "feat(ticket-provider): github-projects user resolver"
```

---

## Task 12: GitHub Projects — `field-resolver.ts`

**Files:**
- Create: `packages/ticket-provider/src/providers/github-projects/utils/field-resolver.ts`

- [ ] **Step 1: Write the field resolver**

```typescript
import { gql } from "./github-graphql.ts";

export type FieldDef =
  | { kind: "text"; id: string; name: string }
  | { kind: "number"; id: string; name: string }
  | { kind: "date"; id: string; name: string }
  | {
      kind: "single_select";
      id: string;
      name: string;
      options: { id: string; name: string }[];
    }
  | {
      kind: "iteration";
      id: string;
      name: string;
      iterations: { id: string; title: string }[];
    };

const FIELDS_QUERY = `
query($id: ID!) {
  node(id: $id) {
    ... on ProjectV2 {
      fields(first: 50) {
        nodes {
          __typename
          ... on ProjectV2Field { id name dataType }
          ... on ProjectV2SingleSelectField {
            id name dataType options { id name }
          }
          ... on ProjectV2IterationField {
            id name dataType
            configuration {
              iterations { id title }
              completedIterations { id title }
            }
          }
        }
      }
    }
  }
}`;

type FieldsResp = {
  node: {
    fields: {
      nodes: Array<{
        __typename: string;
        id: string;
        name: string;
        dataType?: string;
        options?: { id: string; name: string }[];
        configuration?: {
          iterations: { id: string; title: string }[];
          completedIterations: { id: string; title: string }[];
        };
      }>;
    };
  } | null;
};

function toFieldDef(
  n: FieldsResp["node"] extends infer X ? X extends { fields: { nodes: infer A } } ? A extends Array<infer E> ? E : never : never : never,
): FieldDef | null {
  if (n.__typename === "ProjectV2SingleSelectField") {
    return {
      kind: "single_select",
      id: n.id,
      name: n.name,
      options: n.options ?? [],
    };
  }
  if (n.__typename === "ProjectV2IterationField") {
    return {
      kind: "iteration",
      id: n.id,
      name: n.name,
      iterations: [
        ...(n.configuration?.iterations ?? []),
        ...(n.configuration?.completedIterations ?? []),
      ],
    };
  }
  if (n.__typename === "ProjectV2Field") {
    switch (n.dataType) {
      case "TEXT":   return { kind: "text",   id: n.id, name: n.name };
      case "NUMBER": return { kind: "number", id: n.id, name: n.name };
      case "DATE":   return { kind: "date",   id: n.id, name: n.name };
      default: return null; // unsupported field kind — ignore
    }
  }
  return null;
}

export type ResolvedFieldValue =
  | { fieldId: string; value: { text: string } }
  | { fieldId: string; value: { number: number } }
  | { fieldId: string; value: { date: string } }
  | { fieldId: string; value: { singleSelectOptionId: string } }
  | { fieldId: string; value: { iterationId: string } };

export class FieldResolver {
  private cache = new Map<string, Map<string, FieldDef>>();

  async load(projectId: string): Promise<Map<string, FieldDef>> {
    const cached = this.cache.get(projectId);
    if (cached) return cached;
    const data = await gql<FieldsResp>(FIELDS_QUERY, { id: projectId });
    if (!data.node) {
      throw new Error(
        `GitHubProjectsProvider: project node ${projectId} not found (or token lacks 'read:project' scope)`,
      );
    }
    const map = new Map<string, FieldDef>();
    for (const raw of data.node.fields.nodes) {
      const def = toFieldDef(raw);
      if (def) map.set(def.name.toLowerCase(), def);
    }
    this.cache.set(projectId, map);
    return map;
  }

  async resolveAll(
    projectId: string,
    customFields: Record<string, unknown>,
  ): Promise<ResolvedFieldValue[]> {
    const defs = await this.load(projectId);
    const out: ResolvedFieldValue[] = [];
    for (const [name, rawValue] of Object.entries(customFields)) {
      const def = defs.get(name.toLowerCase());
      if (!def) {
        const known = [...defs.values()].map((d) => d.name).join(", ");
        throw new Error(
          `GitHubProjectsProvider: field '${name}' not found on project. Known fields: ${known}`,
        );
      }
      out.push(resolveOne(def, name, rawValue));
    }
    return out;
  }

  knownFieldNames(projectId: string): string[] | undefined {
    const m = this.cache.get(projectId);
    return m ? [...m.values()].map((d) => d.name) : undefined;
  }

  fieldDefsFor(projectId: string): FieldDef[] | undefined {
    const m = this.cache.get(projectId);
    return m ? [...m.values()] : undefined;
  }
}

function resolveOne(def: FieldDef, name: string, raw: unknown): ResolvedFieldValue {
  switch (def.kind) {
    case "text": {
      if (typeof raw !== "string") {
        throw new Error(
          `GitHubProjectsProvider: field '${name}' expects string (TEXT), got ${typeof raw}`,
        );
      }
      return { fieldId: def.id, value: { text: raw } };
    }
    case "number": {
      if (typeof raw !== "number") {
        throw new Error(
          `GitHubProjectsProvider: field '${name}' expects number, got ${typeof raw}`,
        );
      }
      return { fieldId: def.id, value: { number: raw } };
    }
    case "date": {
      const str =
        raw instanceof Date
          ? raw.toISOString().slice(0, 10)
          : typeof raw === "string"
          ? raw.slice(0, 10)
          : null;
      if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        throw new Error(
          `GitHubProjectsProvider: field '${name}' expects Date or YYYY-MM-DD, got ${JSON.stringify(raw)}`,
        );
      }
      return { fieldId: def.id, value: { date: str } };
    }
    case "single_select": {
      if (typeof raw !== "string") {
        throw new Error(
          `GitHubProjectsProvider: field '${name}' expects a single-select option name (string), got ${typeof raw}`,
        );
      }
      const opt = def.options.find((o) => o.name.toLowerCase() === raw.toLowerCase());
      if (!opt) {
        const known = def.options.map((o) => o.name).join(", ");
        throw new Error(
          `GitHubProjectsProvider: option '${raw}' not found on field '${name}'. Options: ${known}`,
        );
      }
      return { fieldId: def.id, value: { singleSelectOptionId: opt.id } };
    }
    case "iteration": {
      if (typeof raw !== "string") {
        throw new Error(
          `GitHubProjectsProvider: field '${name}' expects an iteration title (string), got ${typeof raw}`,
        );
      }
      const it = def.iterations.find((i) => i.title.toLowerCase() === raw.toLowerCase());
      if (!it) {
        const known = def.iterations.map((i) => i.title).join(", ");
        throw new Error(
          `GitHubProjectsProvider: iteration '${raw}' not found on field '${name}'. Iterations: ${known}`,
        );
      }
      return { fieldId: def.id, value: { iterationId: it.id } };
    }
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/ticket-provider`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/github-projects/utils/field-resolver.ts
git commit -m "feat(ticket-provider): github-projects field resolver"
```

---

## Task 13: GitHub Projects — `create-ticket.ts`

**Files:**
- Create: `packages/ticket-provider/src/providers/github-projects/operations/create-ticket.ts`

- [ ] **Step 1: Write the operation**

```typescript
import type {
  CreateTicketOptions,
  CreateTicketResult,
  Ticket,
} from "@journeyman/core";
import { gql } from "../utils/github-graphql.ts";
import { FieldResolver } from "../utils/field-resolver.ts";
import { UserResolver } from "../utils/user-resolver.ts";

const ADD_DRAFT = `
mutation($projectId: ID!, $title: String!, $body: String, $assigneeIds: [ID!]) {
  addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body, assigneeIds: $assigneeIds }) {
    projectItem {
      id
      content { ... on DraftIssue { id title body assignees(first: 10) { nodes { login } } } }
    }
  }
}`;

const UPDATE_FIELD = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
  updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value }) {
    projectV2Item { id }
  }
}`;

type AddDraftResp = {
  addProjectV2DraftIssue: {
    projectItem: {
      id: string;
      content: {
        id: string;
        title: string;
        body: string | null;
        assignees: { nodes: { login: string }[] };
      };
    };
  };
};

export function mergeCustomFields(opts: {
  status?: string;
  labels?: string[];
  customFields?: Record<string, unknown>;
}): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  if (opts.status !== undefined) merged.Status = opts.status;
  if (opts.labels !== undefined) merged.Labels = opts.labels;
  if (opts.customFields) Object.assign(merged, opts.customFields);
  return merged;
}

export async function createTicket(
  opts: CreateTicketOptions,
  fieldResolver: FieldResolver,
  userResolver: UserResolver,
): Promise<CreateTicketResult> {
  if (!opts.projectId) {
    throw new Error(
      "GitHubProjectsProvider: projectId (project node ID, e.g. PVT_...) is required",
    );
  }

  const assigneeIds = opts.assignee
    ? [await userResolver.resolve(opts.assignee)]
    : [];

  const addResp = await gql<AddDraftResp>(ADD_DRAFT, {
    projectId: opts.projectId,
    title: opts.title,
    body: opts.description ?? null,
    assigneeIds,
  });

  const item = addResp.addProjectV2DraftIssue.projectItem;
  const fieldsToSet = mergeCustomFields(opts);

  // apply custom fields sequentially, surfacing unknown-field errors clearly
  const applied: Record<string, unknown> = {};
  if (Object.keys(fieldsToSet).length > 0) {
    // "Labels" field is soft — skip if project has no such field
    const defs = await fieldResolver.load(opts.projectId);
    const resolvable: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fieldsToSet)) {
      if (k.toLowerCase() === "labels" && !defs.has("labels")) continue;
      resolvable[k] = v;
    }
    const resolved = await fieldResolver.resolveAll(opts.projectId, resolvable);
    for (const r of resolved) {
      await gql(UPDATE_FIELD, {
        projectId: opts.projectId,
        itemId: item.id,
        fieldId: r.fieldId,
        value: r.value,
      });
    }
    Object.assign(applied, resolvable);
  }

  const ticket: Ticket = {
    id: item.id,
    title: item.content.title,
    description: item.content.body ?? undefined,
    assignee: item.content.assignees.nodes[0]?.login,
    url: undefined,
    customFields: applied,
  };
  return { ticket };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/ticket-provider`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/github-projects/operations/create-ticket.ts
git commit -m "feat(ticket-provider): github-projects createTicket (draft + fields)"
```

---

## Task 14: GitHub Projects — `get-ticket.ts`

**Files:**
- Create: `packages/ticket-provider/src/providers/github-projects/operations/get-ticket.ts`

- [ ] **Step 1: Write the operation**

```typescript
import type { GetTicketOptions, GetTicketResult, Ticket } from "@journeyman/core";
import { gql } from "../utils/github-graphql.ts";

const GET_ITEM = `
query($id: ID!) {
  node(id: $id) {
    ... on ProjectV2Item {
      id
      content {
        ... on DraftIssue {
          id
          title
          body
          assignees(first: 10) { nodes { login } }
        }
      }
      fieldValues(first: 50) {
        nodes {
          __typename
          ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2Field { name } } }
          ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2Field { name } } }
          ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2Field { name } } }
          ... on ProjectV2ItemFieldSingleSelectValue {
            name
            field { ... on ProjectV2SingleSelectField { name } }
          }
          ... on ProjectV2ItemFieldIterationValue {
            title
            field { ... on ProjectV2IterationField { name } }
          }
        }
      }
    }
  }
}`;

type FieldValueNode =
  | { __typename: "ProjectV2ItemFieldTextValue"; text: string; field: { name: string } }
  | { __typename: "ProjectV2ItemFieldNumberValue"; number: number; field: { name: string } }
  | { __typename: "ProjectV2ItemFieldDateValue"; date: string; field: { name: string } }
  | { __typename: "ProjectV2ItemFieldSingleSelectValue"; name: string; field: { name: string } }
  | { __typename: "ProjectV2ItemFieldIterationValue"; title: string; field: { name: string } }
  | { __typename: string };

type GetResp = {
  node: {
    id: string;
    content: {
      id: string;
      title: string;
      body: string | null;
      assignees: { nodes: { login: string }[] };
    } | null;
    fieldValues: { nodes: FieldValueNode[] };
  } | null;
};

export function extractField(n: FieldValueNode): [string, unknown] | null {
  switch (n.__typename) {
    case "ProjectV2ItemFieldTextValue":
      return [(n as { field: { name: string } }).field.name, (n as { text: string }).text];
    case "ProjectV2ItemFieldNumberValue":
      return [(n as { field: { name: string } }).field.name, (n as { number: number }).number];
    case "ProjectV2ItemFieldDateValue":
      return [(n as { field: { name: string } }).field.name, (n as { date: string }).date];
    case "ProjectV2ItemFieldSingleSelectValue":
      return [(n as { field: { name: string } }).field.name, (n as { name: string }).name];
    case "ProjectV2ItemFieldIterationValue":
      return [(n as { field: { name: string } }).field.name, (n as { title: string }).title];
    default:
      return null;
  }
}

export async function getTicket(opts: GetTicketOptions): Promise<GetTicketResult> {
  const data = await gql<GetResp>(GET_ITEM, { id: opts.id });
  if (!data.node || !data.node.content) {
    return { error: `not found: ${opts.id}` };
  }
  const customFields: Record<string, unknown> = {};
  for (const n of data.node.fieldValues.nodes) {
    const entry = extractField(n);
    if (entry) customFields[entry[0]] = entry[1];
  }
  const ticket: Ticket = {
    id: data.node.id,
    title: data.node.content.title,
    description: data.node.content.body ?? undefined,
    assignee: data.node.content.assignees.nodes[0]?.login,
    status: typeof customFields.Status === "string" ? customFields.Status : undefined,
    labels: Array.isArray(customFields.Labels)
      ? (customFields.Labels as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined,
    url: undefined,
    customFields,
  };
  return { ticket };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/ticket-provider`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/github-projects/operations/get-ticket.ts
git commit -m "feat(ticket-provider): github-projects getTicket"
```

---

## Task 15: GitHub Projects — `update-ticket.ts`

**Files:**
- Create: `packages/ticket-provider/src/providers/github-projects/operations/update-ticket.ts`

- [ ] **Step 1: Write the operation**

```typescript
import type { UpdateTicketOptions, UpdateTicketResult } from "@journeyman/core";
import { gql } from "../utils/github-graphql.ts";
import { FieldResolver } from "../utils/field-resolver.ts";
import { mergeCustomFields } from "./create-ticket.ts";
import { getTicket } from "./get-ticket.ts";

const GET_DRAFT_ID = `
query($id: ID!) {
  node(id: $id) {
    ... on ProjectV2Item {
      content { ... on DraftIssue { id } }
      project { id }
    }
  }
}`;

const UPDATE_DRAFT = `
mutation($draftIssueId: ID!, $title: String, $body: String) {
  updateProjectV2DraftIssue(input: { draftIssueId: $draftIssueId, title: $title, body: $body }) {
    draftIssue { id }
  }
}`;

const UPDATE_FIELD = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
  updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value }) {
    projectV2Item { id }
  }
}`;

type IdResp = {
  node: {
    content: { id: string } | null;
    project: { id: string } | null;
  } | null;
};

export async function updateTicket(
  opts: UpdateTicketOptions,
  fieldResolver: FieldResolver,
): Promise<UpdateTicketResult> {
  const idResp = await gql<IdResp>(GET_DRAFT_ID, { id: opts.id });
  if (!idResp.node || !idResp.node.content || !idResp.node.project) {
    return { error: `not found: ${opts.id}` };
  }
  const draftIssueId = idResp.node.content.id;
  const projectId = idResp.node.project.id;

  if (opts.title !== undefined || opts.description !== undefined) {
    await gql(UPDATE_DRAFT, {
      draftIssueId,
      title: opts.title ?? null,
      body: opts.description ?? null,
    });
  }

  const fieldsToSet = mergeCustomFields({
    status: opts.status,
    labels: opts.labels,
    customFields: opts.customFields,
  });
  if (Object.keys(fieldsToSet).length > 0) {
    const defs = await fieldResolver.load(projectId);
    const resolvable: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fieldsToSet)) {
      if (k.toLowerCase() === "labels" && !defs.has("labels")) continue;
      resolvable[k] = v;
    }
    const resolved = await fieldResolver.resolveAll(projectId, resolvable);
    for (const r of resolved) {
      await gql(UPDATE_FIELD, {
        projectId,
        itemId: opts.id,
        fieldId: r.fieldId,
        value: r.value,
      });
    }
  }

  return getTicket({ id: opts.id });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/ticket-provider`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/github-projects/operations/update-ticket.ts
git commit -m "feat(ticket-provider): github-projects updateTicket"
```

---

## Task 16: GitHub Projects — `list-tickets.ts`

**Files:**
- Create: `packages/ticket-provider/src/providers/github-projects/operations/list-tickets.ts`

- [ ] **Step 1: Write the operation**

```typescript
import type { ListTicketsOptions, ListTicketsResult, Ticket } from "@journeyman/core";
import { gql } from "../utils/github-graphql.ts";
import { extractField } from "./get-ticket.ts";

const LIST_ITEMS = `
query($id: ID!) {
  node(id: $id) {
    ... on ProjectV2 {
      items(first: 100) {
        nodes {
          id
          content {
            ... on DraftIssue {
              id
              title
              body
              assignees(first: 10) { nodes { login } }
            }
          }
          fieldValues(first: 50) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2Field { name } } }
              ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2Field { name } } }
              ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2Field { name } } }
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2SingleSelectField { name } }
              }
              ... on ProjectV2ItemFieldIterationValue {
                title
                field { ... on ProjectV2IterationField { name } }
              }
            }
          }
        }
      }
    }
  }
}`;

type ListResp = {
  node: {
    items: {
      nodes: Array<{
        id: string;
        content: {
          id: string;
          title: string;
          body: string | null;
          assignees: { nodes: { login: string }[] };
        } | null;
        fieldValues: { nodes: Parameters<typeof extractField>[0][] };
      }>;
    };
  } | null;
};

export async function listTickets(
  opts: ListTicketsOptions,
): Promise<ListTicketsResult> {
  if (!opts.projectId) {
    throw new Error(
      "GitHubProjectsProvider: projectId (project node ID) is required for listTickets",
    );
  }

  const data = await gql<ListResp>(LIST_ITEMS, { id: opts.projectId });
  if (!data.node) return { tickets: [], error: `project not found: ${opts.projectId}` };

  const tickets: Ticket[] = [];
  for (const item of data.node.items.nodes) {
    if (!item.content) continue; // skip non-draft items (linked issues/PRs)
    const customFields: Record<string, unknown> = {};
    for (const n of item.fieldValues.nodes) {
      const entry = extractField(n);
      if (entry) customFields[entry[0]] = entry[1];
    }
    const status = typeof customFields.Status === "string" ? customFields.Status : undefined;
    const assignee = item.content.assignees.nodes[0]?.login;

    // client-side filters
    if (opts.status && status !== opts.status) continue;
    if (opts.assignee && assignee !== opts.assignee) continue;

    tickets.push({
      id: item.id,
      title: item.content.title,
      description: item.content.body ?? undefined,
      assignee,
      status,
      labels: Array.isArray(customFields.Labels)
        ? (customFields.Labels as unknown[]).filter((x): x is string => typeof x === "string")
        : undefined,
      url: undefined,
      customFields,
    });
  }
  return { tickets };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/ticket-provider`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/github-projects/operations/list-tickets.ts
git commit -m "feat(ticket-provider): github-projects listTickets"
```

---

## Task 17: GitHub Projects — `get-ticket-schema.ts`

**Files:**
- Create: `packages/ticket-provider/src/providers/github-projects/operations/get-ticket-schema.ts`

- [ ] **Step 1: Write the operation**

```typescript
import type {
  GetTicketSchemaOptions,
  GetTicketSchemaResult,
  TicketField,
} from "@journeyman/core";
import { FieldResolver, type FieldDef } from "../utils/field-resolver.ts";

function defToField(def: FieldDef): TicketField {
  switch (def.kind) {
    case "text":
      return { id: def.id, name: def.name, type: "string" };
    case "number":
      return { id: def.id, name: def.name, type: "number" };
    case "date":
      return { id: def.id, name: def.name, type: "date" };
    case "single_select":
      return {
        id: def.id,
        name: def.name,
        type: "enum",
        allowedValues: def.options.map((o) => o.name),
      };
    case "iteration":
      return {
        id: def.id,
        name: def.name,
        type: "iteration",
        allowedValues: def.iterations.map((i) => i.title),
      };
  }
}

export async function getTicketSchema(
  opts: GetTicketSchemaOptions,
  fieldResolver: FieldResolver,
): Promise<GetTicketSchemaResult> {
  if (!opts.projectId) {
    return { fields: [], error: "projectId (project node ID) is required" };
  }
  await fieldResolver.load(opts.projectId);
  const defs = fieldResolver.fieldDefsFor(opts.projectId) ?? [];
  return { fields: defs.map(defToField) };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/ticket-provider`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/github-projects/operations/get-ticket-schema.ts
git commit -m "feat(ticket-provider): github-projects getTicketSchema (dynamic)"
```

---

## Task 18: GitHub Projects — Provider class + wire into package exports

**Files:**
- Create: `packages/ticket-provider/src/providers/github-projects/index.ts`
- Modify: `packages/ticket-provider/src/index.ts`

- [ ] **Step 1: Create the provider class**

Write `packages/ticket-provider/src/providers/github-projects/index.ts`:

```typescript
import type { ITicketProvider } from "@journeyman/core";
import type {
  CreateTicketOptions,
  CreateTicketResult,
  UpdateTicketOptions,
  UpdateTicketResult,
  GetTicketOptions,
  GetTicketResult,
  ListTicketsOptions,
  ListTicketsResult,
  GetTicketSchemaOptions,
  GetTicketSchemaResult,
} from "@journeyman/core";
import { FieldResolver } from "./utils/field-resolver.ts";
import { UserResolver } from "./utils/user-resolver.ts";
import { createTicket } from "./operations/create-ticket.ts";
import { updateTicket } from "./operations/update-ticket.ts";
import { getTicket } from "./operations/get-ticket.ts";
import { listTickets } from "./operations/list-tickets.ts";
import { getTicketSchema } from "./operations/get-ticket-schema.ts";

/**
 * GitHub Projects V2 provider (GraphQL, draft issues only).
 *
 * - `opts.projectId` is the project's **GraphQL node ID** (e.g. `PVT_kwDOA...`).
 * - `opts.id` for get/update is the project item's node ID (e.g. `PVTI_...`).
 * - Creates **draft issues** inside the project. Real repo issues added to the
 *   project are surfaced on read via `listTickets` but cannot be created through
 *   this provider — use `GitHubIssuesProvider` for that.
 * - `opts.status` is sugar for `customFields: { Status: opts.status }`.
 * - `opts.labels` is sugar for `customFields: { Labels: opts.labels }` iff a
 *   "Labels" field exists on the project; otherwise silently skipped.
 * - `opts.customFields` keys are field **names** (human-readable); the provider
 *   resolves them to IDs via introspection and caches per instance.
 * - Requires `GITHUB_ACCESS_TOKEN` env var with `project` + `read:project` scopes.
 */
export class GitHubProjectsProvider implements ITicketProvider {
  private readonly fieldResolver = new FieldResolver();
  private readonly userResolver = new UserResolver();

  createTicket(opts: CreateTicketOptions): Promise<CreateTicketResult> {
    return createTicket(opts, this.fieldResolver, this.userResolver);
  }
  updateTicket(opts: UpdateTicketOptions): Promise<UpdateTicketResult> {
    return updateTicket(opts, this.fieldResolver);
  }
  getTicket(opts: GetTicketOptions): Promise<GetTicketResult> {
    return getTicket(opts);
  }
  listTickets(opts: ListTicketsOptions): Promise<ListTicketsResult> {
    return listTickets(opts);
  }
  getTicketSchema(opts: GetTicketSchemaOptions): Promise<GetTicketSchemaResult> {
    return getTicketSchema(opts, this.fieldResolver);
  }
}
```

- [ ] **Step 2: Add export**

Update `packages/ticket-provider/src/index.ts`:

```typescript
export { JiraProvider } from "./providers/jira/index.ts";
export { LinearProvider } from "./providers/linear/index.ts";
export { MondayProvider } from "./providers/monday/index.ts";
export { GitHubIssuesProvider } from "./providers/github-issues/index.ts";
export { GitHubProjectsProvider } from "./providers/github-projects/index.ts";
export type { ITicketProvider } from "@journeyman/core";
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/ticket-provider`
Expected: exits 0.

- [ ] **Step 4: Smoke test (optional)**

Requires a real Projects V2 project node ID. Set `GITHUB_ACCESS_TOKEN` and `PROJECT_ID` first.

```bash
GITHUB_ACCESS_TOKEN=<pat> PROJECT_ID=<PVT_...> npx tsx -e "
import('./packages/ticket-provider/src/providers/github-projects/index.ts').then(async ({ GitHubProjectsProvider }) => {
  const p = new GitHubProjectsProvider();
  const schema = await p.getTicketSchema({ ticketId: '', projectId: process.env.PROJECT_ID });
  console.log('schema:', JSON.stringify(schema, null, 2));
  const created = await p.createTicket({ projectId: process.env.PROJECT_ID, title: 'journeyman smoke', description: 'draft created via provider' });
  console.log('created:', JSON.stringify(created, null, 2));
  if (created.ticket) {
    const got = await p.getTicket({ id: created.ticket.id });
    console.log('got:', JSON.stringify(got, null, 2));
  }
});
"
```

Expected: schema listing the project's fields, then a created draft with `id` starting `PVTI_`, then a round-tripped `get` returning the same ticket.

- [ ] **Step 5: Commit**

```bash
git add packages/ticket-provider/src/providers/github-projects/index.ts packages/ticket-provider/src/index.ts
git commit -m "feat(ticket-provider): GitHubProjectsProvider"
```

---

## Task 19: Create `@journeyman/mcp-server` package scaffold

**Files:**
- Create: `packages/mcp-server/package.json`
- Create: `packages/mcp-server/tsconfig.json`
- Create: `packages/mcp-server/README.md`

- [ ] **Step 1: Check existing tsconfig style**

Run: `cat packages/ticket-provider/tsconfig.json`
Copy its structure for consistency.

- [ ] **Step 2: Create `packages/mcp-server/package.json`**

```json
{
  "name": "@journeyman/mcp-server",
  "version": "0.1.0",
  "description": "MCP server exposing journeyman GitHub ticket providers as tools over stdio",
  "type": "module",
  "main": "./src/server.ts",
  "bin": {
    "journeyman-mcp": "./src/cli.ts"
  },
  "exports": {
    ".": "./src/server.ts"
  },
  "files": ["src"],
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@journeyman/core": "*",
    "@journeyman/ticket-provider": "*",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 3: Create `packages/mcp-server/tsconfig.json`**

Copy exactly from `packages/ticket-provider/tsconfig.json`:

```bash
cp packages/ticket-provider/tsconfig.json packages/mcp-server/tsconfig.json
```

- [ ] **Step 4: Create `packages/mcp-server/README.md`**

```markdown
# @journeyman/mcp-server

MCP server exposing journeyman's GitHub ticket providers over stdio.

## Tools

- `gh_issues_{create,update,get,list,schema}_ticket` — GitHub repo issues (REST)
- `gh_projects_{create,update,get,list,schema}_ticket` — GitHub Projects V2 (GraphQL, draft issues)

## Configuration

Set `GITHUB_ACCESS_TOKEN` with scopes `repo`, `project`, `read:project`.

### Claude Desktop / Claude Code / Cursor

```json
{
  "mcpServers": {
    "journeyman": {
      "command": "npx",
      "args": ["-y", "@journeyman/mcp-server"],
      "env": { "GITHUB_ACCESS_TOKEN": "ghp_..." }
    }
  }
}
```
```

- [ ] **Step 5: Install workspace dependencies**

Run: `npm install`
Expected: exit 0. New workspace linked.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-server/package.json packages/mcp-server/tsconfig.json packages/mcp-server/README.md package-lock.json
git commit -m "feat(mcp-server): scaffold @journeyman/mcp-server package"
```

---

## Task 20: MCP server — tool registrations (both adapters)

**Files:**
- Create: `packages/mcp-server/src/tools/github-issues.ts`
- Create: `packages/mcp-server/src/tools/github-projects.ts`

- [ ] **Step 1: Write `packages/mcp-server/src/tools/github-issues.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GitHubIssuesProvider } from "@journeyman/ticket-provider";
import { z } from "zod";

const createSchema = {
  projectId: z.string().describe("'owner/repo'"),
  title: z.string(),
  description: z.string().optional(),
  assignee: z.string().optional().describe("GitHub login"),
  labels: z.array(z.string()).optional(),
  status: z.string().optional().describe("'open' or 'closed' (others mapped to open)"),
};

const updateSchema = {
  id: z.string().describe("'owner/repo#<number>'"),
  title: z.string().optional(),
  description: z.string().optional(),
  assignee: z.string().optional(),
  labels: z.array(z.string()).optional(),
  status: z.string().optional(),
};

const idSchema = { id: z.string().describe("'owner/repo#<number>'") };
const listSchema = {
  projectId: z.string().describe("'owner/repo'"),
  status: z.string().optional(),
  assignee: z.string().optional(),
};
const schemaSchema = {
  ticketId: z.string().default(""),
  projectId: z.string().optional(),
};

async function wrap<T>(fn: () => Promise<T>) {
  try {
    const result = await fn();
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: (err as Error).message }],
    };
  }
}

export function registerGitHubIssuesTools(
  server: McpServer,
  provider: GitHubIssuesProvider,
) {
  server.tool(
    "gh_issues_create_ticket",
    "Create a GitHub repo issue. projectId is 'owner/repo'.",
    createSchema,
    (input) => wrap(() => provider.createTicket(input)),
  );
  server.tool(
    "gh_issues_update_ticket",
    "Update a GitHub repo issue. id is 'owner/repo#<number>'.",
    updateSchema,
    (input) => wrap(() => provider.updateTicket(input)),
  );
  server.tool(
    "gh_issues_get_ticket",
    "Get a GitHub repo issue by id ('owner/repo#<number>').",
    idSchema,
    (input) => wrap(() => provider.getTicket(input)),
  );
  server.tool(
    "gh_issues_list_tickets",
    "List repo issues (PRs filtered out). projectId is 'owner/repo'.",
    listSchema,
    (input) => wrap(() => provider.listTickets(input)),
  );
  server.tool(
    "gh_issues_get_schema",
    "Return the static schema of GitHub issue fields.",
    schemaSchema,
    (input) => wrap(() => provider.getTicketSchema(input)),
  );
}
```

- [ ] **Step 2: Write `packages/mcp-server/src/tools/github-projects.ts`**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GitHubProjectsProvider } from "@journeyman/ticket-provider";
import { z } from "zod";

const createSchema = {
  projectId: z.string().describe("Project V2 node ID, e.g. PVT_kwDO..."),
  title: z.string(),
  description: z.string().optional(),
  assignee: z.string().optional().describe("GitHub login"),
  labels: z.array(z.string()).optional(),
  status: z.string().optional(),
  customFields: z.record(z.string(), z.unknown()).optional()
    .describe("Field name -> value. Names are resolved to IDs via introspection."),
};

const updateSchema = {
  id: z.string().describe("Project item node ID, e.g. PVTI_..."),
  title: z.string().optional(),
  description: z.string().optional(),
  assignee: z.string().optional(),
  labels: z.array(z.string()).optional(),
  status: z.string().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
};

const idSchema = { id: z.string().describe("Project item node ID, e.g. PVTI_...") };
const listSchema = {
  projectId: z.string(),
  status: z.string().optional(),
  assignee: z.string().optional(),
};
const schemaSchema = {
  ticketId: z.string().default(""),
  projectId: z.string().describe("Project V2 node ID"),
};

async function wrap<T>(fn: () => Promise<T>) {
  try {
    const result = await fn();
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: (err as Error).message }],
    };
  }
}

export function registerGitHubProjectsTools(
  server: McpServer,
  provider: GitHubProjectsProvider,
) {
  server.tool(
    "gh_projects_create_ticket",
    "Create a draft issue in a GitHub Project V2. Supports custom fields by name.",
    createSchema,
    (input) => wrap(() => provider.createTicket(input)),
  );
  server.tool(
    "gh_projects_update_ticket",
    "Update a project draft issue (title, body, custom fields).",
    updateSchema,
    (input) => wrap(() => provider.updateTicket(input)),
  );
  server.tool(
    "gh_projects_get_ticket",
    "Get a project item by its node ID.",
    idSchema,
    (input) => wrap(() => provider.getTicket(input)),
  );
  server.tool(
    "gh_projects_list_tickets",
    "List all draft-issue items in a project (first 100).",
    listSchema,
    (input) => wrap(() => provider.listTickets(input)),
  );
  server.tool(
    "gh_projects_get_schema",
    "Return the live field schema for a project (custom fields and allowed values).",
    schemaSchema,
    (input) => wrap(() => provider.getTicketSchema(input)),
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/mcp-server`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add packages/mcp-server/src/tools/github-issues.ts packages/mcp-server/src/tools/github-projects.ts
git commit -m "feat(mcp-server): register GitHub Issues + Projects tools"
```

---

## Task 21: MCP server — `server.ts` and `cli.ts`

**Files:**
- Create: `packages/mcp-server/src/server.ts`
- Create: `packages/mcp-server/src/cli.ts`

- [ ] **Step 1: Write `packages/mcp-server/src/server.ts`**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  GitHubIssuesProvider,
  GitHubProjectsProvider,
} from "@journeyman/ticket-provider";
import { registerGitHubIssuesTools } from "./tools/github-issues.ts";
import { registerGitHubProjectsTools } from "./tools/github-projects.ts";

export type Providers = {
  issues: GitHubIssuesProvider;
  projects: GitHubProjectsProvider;
};

export function buildServer(providers: Providers): McpServer {
  const server = new McpServer({
    name: "journeyman",
    version: "0.1.0",
  });
  registerGitHubIssuesTools(server, providers.issues);
  registerGitHubProjectsTools(server, providers.projects);
  return server;
}
```

- [ ] **Step 2: Write `packages/mcp-server/src/cli.ts`**

```typescript
#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  GitHubIssuesProvider,
  GitHubProjectsProvider,
} from "@journeyman/ticket-provider";
import { buildServer } from "./server.ts";

async function main() {
  if (!process.env.GITHUB_ACCESS_TOKEN) {
    process.stderr.write(
      "journeyman-mcp: GITHUB_ACCESS_TOKEN env var is required\n",
    );
    process.exit(1);
  }

  const server = buildServer({
    issues: new GitHubIssuesProvider(),
    projects: new GitHubProjectsProvider(),
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`journeyman-mcp: fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
```

- [ ] **Step 3: Make `cli.ts` executable**

Run: `chmod +x packages/mcp-server/src/cli.ts`

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/mcp-server`
Expected: exits 0.

- [ ] **Step 5: Smoke test — `tools/list` over stdio**

Run:
```bash
GITHUB_ACCESS_TOKEN=dummy npx tsx packages/mcp-server/src/cli.ts <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
EOF
```

Expected: JSON responses on stdout. The `tools/list` response should contain 10 tools whose names start with `gh_issues_` or `gh_projects_`. Process exits after stdin closes.

If the response lists 10 tools, the server is wired correctly. (No real GitHub call was made — `GITHUB_ACCESS_TOKEN=dummy` is just to satisfy the cli.ts guard.)

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-server/src/server.ts packages/mcp-server/src/cli.ts
git commit -m "feat(mcp-server): buildServer + stdio CLI entrypoint"
```

---

## Task 22: Workspace-wide typecheck + final commit

- [ ] **Step 1: Run the full typecheck across all packages**

Run: `npm run typecheck`
Expected: all workspaces pass, exit 0. If any fail, fix before proceeding.

- [ ] **Step 2: Verify repo state**

Run: `git status`
Expected: clean (all work is committed).

Run: `git log --oneline master..HEAD`
Expected: a readable sequence of commits, one per task above.

---

## Done

At this point:

- `GitHubIssuesProvider` and `GitHubProjectsProvider` are exported from `@journeyman/ticket-provider` and satisfy `ITicketProvider`.
- `@journeyman/mcp-server` is a new workspace package with a runnable stdio server exposing 10 tools.
- `GITHUB_ACCESS_TOKEN` is the single shared env var for all three GitHub providers in the monorepo.
- `CreateTicketOptions` in `@journeyman/core` now carries optional `status` and `customFields`.
- No LLM / Claude Agent SDK dependency added to either new adapter.
- Implementation Status table in `CLAUDE.md` is **not** updated by this plan — leave that for a follow-up PR touching docs, since the table also references other in-flight work and shouldn't be modified during feature work.

Out of scope (tracked in spec §11): pagination, real-issue-in-project mode, HTTP MCP transport, MCP tools for git-provider/coding-cli/notification-provider, OAuth, auto-retry, contract test suite, back-compat shim for the old env var.
