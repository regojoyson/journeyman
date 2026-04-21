# Provider Configuration Reference

All providers are configured via the `providerConfig` block inside a product in `pipeline.yaml`. Each category (`coding`, `git`, `ticket`, `notification`) maps to one registered provider. The `providers` block in a flow YAML selects which provider ID to use; `providerConfig` supplies that provider's options.

```yaml
# flow YAML — selects which provider
providers:
  coding: opencode
  git: github
  ticket: jira
  notification: slack

# pipeline.yaml — product block — supplies provider options
providerConfig:
  coding:
    mode: managed
    model:
      providerID: anthropic
      modelID: claude-sonnet-4-6
  git:
    tokenEnv: GITHUB_ACCESS_TOKEN
  ticket: {}    # Jira reads from env vars directly
  notification: {}
```

---

## Coding CLI Providers

Coding providers implement git operations (clone, checkout, scan, commit/push, cleanup, workspace) and AI operations (analyze, plan, implement).

### `claude` — ClaudeProvider

**Package:** `@journeyman/coding-cli`  
**Status:** Fully implemented

Runs Claude as an in-process agent via `@anthropic-ai/claude-agent-sdk`. No `providerConfig` fields are required — the SDK reads credentials from the environment.

```yaml
providers:
  coding: claude

providerConfig:
  coding: {}   # no options needed
```

**Environment variables:**

| Variable | Purpose | Required |
|----------|---------|----------|
| `ANTHROPIC_API_KEY` | Anthropic API key | Only in server/Docker/CI environments where `claude login` has not been run |

**Notes:**
- In local development, `claude login` stores credentials — no env var needed.
- In CI/Docker/server, set `ANTHROPIC_API_KEY`.
- Model is fixed to whichever Claude model the SDK targets by default.

---

### `opencode` — OpenCodeProvider

**Package:** `@journeyman/coding-cli`  
**Status:** Planned (see [design spec](superpowers/specs/2026-04-20-opencode-provider-design.md))

