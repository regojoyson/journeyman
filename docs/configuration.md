# Pipeline Configuration Reference

This document describes the complete structure and schema of Journeyman pipeline configuration.

## File Layout

Pipeline configuration is split into two YAML files:

```
config/
├── pipeline.yaml          # Top-level: products, server, workspaces, defaultFlow
└── flows/
    ├── default.yaml       # Flow definition
    ├── feature-flow.yaml  # Another flow
    └── ...
```

The `config/pipeline.yaml` file is the entry point. Flow definitions are loaded from `config/flows/*.yaml` and referenced by name in products and `defaultFlow`.

## Top-Level Fields (pipeline.yaml)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `defaultFlow` | string | Yes | Name of the flow to use when a trigger doesn't specify one. Must match a defined flow. |
| `products` | object | Yes | Map of product IDs to product configurations. |
| `server` | object | Yes | HTTP server settings: port, bearer token, webhook paths and secrets. |
| `workspaces` | object | No | Cleanup and retention policy for pipeline runs. |

### defaultFlow

Specifies which flow definition to use when a webhook trigger does not explicitly request a flow.

```yaml
defaultFlow: "default-feature-flow"
```

Must reference a flow name that exists in `config/flows/*.yaml`.

### products

Defines products and their configurations. Each product key becomes a `productId` (e.g. `edgereg`, `cidms`).

```yaml
products:
  edgereg:
    flow: default-feature-flow
    workspace: edgereg-workspace
    repos:
      - providerId: github
        owner: cadmium-eng
        repo: edge-registry
        url: https://github.com/cadmium-eng/edge-registry
        defaultBranch: main
    concurrency: 3
    ticketWorkflow:
      trigger:
        matchLabels: ["ai-ready"]
        matchStatus: ["Todo"]
      statuses:
        ready: "In Progress"
        complete: "Done"
```

### server

Configures the pipeline HTTP server, bearer token authentication, and webhook endpoints.

```yaml
server:
  port: 8080
  bearerTokenEnv: JOURNEYMAN_API_TOKEN
  webhooks:
    github:
      secretEnv: GITHUB_WEBHOOK_SECRET
      path: /webhooks/github
    gitlab:
      secretEnv: GITLAB_WEBHOOK_SECRET
      path: /webhooks/gitlab
    jira:
      secretEnv: JIRA_WEBHOOK_SECRET
      path: /webhooks/jira
```

- `port`: HTTP listener port (required).
- `bearerTokenEnv`: Environment variable name containing the bearer token for API requests. Required for all requests to `/api/*`.
- `webhooks`: Map of webhook sources (github, gitlab, jira). Each webhook must declare:
  - `secretEnv`: Environment variable name containing the webhook secret for HMAC verification.
  - `path`: (optional) Custom webhook path. Defaults to `/webhooks/{source}`.

### workspaces

Cleanup and retention policy for completed/failed pipeline runs. All fields are optional.

```yaml
workspaces:
  cleanupOn:
    - "completed"
    - "failed"
  retentionDays: 7
  keepFailed: false
```

- `cleanupOn`: Array of run statuses that trigger cleanup. Valid values: `queued`, `running`, `blocked`, `completed`, `failed`, `cancelling`, `cancelled`.
- `retentionDays`: Remove runs older than N days after cleanup is triggered. Default: indefinite.
- `keepFailed`: If true, do not clean up runs with status `failed`. Default: false.

## Product Schema

Each product in the `products` map is a product configuration. Required and optional fields:

```yaml
products:
  <productId>:
    flow: string                    # Required: flow name
    workspace: string               # Required: workspace directory name
    repos: array                    # Required: at least one repo
    concurrency: number             # Optional: max concurrent steps (default: 1)
    providerConfig: object          # Optional: provider-specific options
    ticketWorkflow: object          # Optional: status mapping for ticket updates
    webhookSecrets: object          # Optional: additional secrets for this product
```

