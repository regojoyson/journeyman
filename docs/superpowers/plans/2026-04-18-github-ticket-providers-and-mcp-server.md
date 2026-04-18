# GitHub Ticket Providers — Implementation Plan (revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `GitHubIssuesProvider` and `GitHubProjectsProvider` in `@journeyman/ticket-provider`, both backed by GitHub's hosted MCP server — matching `@journeyman/git-provider`'s existing pattern.

**Revision:** Original plan built direct REST/GraphQL adapters + an in-house `@journeyman/mcp-server` wrapper. Scrapped after discovering github-mcp-server covers this already, and `git-provider` already uses it. Phase 1 commits (env-var rename + core type additions) are kept. New scope is much smaller.

**Architecture:** Both providers connect to `https://api.githubcopilot.com/mcp/` via `StreamableHTTPClientTransport` (same as `git-provider`), call tools deterministically via `Client.callTool()`. No `query()`, no LLM, no token cost per op. A 30-LOC shared MCP-client helper is copy-duplicated into `ticket-provider` (cross-package import would be worse monorepo hygiene).

**Tech Stack:** TypeScript ESM, `@modelcontextprotocol/sdk` client, `StreamableHTTPClientTransport`. No test runner — typecheck is the automated gate.

**Spec:** [docs/superpowers/specs/2026-04-18-github-ticket-providers-and-mcp-server-design.md](../specs/2026-04-18-github-ticket-providers-and-mcp-server-design.md)

---

## Done already (Phase 1)

- Task 1 — Rename `GITHUB_PERSONAL_ACCESS_TOKEN` → `GITHUB_ACCESS_TOKEN` (commit `393b133`)
- Task 2 — Add `status` + `customFields` to `CreateTicketOptions` (commit `fc9cec2`)

---

## Task 3: Add `@modelcontextprotocol/sdk` dep to ticket-provider + create shared MCP client

**Files:**
- Modify: `packages/ticket-provider/package.json` (add dep)
- Create: `packages/ticket-provider/src/providers/_shared/github-mcp-client.ts`

**Reference:** `packages/git-provider/src/providers/github/mcp-client.ts` is the source of truth to copy from.

- [ ] **Step 1: Inspect git-provider's existing client**

Run: `cat packages/git-provider/src/providers/github/mcp-client.ts`
Note the exact dependency usage and pattern. Copy it verbatim; only the `Client` `name` identifier changes.

- [ ] **Step 2: Add dep to ticket-provider/package.json**

Edit `packages/ticket-provider/package.json` so `dependencies` includes `@modelcontextprotocol/sdk`. The existing `git-provider/package.json` already declares it — match the same version spec. Run: `cat packages/git-provider/package.json` to find the exact version (likely `"*"` or similar workspace-style).

- [ ] **Step 3: Create the shared client**

Write `packages/ticket-provider/src/providers/_shared/github-mcp-client.ts`:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { URL } from "node:url";

const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/";

export async function connectGitHubMcp(): Promise<Client> {
  const token = process.env.GITHUB_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "GitHub ticket provider: PAT required. Set GITHUB_ACCESS_TOKEN.",
    );
  }
  const transport = new StreamableHTTPClientTransport(new URL(GITHUB_MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client(
    { name: "journeyman-ticket-provider", version: "0.1.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  return client;
}

export async function callTool<T>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) {
    throw new Error(`MCP tool '${name}' failed: ${JSON.stringify(res.content)}`);
  }
  const content = res.content as Array<{ type: string; text?: string }>;
  const text = content.find((c) => c.type === "text")?.text;
  if (!text) throw new Error(`MCP tool '${name}' returned no text content`);
  return JSON.parse(text) as T;
}
```

This differs from git-provider's copy only in:
- `connectGitHubMcp()` reads the env var itself (no `token` param) — simpler for operations.
- Client identifier is `journeyman-ticket-provider`.

- [ ] **Step 4: Install + typecheck**

```bash
npm install
npm run typecheck --workspace=@journeyman/ticket-provider
```
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/ticket-provider/package.json packages/ticket-provider/src/providers/_shared/github-mcp-client.ts package-lock.json
git commit -m "feat(ticket-provider): shared GitHub MCP client"
```

---

## Task 4: GitHub Issues adapter — operations

**Files:**
- Create: `packages/ticket-provider/src/providers/github-issues/operations/create-ticket.ts`
- Create: `packages/ticket-provider/src/providers/github-issues/operations/update-ticket.ts`
- Create: `packages/ticket-provider/src/providers/github-issues/operations/get-ticket.ts`
- Create: `packages/ticket-provider/src/providers/github-issues/operations/list-tickets.ts`
- Create: `packages/ticket-provider/src/providers/github-issues/operations/get-ticket-schema.ts`
- Create: `packages/ticket-provider/src/providers/github-issues/utils/parse-ids.ts`

**MCP tools used:** `issue_read`, `issue_write`, `list_issues`. Reference github-mcp-server README for exact arg shapes; names and required params per spec §3.

- [ ] **Step 1: Create `parse-ids.ts`**

```typescript
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

- [ ] **Step 2: Create `create-ticket.ts`**

```typescript
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  CreateTicketOptions,
  CreateTicketResult,
  Ticket,
} from "@journeyman/core";
import { callTool } from "../../_shared/github-mcp-client.ts";
import { parseOwnerRepo } from "../utils/parse-ids.ts";

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