Runs operations via the [OpenCode SDK](https://opencode.ai/docs/sdk/). Model-agnostic — supports Anthropic, OpenAI, Google, and local models. Supports MCP server injection.

Two daemon modes:

#### Mode: `managed` — SDK starts OpenCode for you

OpenCode is spawned as a child process and lives for the lifetime of the Node.js parent process. No manual startup required.

```yaml
providerConfig:
  coding:
    mode: managed
    model:
      providerID: anthropic          # anthropic | openai | google | ollama | ...
      modelID: claude-sonnet-4-6     # any model ID the provider supports

    # Optional: override default permissions (all "allow" by default)
    permission:
      bash: allow                    # allow | ask | deny
      edit: allow
      webfetch: allow

    # Optional: toggle individual tools
    tools:
      bash: true
      webfetch: false

    # Optional: attach MCP servers
    mcp:
      github:
        type: local
        command: ["npx", "@modelcontextprotocol/server-github"]
        environment:
          GITHUB_TOKEN: "${GITHUB_ACCESS_TOKEN}"
      remote-service:
        type: remote
        url: https://my-mcp-server.example.com
        headers:
          Authorization: "Bearer ${MCP_TOKEN}"

    # Optional: daemon listen address (defaults: 127.0.0.1:4096)
    hostname: 127.0.0.1
    port: 4096
    timeout: 5000                    # ms to wait for daemon startup
```

#### Mode: `external` — connect to already-running OpenCode daemon

Expects OpenCode to already be running (e.g. started manually with `opencode` in a terminal). The SDK connects to it via HTTP.

```yaml
providerConfig:
  coding:
    mode: external
    model:
      providerID: openai
      modelID: gpt-4o
    baseUrl: http://localhost:4096   # optional, this is the default
```

**`providerConfig.coding` fields:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `mode` | `"managed"` \| `"external"` | Yes | — | How the OpenCode daemon is started |
| `model.providerID` | string | Yes | — | AI provider: `anthropic`, `openai`, `google`, `ollama`, etc. |
| `model.modelID` | string | Yes | — | Model identifier within the provider |
| `permission.bash` | `"allow"` \| `"ask"` \| `"deny"` | No | `"allow"` | Bash tool permission |
| `permission.edit` | `"allow"` \| `"ask"` \| `"deny"` | No | `"allow"` | File edit permission |
| `permission.webfetch` | `"allow"` \| `"ask"` \| `"deny"` | No | `"allow"` | Web fetch permission |
| `tools` | `Record<string, boolean>` | No | all enabled | Per-tool on/off toggles |
| `mcp` | object | No | — | MCP server definitions (see below) |
| `baseUrl` | string | No | `http://localhost:4096` | `external` mode only: daemon URL |
| `hostname` | string | No | `127.0.0.1` | `managed` mode only: daemon bind address |
| `port` | number | No | `4096` | `managed` mode only: daemon port |
| `timeout` | number | No | `5000` | `managed` mode only: startup timeout (ms) |

**MCP server definition fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"local"` \| `"remote"` | Yes | Local process or remote HTTP |
| `command` | string[] | Yes (local) | Command to start the MCP server process |
| `environment` | `Record<string, string>` | No | Env vars for the MCP server process |
| `url` | string | Yes (remote) | Remote MCP server URL |
| `headers` | `Record<string, string>` | No | HTTP headers for remote server |
| `enabled` | boolean | No | Set `false` to disable without removing |
| `timeout` | number | No | Connection timeout (ms) |

**Environment variables:**

| Variable | Purpose | Required |
|----------|---------|----------|
| `ANTHROPIC_API_KEY` | If `providerID: anthropic` | Yes for Anthropic models |
| `OPENAI_API_KEY` | If `providerID: openai` | Yes for OpenAI models |
| `GEMINI_API_KEY` | If `providerID: google` | Yes for Google models |

---

### `gemini` — GeminiProvider

**Package:** `@journeyman/coding-cli`  
**Status:** Stub — throws `not implemented` on all methods

```yaml
providers:
  coding: gemini
providerConfig:
  coding: {}
```

---

### `codex` — CodexProvider

**Package:** `@journeyman/coding-cli`  
**Status:** Stub — throws `not implemented` on all methods

```yaml
providers:
  coding: codex
providerConfig:
  coding: {}
```

---

## Git Providers

Git providers handle repository operations via remote REST APIs (clone URLs, get repo metadata, create/list PRs).

### `github` — GitHubProvider

**Package:** `@journeyman/git-provider`  
**Status:** Fully implemented (REST + GraphQL via `@journeyman/github-api` Octokit client)

```yaml
providers:
  git: github

providerConfig:
  git:
    # Option 1: explicit token
    token: "ghp_xxxxxxxxxxxx"

    # Option 2: env var name to read token from
    tokenEnv: MY_PRODUCT_GITHUB_TOKEN

    # Option 3: omit both — falls back to GITHUB_ACCESS_TOKEN env var
```

**`providerConfig.git` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | No | GitHub PAT (takes precedence over `tokenEnv`) |
| `tokenEnv` | string | No | Name of an env var containing the PAT |

Token resolution order: `token` → `process.env[tokenEnv]` → `process.env.GITHUB_ACCESS_TOKEN`. Throws at construction time if none resolve.

**Environment variables:**

| Variable | Purpose | Required |
|----------|---------|----------|
| `GITHUB_ACCESS_TOKEN` | GitHub PAT fallback | Yes, unless `token` or `tokenEnv` is set |

**Required PAT scopes:** `repo`, `read:org`

---

### `gitlab` — GitLabProvider

**Package:** `@journeyman/git-provider`  
**Status:** Stub — throws `not implemented` on all methods

```yaml
providers:
  git: gitlab
providerConfig:
  git: {}
```

---

## Ticket Providers

Ticket providers handle issue tracker operations: get/create/update tickets, list tickets, add comments, update status.

### `jira` — JiraProvider

**Package:** `@journeyman/ticket-provider`  
**Status:** Partially implemented (getTicket, listTickets, createTicket, updateTicket, getTicketSchema)

Uses the Claude Agent SDK with the [Atlassian MCP server](https://mcp.atlassian.com) — no direct Jira REST calls. No `providerConfig` fields; credentials come entirely from environment variables.

```yaml
providers:
  ticket: jira

providerConfig:
  ticket: {}   # no options — reads from env vars
```

**Environment variables:**

| Variable | Purpose | Required |
|----------|---------|----------|
| `ATLASSIAN_API_TOKEN` | Atlassian Cloud API token | Yes |
| `ANTHROPIC_API_KEY` | Claude Agent SDK (runs the MCP agent loop) | Yes in server/CI |

Generate an Atlassian API token at: `https://id.atlassian.com/manage-profile/security/api-tokens`

---

### `github-issues` — GitHubIssuesProvider

**Package:** `@journeyman/ticket-provider`  
**Status:** Fully implemented (REST via `@journeyman/github-api`)

Treats GitHub repository issues as tickets. Suitable for GitHub-native workflows.

```yaml
providers:
  ticket: github-issues

providerConfig:
  ticket:
    tokenEnv: GITHUB_ACCESS_TOKEN   # or use token: directly
```

**`providerConfig.ticket` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | No | GitHub PAT (takes precedence over `tokenEnv`) |
| `tokenEnv` | string | No | Name of an env var containing the PAT |

Token resolution order: `token` → `process.env[tokenEnv]` → `process.env.GITHUB_ACCESS_TOKEN`.

**Notes:**
- `opts.projectId` for create/list is `"owner/repo"` (e.g. `"cadmium-eng/edge-registry"`).
- `opts.id` for get/update is `"owner/repo#<issue_number>"` (e.g. `"cadmium-eng/edge-registry#42"`).
- Status maps to GitHub's binary open/closed — intermediate statuses are lossy.
- `priority`, `issueType`, `customFields` have no GitHub equivalent and are ignored on write.

---

### `github-projects` — GitHubProjectsProvider

**Package:** `@journeyman/ticket-provider`  
**Status:** Fully implemented (GraphQL ProjectV2 via `@journeyman/github-api`)

Treats GitHub Projects V2 items as tickets. Suitable for project-board workflows.

```yaml
providers:
  ticket: github-projects

providerConfig:
  ticket:
    tokenEnv: GITHUB_ACCESS_TOKEN
```

**`providerConfig.ticket` fields:** Same as `github-issues` above.

**Notes:**
- `opts.projectId` is `"owner/<project_number>"` (e.g. `"cadmium-eng/42"`).
- `opts.id` for get/update is `"owner/<project_number>#<item_node_id>"` where `<item_node_id>` is the Projects V2 global node ID (e.g. `PVTI_...`).
- Creates draft items only. Real issues added to a project are readable but not creatable through this provider.
- `opts.status` maps to the project's Status single-select field.
- `opts.customFields` keys are matched by field name (case-insensitive).

**Required PAT scopes:** `project`, `read:project`

---

### `linear` — LinearProvider

**Package:** `@journeyman/ticket-provider`  
**Status:** Stub — throws `not implemented` on all methods

```yaml
providers:
  ticket: linear
providerConfig:
  ticket: {}
```

---

### `monday` — MondayProvider

**Package:** `@journeyman/ticket-provider`  
**Status:** Stub — throws `not implemented` on all methods

```yaml
providers:
  ticket: monday
providerConfig:
  ticket: {}
```

---

## Notification Providers

Notification providers deliver messages to external channels after pipeline events.

### `slack` — SlackProvider

**Package:** `@journeyman/notification-provider`  
**Status:** Stub — throws `not implemented` on `send`

```yaml
providers:
  notification: slack
providerConfig:
  notification: {}
```

---

### `console` — ConsoleProvider

**Package:** `@journeyman/notification-provider`  
**Status:** Implemented — logs via application logger (Pino); no external calls

```yaml
providers:
  notification: console
providerConfig:
  notification: {}
```

Writes one `info`-level log entry per notification containing `channel`, `title`, `message`, and `sessionId`. In development (`NODE_ENV != production`) output is pretty-printed via `pino-pretty`; in production it is structured JSON. Intended for local dev and CI environments where a real Slack workspace is unavailable.

**Returns:** `{ success: true, messageId: "<epoch ms>", sessionId }`

**Failure modes:** never fails; no external calls.

---

## Complete `providerConfig` Examples

### Claude + GitHub + Jira + Slack

```yaml
providerConfig:
  coding: {}                         # ClaudeProvider — reads ANTHROPIC_API_KEY
  git:
    tokenEnv: GITHUB_ACCESS_TOKEN    # GitHubProvider
  ticket: {}                         # JiraProvider — reads ATLASSIAN_API_TOKEN
  notification: {}                   # SlackProvider (stub)
```

### OpenCode (managed, OpenAI) + GitHub + GitHub Issues

```yaml
providerConfig:
  coding:
    mode: managed
    model:
      providerID: openai
      modelID: gpt-4o
    mcp:
      github:
        type: local
        command: ["npx", "@modelcontextprotocol/server-github"]
        environment:
          GITHUB_TOKEN: "${GITHUB_ACCESS_TOKEN}"
  git:
    tokenEnv: GITHUB_ACCESS_TOKEN
  ticket:
    tokenEnv: GITHUB_ACCESS_TOKEN
  notification: {}
```

### OpenCode (external daemon) + GitHub + Jira

```yaml
providerConfig:
  coding:
    mode: external
    baseUrl: http://localhost:4096
    model:
      providerID: anthropic
      modelID: claude-opus-4-7
  git:
    token: "${GITHUB_ACCESS_TOKEN}"
  ticket: {}
  notification: {}
```

---

## Provider Implementation Status

| ID | Category | Status | Config |
|----|----------|--------|--------|
| `claude` | coding-cli | Implemented | No config — env `ANTHROPIC_API_KEY` |
| `opencode` | coding-cli | Planned | `mode`, `model`, `mcp`, `tools`, `permission` |
| `gemini` | coding-cli | Stub | — |
| `codex` | coding-cli | Stub | — |
| `github` | git | Implemented | `token` / `tokenEnv` / env `GITHUB_ACCESS_TOKEN` |
| `gitlab` | git | Stub | — |
| `jira` | ticket | Partial | No config — env `ATLASSIAN_API_TOKEN` |
| `github-issues` | ticket | Implemented | `token` / `tokenEnv` / env `GITHUB_ACCESS_TOKEN` |
| `github-projects` | ticket | Implemented | `token` / `tokenEnv` / env `GITHUB_ACCESS_TOKEN` |
| `linear` | ticket | Stub | — |
| `monday` | ticket | Stub | — |
| `slack` | notification | Stub | — |
| `console` | notification | Implemented | — |