### flow

Name of the flow definition to use for this product. Must match a defined flow from `config/flows/*.yaml`.

```yaml
flow: "default-feature-flow"
```

### workspace

Directory name (relative to workspaces root) where run state, artifacts, and logs are stored.

```yaml
workspace: "edgereg-workspace"
```

This becomes `/path/to/workspaces/edgereg-workspace/{sessionId}/`.

### repos (array)

At least one repository entry. Each entry describes a git repository.

```yaml
repos:
  - providerId: github
    owner: cadmium-eng
    repo: edge-registry
    url: https://github.com/cadmium-eng/edge-registry
    defaultBranch: main
  - providerId: gitlab
    owner: platform-team
    repo: api-service
    url: https://gitlab.company.com/platform-team/api-service
    defaultBranch: develop
```

Each repo entry has:

- `providerId`: `"github"` or `"gitlab"`. Determines which git provider is used.
- `owner`: Repository owner/namespace.
- `repo`: Repository name (slug).
- `url`: Full clone URL (HTTP or SSH).
- `defaultBranch`: Default branch name (e.g. `main`, `develop`, `master`).

### concurrency

Maximum number of steps that can run in parallel for this product. Applies to the step-level semaphore during flow execution.

```yaml
concurrency: 3
```

Default: 1 (sequential execution).

### providerConfig

Provider-specific configuration options passed to each provider instance for this product.

```yaml
providerConfig:
  ticket:
    jiraHost: "https://company.atlassian.net"
    projectKey: "PROJ"
  git:
    authToken: "${GITHUB_TOKEN}"  # Resolved from env
  coding:
    model: "claude-opus"
  notification:
    slackChannel: "#pipeline-notifications"
```

Structure is provider-dependent. Consult provider documentation for valid keys.

### ticketWorkflow

Defines how semantic status names (used in flow YAML) map to literal status values in the ticket system. Also specifies which issues trigger pipeline runs.

```yaml
ticketWorkflow:
  trigger:
    matchLabels: ["ai-ready", "review"]
    matchStatus: ["Todo", "In Review"]
  statuses:
    ready: "In Progress"
    review: "In Code Review"
    complete: "Done"
    blocked: "Blocked"
```

#### trigger

Specifies which issues should trigger a pipeline run. If no trigger is defined, all issues trigger runs.

- `matchLabels`: Array of GitHub issue labels (or equivalent) that must be present.
- `matchStatus`: Array of ticket status names that must match.

Matching is AND for labels and OR for statuses (i.e., issue must have all labels, OR match any status).

#### statuses

Maps semantic status names (used in `updateStatus` phase steps) to literal status values in the actual ticket system. For example:

- Flow YAML: `config.status: "ready"`
- Mapped value: `"In Progress"` → sent to ticket provider

If a flow step references a semantic status not defined here, validation fails.

### webhookSecrets

Additional webhook verification secrets for this product, beyond the global server webhook secrets.

```yaml
webhookSecrets:
  custom-ci-service: "secret-key-for-ci"
```

## repos[] Entries (Complete Examples)

### GitHub

```yaml
repos:
  - providerId: github
    owner: cadmium-eng
    repo: edge-registry
    url: https://github.com/cadmium-eng/edge-registry
    defaultBranch: main
```

Provider: `GitHubProvider` (REST API + GitHub MCP).
Expects: `GITHUB_ACCESS_TOKEN` environment variable.

### GitLab

```yaml
repos:
  - providerId: gitlab
    owner: platform-team
    repo: api-service
    url: https://gitlab.company.com/platform-team/api-service.git
    defaultBranch: develop
```

Provider: `GitLabProvider` (REST API).
Expects: `GITLAB_ACCESS_TOKEN` environment variable.

## ticketWorkflow Deep Dive

The `ticketWorkflow` block controls issue trigger matching and status mapping.