export function toTicket(owner: string, repo: string, issue: GitHubIssue): Ticket {
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

function mapStateFromStatus(status: string | undefined): "open" | "closed" | undefined {
  if (!status) return undefined;
  const s = status.toLowerCase();
  return s === "closed" || s === "done" ? "closed" : "open";
}

export async function createTicket(
  client: Client,
  opts: CreateTicketOptions,
): Promise<CreateTicketResult> {
  const { owner, repo } = parseOwnerRepo(opts.projectId);
  const args: Record<string, unknown> = {
    method: "create",
    owner,
    repo,
    title: opts.title,
  };
  if (opts.description) args.body = opts.description;
  if (opts.assignee) args.assignees = [opts.assignee];
  if (opts.labels?.length) args.labels = opts.labels;

  try {
    const issue = await callTool<GitHubIssue>(client, "issue_write", args);
    let ticket = toTicket(owner, repo, issue);

    // status is lossy (open/closed only) — apply via a follow-up update if requested
    const targetState = mapStateFromStatus(opts.status);
    if (targetState && targetState !== issue.state) {
      const updated = await callTool<GitHubIssue>(client, "issue_write", {
        method: "update",
        owner,
        repo,
        issue_number: issue.number,
        state: targetState,
      });
      ticket = toTicket(owner, repo, updated);
    }

    return { ticket };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
```

- [ ] **Step 3: Create `get-ticket.ts`**

```typescript
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { GetTicketOptions, GetTicketResult } from "@journeyman/core";
import { callTool } from "../../_shared/github-mcp-client.ts";
import { parseIssueId } from "../utils/parse-ids.ts";
import { toTicket } from "./create-ticket.ts";

type GitHubIssue = Parameters<typeof toTicket>[2];

export async function getTicket(
  client: Client,
  opts: GetTicketOptions,
): Promise<GetTicketResult> {
  const { owner, repo, number } = parseIssueId(opts.id);
  try {
    const issue = await callTool<GitHubIssue>(client, "issue_read", {
      method: "get",
      owner,
      repo,
      issue_number: number,
    });
    return { ticket: toTicket(owner, repo, issue) };
  } catch (err) {
    return { error: `not found: ${opts.id} (${(err as Error).message})` };
  }
}
```

- [ ] **Step 4: Create `update-ticket.ts`**

```typescript
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { UpdateTicketOptions, UpdateTicketResult } from "@journeyman/core";
import { callTool } from "../../_shared/github-mcp-client.ts";
import { parseIssueId } from "../utils/parse-ids.ts";
import { toTicket } from "./create-ticket.ts";

type GitHubIssue = Parameters<typeof toTicket>[2];

function mapStateFromStatus(status: string | undefined): "open" | "closed" | undefined {
  if (!status) return undefined;
  const s = status.toLowerCase();
  return s === "closed" || s === "done" ? "closed" : "open";
}

export async function updateTicket(
  client: Client,
  opts: UpdateTicketOptions,
): Promise<UpdateTicketResult> {
  const { owner, repo, number } = parseIssueId(opts.id);
  const args: Record<string, unknown> = {
    method: "update",
    owner,
    repo,
    issue_number: number,
  };
  if (opts.title !== undefined) args.title = opts.title;
  if (opts.description !== undefined) args.body = opts.description;
  if (opts.assignee !== undefined) args.assignees = [opts.assignee];
  if (opts.labels !== undefined) args.labels = opts.labels;
  const state = mapStateFromStatus(opts.status);
  if (state !== undefined) args.state = state;

  // only title/issue_number are guaranteed; check that at least one update field is present
  const updateFieldKeys = ["title", "body", "assignees", "labels", "state"];
  if (!updateFieldKeys.some((k) => k in args)) {
    return { error: "updateTicket: no fields to update" };
  }

  try {
    const issue = await callTool<GitHubIssue>(client, "issue_write", args);
    return { ticket: toTicket(owner, repo, issue) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
```

- [ ] **Step 5: Create `list-tickets.ts`**

```typescript
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ListTicketsOptions, ListTicketsResult } from "@journeyman/core";
import { callTool } from "../../_shared/github-mcp-client.ts";
import { parseOwnerRepo } from "../utils/parse-ids.ts";
import { toTicket } from "./create-ticket.ts";

type GitHubIssue = Parameters<typeof toTicket>[2];

export async function listTickets(
  client: Client,
  opts: ListTicketsOptions,
): Promise<ListTicketsResult> {
  const { owner, repo } = parseOwnerRepo(opts.projectId);
  const args: Record<string, unknown> = { owner, repo, perPage: 100 };
  const state = opts.status?.toLowerCase();
  if (state === "open" || state === "closed") args.state = state;

  try {
    const issues = await callTool<GitHubIssue[]>(client, "list_issues", args);
    const tickets = issues
      .filter((i) => (i as { pull_request?: unknown }).pull_request == null)
      .filter((i) => !opts.assignee || i.assignees.some((a) => a.login === opts.assignee))
      .map((i) => toTicket(owner, repo, i));
    return { tickets };
  } catch (err) {
    return { tickets: [], error: (err as Error).message };
  }
}
```

- [ ] **Step 6: Create `get-ticket-schema.ts`**

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

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/ticket-provider`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/ticket-provider/src/providers/github-issues
git commit -m "feat(ticket-provider): github-issues operations via github-mcp-server"
```

---

## Task 5: GitHub Issues adapter — provider class + package export

**Files:**
- Create: `packages/ticket-provider/src/providers/github-issues/index.ts`
- Modify: `packages/ticket-provider/src/index.ts`

- [ ] **Step 1: Write the provider class**

`packages/ticket-provider/src/providers/github-issues/index.ts`:

```typescript
import type { ITicketProvider } from "@journeyman/core";
import type {
  CreateTicketOptions, CreateTicketResult,
  UpdateTicketOptions, UpdateTicketResult,
  GetTicketOptions, GetTicketResult,
  ListTicketsOptions, ListTicketsResult,
  GetTicketSchemaOptions, GetTicketSchemaResult,
} from "@journeyman/core";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { connectGitHubMcp } from "../_shared/github-mcp-client.ts";
import { createTicket } from "./operations/create-ticket.ts";
import { updateTicket } from "./operations/update-ticket.ts";
import { getTicket } from "./operations/get-ticket.ts";
import { listTickets } from "./operations/list-tickets.ts";
import { getTicketSchema } from "./operations/get-ticket-schema.ts";

/**
 * GitHub repo-level issue tracker provider.
 *
 * Backed by GitHub's hosted MCP server (https://api.githubcopilot.com/mcp/).
 * Deterministic — no LLM in the loop. Requires `GITHUB_ACCESS_TOKEN` env var
 * with `repo` scope.
 *
 * - `opts.projectId` for create/list is `"owner/repo"`.
 * - `opts.id` for get/update is `"owner/repo#<number>"`.
 * - `status` maps to GitHub's binary `open`/`closed` (lossy).
 * - `priority`, `issueType`, `customFields` have no GitHub equivalent — ignored.
 */
export class GitHubIssuesProvider implements ITicketProvider {
  private client?: Client;

  async createTicket(opts: CreateTicketOptions): Promise<CreateTicketResult> {
    return createTicket(await this.getClient(), opts);
  }
  async updateTicket(opts: UpdateTicketOptions): Promise<UpdateTicketResult> {
    return updateTicket(await this.getClient(), opts);
  }
  async getTicket(opts: GetTicketOptions): Promise<GetTicketResult> {
    return getTicket(await this.getClient(), opts);
  }
  async listTickets(opts: ListTicketsOptions): Promise<ListTicketsResult> {
    return listTickets(await this.getClient(), opts);
  }
  async getTicketSchema(opts: GetTicketSchemaOptions): Promise<GetTicketSchemaResult> {
    return getTicketSchema(opts);
  }

  private async getClient(): Promise<Client> {
    if (!this.client) this.client = await connectGitHubMcp();
    return this.client;
  }
}
```

- [ ] **Step 2: Add export to `packages/ticket-provider/src/index.ts`**

Final file contents:

```typescript
export { JiraProvider } from "./providers/jira/index.ts";
export { LinearProvider } from "./providers/linear/index.ts";
export { MondayProvider } from "./providers/monday/index.ts";
export { GitHubIssuesProvider } from "./providers/github-issues/index.ts";
export type { ITicketProvider } from "@journeyman/core";
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/ticket-provider`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/ticket-provider/src/providers/github-issues/index.ts packages/ticket-provider/src/index.ts
git commit -m "feat(ticket-provider): GitHubIssuesProvider"
```

---

## Task 6: GitHub Projects adapter — pre-implementation tool discovery

**Why a discovery task:** The `projects_get` / `projects_list` / `projects_write` tools are umbrella-style (dispatch on a `method` param). The exact sub-method names and their required/optional arguments are **not fully documented** in github-mcp-server's README. Before writing the operations, enumerate them.

**Files:** None created in this task — it's a research task producing notes that inform Task 7.

- [ ] **Step 1: Write a one-shot discovery script**

Create a temporary file `scratch/discover-projects-tools.ts`:

```typescript
import { connectGitHubMcp } from "../packages/ticket-provider/src/providers/_shared/github-mcp-client.ts";

async function main() {
  const client = await connectGitHubMcp();
  const tools = await client.listTools();
  for (const t of tools.tools) {
    if (!t.name.startsWith("projects_")) continue;
    console.log("\n=== " + t.name + " ===");
    console.log(t.description);
    console.log(JSON.stringify(t.inputSchema, null, 2));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it**

Requires a real `GITHUB_ACCESS_TOKEN` with `project` + `read:project` scopes.

```bash
GITHUB_ACCESS_TOKEN=<pat> npx tsx scratch/discover-projects-tools.ts
```

Capture the output. Record in a new file `docs/superpowers/plans/github-projects-tool-schemas.md`:
- For each of `projects_get`, `projects_list`, `projects_write`: the full input JSON schema including the `method` enum values and which additional params each sub-method requires.

- [ ] **Step 3: Commit discovery artifacts**

```bash
git add docs/superpowers/plans/github-projects-tool-schemas.md
git commit -m "docs: capture github-mcp-server projects_* tool schemas"
```

Then delete the scratch file:
```bash
rm -rf scratch/
```

- [ ] **Step 4: Update Task 7 below**

Using the captured schemas, the implementer fills in the exact `method` strings and arg shapes used in Task 7's operation stubs. If the captured sub-method surface differs significantly from what Task 7 assumes, the implementer should STOP and escalate so the plan can be adjusted before writing code.

---

## Task 7: GitHub Projects adapter — operations

**Files:**
- Create: `packages/ticket-provider/src/providers/github-projects/operations/create-ticket.ts`
- Create: `packages/ticket-provider/src/providers/github-projects/operations/update-ticket.ts`
- Create: `packages/ticket-provider/src/providers/github-projects/operations/get-ticket.ts`
- Create: `packages/ticket-provider/src/providers/github-projects/operations/list-tickets.ts`
- Create: `packages/ticket-provider/src/providers/github-projects/operations/get-ticket-schema.ts`
- Create: `packages/ticket-provider/src/providers/github-projects/utils/parse-project-id.ts`

**Approach:** All 5 operations take a `Client` and call `projects_get` / `projects_list` / `projects_write` with a `method` sub-dispatch. Exact sub-method strings come from Task 6's discovery.

**Projectid contract:** `opts.projectId = "owner/project_number"`. Parsed to `{ owner, project_number }`.

- [ ] **Step 1: Create `parse-project-id.ts`**

```typescript
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
```

- [ ] **Step 2: Create `create-ticket.ts`** (draft-issue creation)

Using the `projects_write` sub-method for "add draft item" captured in Task 6 (commonly `method: "add_draft_item"` or `"create_item"` with `item_type: "draft"`; the implementer substitutes the actual name from the schema):

```typescript
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  CreateTicketOptions,
  CreateTicketResult,
  Ticket,
} from "@journeyman/core";
import { callTool } from "../../_shared/github-mcp-client.ts";
import { parseProjectId } from "../utils/parse-project-id.ts";

// TOOL-SPECIFIC: sub-method names below are placeholders — the implementer
// replaces them with the exact strings captured in Task 6's discovery notes.
// If discovery reveals a materially different shape (e.g. no draft support),
// STOP and escalate.
const CREATE_DRAFT_METHOD = "add_draft_item";

type ProjectItemPayload = {
  id: string;
  content?: { title: string; body: string | null };
  title?: string;
  body?: string | null;
};

export async function createTicket(
  client: Client,
  opts: CreateTicketOptions,
): Promise<CreateTicketResult> {
  const { owner, project_number } = parseProjectId(opts.projectId);
  const args: Record<string, unknown> = {
    method: CREATE_DRAFT_METHOD,
    owner,
    project_number,
    body: opts.description ?? "",
  };
  // title passes via body's leading line OR a dedicated `title` param depending
  // on the tool schema — the implementer sets the correct field per discovery.
  args.title = opts.title;

  if (opts.status) args.status = opts.status;
  if (opts.customFields) {
    Object.assign(args, opts.customFields);
  }

  try {
    const item = await callTool<ProjectItemPayload>(client, "projects_write", args);
    const ticket: Ticket = {
      id: String(item.id),
      title: item.content?.title ?? item.title ?? opts.title,
      description: item.content?.body ?? item.body ?? opts.description,
    };
    return { ticket };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
```

- [ ] **Step 3: Create `get-ticket.ts`**

```typescript
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { GetTicketOptions, GetTicketResult, Ticket } from "@journeyman/core";
import { callTool } from "../../_shared/github-mcp-client.ts";

// Replace with the discovered sub-method name.
const GET_ITEM_METHOD = "get_item";

type ProjectItem = {
  id: string;
  content?: {
    title: string;
    body: string | null;
    assignees?: { login: string }[];
  };
  fields?: Record<string, unknown>;
};

export async function getTicket(
  client: Client,
  opts: GetTicketOptions,
): Promise<GetTicketResult> {
  // GetTicketOptions only has `id` — the MCP tool needs owner+project_number.
  // The caller therefore encodes the id as "owner/project_number#item_id".
  const match = /^([^/]+)\/(\d+)#(.+)$/.exec(opts.id);
  if (!match) {
    return { error: `GitHubProjectsProvider: id must be "owner/<project_number>#<item_id>", got ${opts.id}` };
  }
  const [, owner, numStr, itemId] = match;
  try {
    const item = await callTool<ProjectItem>(client, "projects_get", {
      method: GET_ITEM_METHOD,
      owner,
      project_number: Number(numStr),
      item_id: itemId,
    });
    const ticket: Ticket = {
      id: opts.id,
      title: item.content?.title ?? "",
      description: item.content?.body ?? undefined,
      assignee: item.content?.assignees?.[0]?.login,
      customFields: item.fields,
    };
    return { ticket };
  } catch (err) {
    return { error: `not found: ${opts.id} (${(err as Error).message})` };
  }
}
```

- [ ] **Step 4: Create `update-ticket.ts`**

```typescript
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { UpdateTicketOptions, UpdateTicketResult } from "@journeyman/core";
import { callTool } from "../../_shared/github-mcp-client.ts";
import { getTicket } from "./get-ticket.ts";

// Replace with the discovered sub-method name.
const UPDATE_FIELD_METHOD = "update_item_field";

export async function updateTicket(
  client: Client,
  opts: UpdateTicketOptions,
): Promise<UpdateTicketResult> {
  const match = /^([^/]+)\/(\d+)#(.+)$/.exec(opts.id);
  if (!match) {
    return { error: `GitHubProjectsProvider: id must be "owner/<project_number>#<item_id>", got ${opts.id}` };
  }
  const [, owner, numStr, itemId] = match;
  const project_number = Number(numStr);

  const updates: Array<Record<string, unknown>> = [];
  if (opts.title !== undefined) updates.push({ updated_field: "title", value: opts.title });
  if (opts.description !== undefined) updates.push({ updated_field: "body", value: opts.description });
  if (opts.status !== undefined) updates.push({ updated_field: "Status", value: opts.status });
  if (opts.customFields) {
    for (const [k, v] of Object.entries(opts.customFields)) {
      updates.push({ updated_field: k, value: v });
    }
  }

  if (updates.length === 0) return { error: "updateTicket: no fields to update" };

  try {
    for (const u of updates) {
      await callTool(client, "projects_write", {
        method: UPDATE_FIELD_METHOD,
        owner,
        project_number,
        item_id: itemId,
        ...u,
      });
    }
    return getTicket(client, { id: opts.id });
  } catch (err) {
    return { error: (err as Error).message };
  }
}
```

- [ ] **Step 5: Create `list-tickets.ts`**

```typescript
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ListTicketsOptions, ListTicketsResult, Ticket } from "@journeyman/core";
import { callTool } from "../../_shared/github-mcp-client.ts";
import { parseProjectId } from "../utils/parse-project-id.ts";

// Replace with the discovered sub-method name.
const LIST_ITEMS_METHOD = "list_items";

type ProjectItem = {
  id: string;
  content?: {
    title: string;
    body: string | null;
    assignees?: { login: string }[];
  };
  fields?: Record<string, unknown>;
};

export async function listTickets(
  client: Client,
  opts: ListTicketsOptions,
): Promise<ListTicketsResult> {
  const { owner, project_number } = parseProjectId(opts.projectId);
  try {
    const items = await callTool<ProjectItem[]>(client, "projects_list", {
      method: LIST_ITEMS_METHOD,
      owner,
      project_number,
      per_page: 100,
    });
    const tickets: Ticket[] = items
      .filter((it) => !!it.content) // skip non-draft items for v1
      .map((it) => ({
        id: `${owner}/${project_number}#${it.id}`,
        title: it.content!.title,
        description: it.content!.body ?? undefined,
        assignee: it.content!.assignees?.[0]?.login,
        status: typeof it.fields?.Status === "string" ? it.fields.Status : undefined,
        customFields: it.fields,
      }))
      .filter((t) => !opts.status || t.status === opts.status)
      .filter((t) => !opts.assignee || t.assignee === opts.assignee);
    return { tickets };
  } catch (err) {
    return { tickets: [], error: (err as Error).message };
  }
}
```

- [ ] **Step 6: Create `get-ticket-schema.ts`**

```typescript
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  GetTicketSchemaOptions,
  GetTicketSchemaResult,
  TicketField,
} from "@journeyman/core";
import { callTool } from "../../_shared/github-mcp-client.ts";
import { parseProjectId } from "../utils/parse-project-id.ts";

// Replace with the discovered sub-method name.
const LIST_FIELDS_METHOD = "list_fields";

type ProjectFieldPayload = {
  id: string;
  name: string;
  dataType?: string;
  options?: { id: string; name: string }[];
};

export async function getTicketSchema(
  client: Client,
  opts: GetTicketSchemaOptions,
): Promise<GetTicketSchemaResult> {
  if (!opts.projectId) {
    return { fields: [], error: "projectId (owner/<project_number>) required" };
  }
  const { owner, project_number } = parseProjectId(opts.projectId);
  try {
    const fields = await callTool<ProjectFieldPayload[]>(client, "projects_get", {
      method: LIST_FIELDS_METHOD,
      owner,
      project_number,
    });
    const mapped: TicketField[] = fields.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.dataType?.toLowerCase(),
      allowedValues: f.options?.map((o) => o.name),
    }));
    return { fields: mapped };
  } catch (err) {
    return { fields: [], error: (err as Error).message };
  }
}
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck --workspace=@journeyman/ticket-provider`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/ticket-provider/src/providers/github-projects
git commit -m "feat(ticket-provider): github-projects operations via github-mcp-server"
```

---

## Task 8: GitHub Projects adapter — provider class + package export

**Files:**
- Create: `packages/ticket-provider/src/providers/github-projects/index.ts`
- Modify: `packages/ticket-provider/src/index.ts`

- [ ] **Step 1: Write the provider class**

```typescript
import type { ITicketProvider } from "@journeyman/core";
import type {
  CreateTicketOptions, CreateTicketResult,
  UpdateTicketOptions, UpdateTicketResult,
  GetTicketOptions, GetTicketResult,
  ListTicketsOptions, ListTicketsResult,
  GetTicketSchemaOptions, GetTicketSchemaResult,
} from "@journeyman/core";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { connectGitHubMcp } from "../_shared/github-mcp-client.ts";
import { createTicket } from "./operations/create-ticket.ts";
import { updateTicket } from "./operations/update-ticket.ts";
import { getTicket } from "./operations/get-ticket.ts";
import { listTickets } from "./operations/list-tickets.ts";
import { getTicketSchema } from "./operations/get-ticket-schema.ts";

/**
 * GitHub Projects V2 provider (draft issues).
 *
 * Backed by GitHub's hosted MCP server (https://api.githubcopilot.com/mcp/).
 * Deterministic — no LLM in the loop. Requires `GITHUB_ACCESS_TOKEN` env var
 * with `project` + `read:project` scopes.
 *
 * - `opts.projectId` is `"owner/<project_number>"` (e.g. `"anthropics/42"`).
 * - `opts.id` for get/update is `"owner/<project_number>#<item_id>"`.
 * - Creates draft items only. Real issues added to a project are visible on
 *   read but not created through this provider (use `GitHubIssuesProvider`).
 * - `opts.status` maps to the project's Status field.
 * - `opts.customFields` keys are pass-through to `projects_write.updated_field`.
 * - `opts.labels` has no direct Projects V2 equivalent — surfaced via custom
 *   fields only if the project defines a field named "Labels".
 */
export class GitHubProjectsProvider implements ITicketProvider {
  private client?: Client;

  async createTicket(opts: CreateTicketOptions): Promise<CreateTicketResult> {
    return createTicket(await this.getClient(), opts);
  }
  async updateTicket(opts: UpdateTicketOptions): Promise<UpdateTicketResult> {
    return updateTicket(await this.getClient(), opts);
  }
  async getTicket(opts: GetTicketOptions): Promise<GetTicketResult> {
    return getTicket(await this.getClient(), opts);
  }
  async listTickets(opts: ListTicketsOptions): Promise<ListTicketsResult> {
    return listTickets(await this.getClient(), opts);
  }
  async getTicketSchema(opts: GetTicketSchemaOptions): Promise<GetTicketSchemaResult> {
    return getTicketSchema(await this.getClient(), opts);
  }

  private async getClient(): Promise<Client> {
    if (!this.client) this.client = await connectGitHubMcp();
    return this.client;
  }
}
```

- [ ] **Step 2: Add export to `packages/ticket-provider/src/index.ts`**

Final file:

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
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/ticket-provider/src/providers/github-projects/index.ts packages/ticket-provider/src/index.ts
git commit -m "feat(ticket-provider): GitHubProjectsProvider"
```

---

## Task 9: Workspace-wide typecheck + sanity check

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: all workspaces pass, exit 0. Fix any cross-package type drift if surfaced.

- [ ] **Step 2: Verify repo state**

Run: `git status`
Expected: clean (all work committed).

Run: `git log --oneline master..HEAD`
Expected: readable sequence of commits, roughly one per task.

---

## Done

- `GitHubIssuesProvider` and `GitHubProjectsProvider` exported from `@journeyman/ticket-provider`, implementing `ITicketProvider`.
- Both backed by GitHub's hosted MCP server — no LLM, deterministic, free.
- `GITHUB_ACCESS_TOKEN` is the single shared PAT across `git-provider` and `ticket-provider`.
- No in-house MCP server shipped — end users install `github/github-mcp-server` directly.

## Explicit YAGNI

See spec §9 — pagination, in-house MCP server, OAuth, retries, real-issue-in-project mode, contract tests, back-compat env var shim.