### Status Mapping Example

```yaml
ticketWorkflow:
  statuses:
    pending: "To Do"
    in_progress: "In Progress"
    in_review: "In Code Review"
    approved: "Approved"
    merged: "Done"
    blocked: "Blocked"
```

Flow YAML then uses semantic names:

```yaml
# In config/flows/default.yaml
steps:
  - id: update-to-in-progress
    phase: updateStatus
    config:
      status: "in_progress"  # Semantic name
  - id: update-to-merged
    phase: updateStatus
    config:
      status: "merged"       # Semantic name
```

The flow validator ensures every semantic status used in flow steps exists in the product's `statuses` map.

### Trigger Matching Example

```yaml
ticketWorkflow:
  trigger:
    matchLabels: ["ai-ready"]
    matchStatus: ["To Do"]
```

This product's pipeline runs only on issues that:
- Have the `ai-ready` label, AND
- Have status `To Do`.

If no `trigger` is specified, all issues trigger runs (open gate).

## server Block Details

### Bearer Token Authentication

```yaml
server:
  bearerTokenEnv: JOURNEYMAN_API_TOKEN
```

All API requests must include the bearer token in the `Authorization` header:

```bash
curl -H "Authorization: Bearer $JOURNEYMAN_API_TOKEN" \
  https://localhost:8080/api/runs
```

The `bearerTokenEnv` value is the name of an environment variable that contains the actual token (not the token itself).

### Webhook Configuration

Each webhook source (github, gitlab, jira) is optional. Omit if you don't use that source.

```yaml
webhooks:
  github:
    secretEnv: GITHUB_WEBHOOK_SECRET
    path: /webhooks/github
  gitlab:
    secretEnv: GITLAB_WEBHOOK_SECRET
    path: /webhooks/gitlab
  jira:
    secretEnv: JIRA_WEBHOOK_SECRET
    # path defaults to /webhooks/jira if not specified
```

- `secretEnv`: Environment variable name containing the webhook secret (for HMAC verification).
- `path`: Webhook path. Optional; defaults to `/webhooks/{source}`.

Webhook payloads are verified using HMAC-SHA256 against the secret. Invalid signatures are rejected with 403 Forbidden.

## workspaces Block Details

### cleanupOn

Array of run statuses that trigger automatic cleanup.

Valid statuses:
- `queued` — pending execution
- `running` — actively executing
- `blocked` — waiting for external input
- `completed` — finished successfully
- `failed` — finished with errors
- `cancelling` — cancellation in progress
- `cancelled` — cancelled

Example: cleanup only completed and failed runs:

```yaml
workspaces:
  cleanupOn:
    - "completed"
    - "failed"
```

### retentionDays

Remove runs that were cleaned up more than N days ago.

```yaml
retentionDays: 7
```

A run becomes eligible for deletion N days after its cleanup timestamp. Omit for indefinite retention.

### keepFailed

If `true`, do not delete runs with status `failed` even if they match `cleanupOn`.

```yaml
keepFailed: true
```

Useful for debugging: failed runs are preserved longer for analysis.

## Full pipeline.yaml Example

```yaml
defaultFlow: "feature-flow"

products:
  edgereg:
    flow: feature-flow
    workspace: edgereg-ws
    repos:
      - providerId: github
        owner: cadmium-eng
        repo: edge-registry
        url: https://github.com/cadmium-eng/edge-registry
        defaultBranch: main
    concurrency: 2
    ticketWorkflow:
      trigger:
        matchLabels: ["ai-ready"]
        matchStatus: ["To Do"]
      statuses:
        pending: "To Do"
        in_progress: "In Progress"
        review: "In Review"
        complete: "Done"
        blocked: "Blocked"
    providerConfig:
      ticket:
        instance: "company.atlassian.net"
        project: "EDGE"
      git:
        token: "${GITHUB_ACCESS_TOKEN}"
      coding:
        model: "claude-opus"

  cidms:
    flow: feature-flow
    workspace: cidms-ws
    repos:
      - providerId: gitlab
        owner: keycloak-team
        repo: cidms-gateway
        url: https://gitlab.internal.com/keycloak-team/cidms-gateway.git
        defaultBranch: develop
      - providerId: github
        owner: cadmium-eng
        repo: cidms-ui
        url: https://github.com/cadmium-eng/cidms-ui
        defaultBranch: main
    concurrency: 1
    ticketWorkflow:
      trigger:
        matchLabels: ["type/feature"]
      statuses:
        pending: "Backlog"
        in_progress: "In Progress"
        complete: "Done"
    providerConfig:
      ticket:
        instance: "company.atlassian.net"
        project: "CIDMS"
      notification:
        channel: "#cidms-notifications"

server:
  port: 8080
  bearerTokenEnv: JOURNEYMAN_API_TOKEN
  webhooks:
    github:
      secretEnv: GITHUB_WEBHOOK_SECRET
      path: /webhooks/github
    gitlab:
      secretEnv: GITLAB_WEBHOOK_SECRET
    jira:
      secretEnv: JIRA_WEBHOOK_SECRET

workspaces:
  cleanupOn:
    - "completed"
    - "failed"
  retentionDays: 14
  keepFailed: true
```

The corresponding flow files are placed in `config/flows/`:

- `config/flows/feature-flow.yaml` — defines the pipeline steps, phases, and retry policies.

## Flow YAML Schema

Flow files (in `config/flows/*.yaml`) define the step-by-step execution logic.

```yaml
name: "feature-flow"
providers:
  ticket: "jira"
  git: "github"
  coding: "claude"
  notification: "slack"
steps:
  - id: clone
    phase: cloneRepos
    timeoutMs: 60000
  - id: analyze
    phase: analyze
    config:
      depth: "deep"
    retry:
      attempts: 3
      backoffMs: 5000
  - id: check-status
    phase: updateStatus
    config:
      status: "in_progress"
    onFailure: "skip"
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Flow identifier (referenced by products). |
| `providers` | object | Provider IDs for ticket, git, coding, notification. |
| `steps` | array | Ordered list of phase executions. |

Each step has:

- `id`: Unique identifier within the flow. Used in logs and state tracking.
- `phase`: Phase registry key (e.g. `cloneRepos`, `updateStatus`).
- `config`: (optional) Phase-specific configuration.
- `retry`: (optional) Retry policy: `attempts` (≥1) and `backoffMs`.
- `timeoutMs`: (optional) Step timeout in milliseconds.
- `onFailure`: (optional) Failure behavior: `fail` (default), `skip`, `retry`, or `block`.

## Validation

Pipeline configuration is validated at startup by the `FlowValidator` class.

### Validation Checks

1. **Phase existence**: Every `phase` in flow steps must be registered.
2. **Provider existence**: Every provider ID must be registered.
3. **Artifact reads/writes**: Steps can only read artifacts produced by earlier steps.
4. **Default flow**: The `defaultFlow` must be defined.
5. **Product flows**: Each product's `flow` must be defined.
6. **Status names**: Every semantic status used in flow steps must be defined in the product's `ticketWorkflow.statuses`.

### Command

Validate configuration without running the server:

```bash
journeyman validate-config config/pipeline.yaml config/flows/
```

If validation succeeds, the server starts. If it fails, the server exits with a detailed error message.

## Environment Variables

Configuration files reference environment variables via the `*Env` fields. Variable values are resolved at startup, not in the YAML itself.

### Naming Convention

- `bearerTokenEnv: JOURNEYMAN_API_TOKEN` → reads `$JOURNEYMAN_API_TOKEN`
- `secretEnv: GITHUB_WEBHOOK_SECRET` → reads `$GITHUB_WEBHOOK_SECRET`
- `secretEnv: GITLAB_WEBHOOK_SECRET` → reads `$GITLAB_WEBHOOK_SECRET`
- `secretEnv: JIRA_WEBHOOK_SECRET` → reads `$JIRA_WEBHOOK_SECRET`

### Common Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `JOURNEYMAN_API_TOKEN` | Bearer token for API access | Yes |
| `GITHUB_WEBHOOK_SECRET` | GitHub webhook HMAC secret | If using GitHub webhooks |
| `GITHUB_ACCESS_TOKEN` | GitHub REST API authentication | If using GitHub provider |
| `GITLAB_WEBHOOK_SECRET` | GitLab webhook HMAC secret | If using GitLab webhooks |
| `GITLAB_ACCESS_TOKEN` | GitLab REST API authentication | If using GitLab provider |
| `JIRA_WEBHOOK_SECRET` | Jira webhook HMAC secret | If using Jira webhooks |
| `ANTHROPIC_API_KEY` | Claude API key | Only if NOT logged in via `claude login` (server/Docker/CI) |

### Env Var vs. YAML Config

**Do not put actual secrets in YAML.** Use `*Env` fields to reference environment variables:

```yaml
# ✗ Wrong
server:
  bearerTokenEnv: "my-actual-secret-token-xyz"

# ✓ Correct
server:
  bearerTokenEnv: JOURNEYMAN_API_TOKEN
# Then set: export JOURNEYMAN_API_TOKEN="my-actual-secret-token-xyz"
```

## Common Tasks

### Add a New Product

1. Create a product entry in `products`:

```yaml
products:
  newproduct:
    flow: "feature-flow"
    workspace: "newproduct-ws"
    repos:
      - providerId: github
        owner: org-name
        repo: repo-name
        url: https://github.com/org-name/repo-name
        defaultBranch: main
    ticketWorkflow:
      statuses:
        pending: "To Do"
        complete: "Done"
```

2. Ensure the referenced flow exists in `config/flows/`.
3. Validate: `journeyman validate-config config/pipeline.yaml config/flows/`.
4. Restart the server.

### Rotate a Webhook Secret

1. Generate a new secret.
2. Update the environment variable (e.g., `GITHUB_WEBHOOK_SECRET`).
3. Update the webhook configuration in GitHub/GitLab/Jira to use the new secret.
4. Restart the server (or no restart needed if only env var is updated).

### Change Concurrency

Modify the `concurrency` field for a product:

```yaml
products:
  edgereg:
    concurrency: 5  # was 2
```

Restart the server. New runs will use the updated concurrency limit.

### Add a New Trigger Condition

Update `ticketWorkflow.trigger`:

```yaml
ticketWorkflow:
  trigger:
    matchLabels: ["ai-ready", "urgent"]  # Added "urgent"
    matchStatus: ["To Do", "In Triage"]  # Added "In Triage"
```

Existing runs are unaffected. New webhook triggers will use the updated conditions.

### Change Status Mapping

Update `ticketWorkflow.statuses`:

```yaml
ticketWorkflow:
  statuses:
    review: "Code Review"  # was "In Review"
    complete: "Released"   # was "Done"
```

The flow validator re-validates on startup. Ensure all flow steps reference valid semantic names.

### Configure a New Webhook

1. Add the webhook to the `server.webhooks` section:

```yaml
server:
  webhooks:
    newservice:
      secretEnv: NEWSERVICE_WEBHOOK_SECRET
      path: /webhooks/newservice
```

2. Set the environment variable: `export NEWSERVICE_WEBHOOK_SECRET="..."`
3. Restart the server.

The webhook endpoint is now available at `POST /webhooks/newservice`.

## See Also

- **Flow Definitions**: `config/flows/*.yaml` — step-by-step execution logic.
- **Phase Registry**: List all available phases with `journeyman list-phases`.
- **Provider Registry**: List all available providers with `journeyman list-providers`.
