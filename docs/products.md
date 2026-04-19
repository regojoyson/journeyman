# Product Onboarding Guide

## What is a Product?

A **product** in the Journeyman pipeline is a logical tenant of work — a bounded execution context with its own flow, workspace directory, repository configuration, and concurrency limits. Each product has:

- **A unique identifier** — used in configuration and webhooks (e.g., `edgereg`, `cidms`)
- **A dedicated workspace directory** — isolated state, logs, artifacts, and ephemeral run directories
- **A flow** — the sequence of steps executed for each run
- **Repository configuration** — which Git repos are tracked
- **Provider configuration** — tokens, models, and service-specific settings
- **Webhook secrets** — for GitHub webhook integration
- **Concurrency limits** — to control parallel run execution

Multiple products can coexist in a single Journeyman instance, each with independent configurations, secrets, and rate limits. Renaming or deleting a product does not affect others.

## Disk Layout

All workspace data for product `<product-id>` lives under `workspaces/<product-id>/`:

```
workspaces/edgereg/
├── state/
│   └── <sessionId>.json           ← run state, results, status
├── logs/
│   └── <sessionId>/
│       ├── clone.log              ← step execution logs
│       ├── scan.log
│       ├── analyze.log
│       └── ...
├── artifacts/
│   └── <sessionId>/
│       ├── repos-summary.json     ← analysis outputs
│       ├── plan.md
│       └── <key>.<ext>            ← arbitrary artifacts
└── runs/
    └── <sessionId>/               ← ephemeral work directory
        ├── repo1/                 ← cloned repos
        ├── repo2/
        └── ...                    ← deleted per workspaces.cleanupOn
```

**File descriptions:**

- `state/<sessionId>.json` — persistent record of a run: input params, status, results, timestamps, errors
- `logs/<sessionId>/<step>.log` — unbuffered execution log for each pipeline step
- `artifacts/<sessionId>/<key>.<ext>` — outputs from analysis, planning, reports (JSON, markdown, etc.)
- `runs/<sessionId>/` — temporary directory for cloned repos and work; deleted automatically when configured

## Adding a New Product — End-to-End Walkthrough

### Step 1: Add Product Configuration to `pipeline.yaml`

Define your product in the main configuration file:

```yaml
products:
  edgereg:
    flow: edgereg-default
    workspace: ./workspaces/edgereg
    repos:
      - providerId: github
        owner: cadmium-ai
        repo: edgereg
        url: https://github.com/cadmium-ai/edgereg.git
        defaultBranch: main
      - providerId: github
        owner: cadmium-ai
        repo: edgereg-cli
        url: https://github.com/cadmium-ai/edgereg-cli.git
        defaultBranch: main
```

**Required fields:**

- `flow` — name of the flow file (see step 2)
- `workspace` — relative path to workspace directory
- `repos[]` — list of repositories to track
  - `providerId` — provider identifier (e.g., `github`, `gitlab`)
  - `owner` — repo owner/organization
  - `repo` — repository name
  - `url` — Git clone URL
  - `defaultBranch` — default branch for PRs, checks

**Optional fields:**

- `providerConfig` — per-product tokens/overrides (see section on per-product overrides)
- `webhookSecrets` — product-specific webhook signing keys
- `concurrency` — max parallel runs (default from global config)
- `ticketWorkflow` — semantic-to-literal status mapping for tickets

### Step 2: Create or Reference a Flow File

Flows are YAML files in `config/flows/` that define the pipeline steps. You can create a new flow or reuse an existing one.

**Create a new flow** at `config/flows/edgereg-default.yaml`:

```yaml
# config/flows/edgereg-default.yaml
name: edgereg-default
description: Standard Journeyman pipeline for EdgeReg product
steps:
  - id: clone
    action: cloneRepos
    description: Clone all configured repositories
    timeout: 5m

  - id: scan
    action: scanRepos
    description: Scan repositories for issues, structure, size
    timeout: 10m
    dependencies: [clone]

  - id: analyze
    action: analyze
    description: AI analysis of codebase
    timeout: 30m
    dependencies: [scan]

  - id: plan
    action: plan
    description: Generate implementation plan
    timeout: 30m
    dependencies: [analyze]

  - id: cleanup
    action: cleanupRepos
    description: Delete ephemeral work directory
    timeout: 5m
    dependencies: [plan]
```

Or **point to an existing flow** if multiple products share the same pipeline:

```yaml
products:
  edgereg:
    flow: shared-pipeline
```

### Step 3: Set Environment Variables

Products require environment variables for authentication. Define these in your deployment or `.env` file:

```bash
# GitHub provider (used by all products unless overridden per-product)
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Jira provider (if using ticket-provider)
JIRA_DOMAIN=mycompany.atlassian.net
JIRA_EMAIL=bot@mycompany.com
JIRA_API_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxx

# Slack provider (if using notification-provider)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/Txxxxx/Bxxxxx/xxxx

# Product-specific webhook secrets
WEBHOOK_SECRET_EDGEREG=your-secret-key-1
WEBHOOK_SECRET_CIDMS=your-secret-key-2
```

**Webhook secret environment variable naming:** `WEBHOOK_SECRET_<PRODUCT_ID_UPPERCASE>`

### Step 4: Configure GitHub Webhook

Set up a webhook on your GitHub repositories to notify Journeyman of push events.

**Webhook URL:** `https://your-host/webhooks/github/<product-id>`

**Example for product `edgereg`:**
- URL: `https://journeyman.example.com/webhooks/github/edgereg`
- Events: `push`, `pull_request`
- Secret: value of `WEBHOOK_SECRET_EDGEREG` environment variable
- Active: enabled

Journeyman listens for `push` events and enqueues a new run for the product.

### Step 5: Validate Configuration and Restart

Before deploying, validate your configuration:

```bash
journeyman validate-config
```

This checks:
- All required fields are present
- Flow files exist and are valid YAML
- Workspace paths are writable
- Environment variables are set
- GitHub webhook URLs are reachable

Then restart the Journeyman server:

```bash
# Stop the server
systemctl stop journeyman

# Start the server
systemctl start journeyman

# Check logs
journalctl -u journeyman -f
```

The server will load the new product configuration and start listening for webhooks.

## Minimal Configuration Example

Here is a complete minimal setup with one product, one shared flow, and one repository:

```yaml
# pipeline.yaml
flows:
  default: config/flows/default.yaml

products:
  demo:
    flow: default
    workspace: ./workspaces/demo
    repos:
      - providerId: github
        owner: myorg
        repo: myrepo
        url: https://github.com/myorg/myrepo.git
        defaultBranch: main

workspaces:
  cleanupOn: "completion"
  retentionDays: 30
```

```yaml
# config/flows/default.yaml
name: default
steps:
  - id: clone
    action: cloneRepos
    timeout: 5m

  - id: scan
    action: scanRepos
    timeout: 10m
    dependencies: [clone]

  - id: cleanup
    action: cleanupRepos
    timeout: 5m
    dependencies: [scan]
```

```bash
# .env (or systemd environment file)
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
WEBHOOK_SECRET_DEMO=my-webhook-secret
```

## Per-Product Overrides

Each of these fields can be set per-product to override global defaults:

### `providerConfig`

Override default tokens or service-specific settings for a single product:

```yaml
products:
  edgereg:
    flow: edgereg-default
    workspace: ./workspaces/edgereg
    repos: [...]
    providerConfig:
      github:
        token: ${GITHUB_TOKEN_EDGEREG}  # different token per product
        apiVersion: "2022-11-28"
      claude:
        model: claude-opus-4
        temperature: 0.7
```

Environment variables are resolved at startup:

```bash
GITHUB_TOKEN_EDGEREG=ghp_xxxx_edgereg_xxxx
GITHUB_TOKEN_CIDMS=ghp_xxxx_cidms_xxxx
CLAUDE_MODEL_EDGEREG=claude-opus-4
```

### `webhookSecrets`

Use a different webhook secret for each product without sharing the global secret:

```yaml
products:
  edgereg:
    webhookSecrets:
      github: ${WEBHOOK_SECRET_EDGEREG}

  cidms:
    webhookSecrets:
      github: ${WEBHOOK_SECRET_CIDMS}
```

Rotate one product's secret without affecting others:

```bash
# Update WEBHOOK_SECRET_EDGEREG in your environment
WEBHOOK_SECRET_EDGEREG=new-secret-key-1
# Update the webhook in GitHub
# Restart Journeyman
```

### `concurrency`

Limit parallel runs per product, useful for rate-sensitive services:

```yaml
products:
  edgereg:
    flow: edgereg-default
    workspace: ./workspaces/edgereg
    repos: [...]
    concurrency:
      maxParallel: 2          # max 2 runs at a time
      queueTimeout: "1h"      # runs waiting >1h are dropped
```

### `ticketWorkflow`

Map semantic statuses (e.g., `open`, `in_progress`, `done`) to literal ticket tracker statuses (Jira, Linear, Monday).

```yaml
products:
  edgereg:
    ticketWorkflow:
      semantic:
        - open: "To Do"
        - in_progress: "In Progress"
        - done: "Done"
        - blocked: "Blocked"
      provider: jira  # or linear, monday
```

When Journeyman transitions a ticket, it resolves the semantic status to the literal one:

```typescript
// Internal API
await ticketProvider.updateIssue({
  key: "EDGE-123",
  status: await config.resolveStatus("in_progress"),  // resolves to "In Progress"
});
```

## Deleting a Product

To remove a product from the pipeline:

1. **Remove the product block** from `pipeline.yaml`:
   ```yaml
   # Remove this entire section:
   # products:
   #   old-product:
   #     ...
   ```

2. **Delete the workspace directory:**
   ```bash
   rm -rf workspaces/old-product
   ```
   This deletes all state, logs, and artifacts for that product. In-flight runs will be lost.

3. **Remove GitHub webhooks** that pointed to the product:
   ```
   https://journeyman.example.com/webhooks/github/old-product
   ```
   Go to each GitHub repository → Settings → Webhooks, find the webhook, and delete it.

4. **Remove environment variables** (if product-specific):
   ```bash
   # Remove from .env or systemd config:
   # WEBHOOK_SECRET_OLD_PRODUCT=...
   # GITHUB_TOKEN_OLD_PRODUCT=...
   ```

5. **Validate and restart:**
   ```bash
   journeyman validate-config
   systemctl restart journeyman
   ```

## Renaming a Product

Because session IDs reference the product workspace directory, renaming a product in place is not supported. Instead:

1. **Add the new product** with the same configuration:
   ```yaml
   products:
     edgereg-v2:  # new name
       flow: edgereg-default
       workspace: ./workspaces/edgereg-v2
       repos: [...]
   ```

2. **Update GitHub webhooks** to point to the new product:
   - Old: `https://journeyman.example.com/webhooks/github/edgereg`
   - New: `https://journeyman.example.com/webhooks/github/edgereg-v2`

3. **Let in-flight runs complete** — existing runs in the old product's workspace will finish normally.

4. **After all runs complete**, delete the old product:
   ```bash
   # Remove from pipeline.yaml
   # rm -rf workspaces/edgereg
   ```

5. **Validate and restart:**
   ```bash
   journeyman validate-config
   systemctl restart journeyman
   ```

## Multiple Products, Shared Flow

Two or more products can use the same flow with different repositories and configurations. This example shows `edgereg` and `cidms` sharing the `shared-pipeline` flow:

```yaml
# pipeline.yaml
flows:
  shared-pipeline: config/flows/shared-pipeline.yaml

products:
  edgereg:
    flow: shared-pipeline
    workspace: ./workspaces/edgereg
    repos:
      - providerId: github
        owner: cadmium-ai
        repo: edgereg
        url: https://github.com/cadmium-ai/edgereg.git
        defaultBranch: main
    ticketWorkflow:
      semantic:
        - open: "To Do"
        - in_progress: "In Progress"
        - done: "Done"

  cidms:
    flow: shared-pipeline
    workspace: ./workspaces/cidms
    repos:
      - providerId: github
        owner: cadmium-ai
        repo: cidms
        url: https://github.com/cadmium-ai/cidms.git
        defaultBranch: develop
    ticketWorkflow:
      semantic:
        - open: "Open"
        - in_progress: "Active"
        - done: "Resolved"
    concurrency:
      maxParallel: 1  # CIDMS is more rate-sensitive
```

**Benefits:**

- Single flow definition, multiple executions — less maintenance
- Per-product repos — products track different code
- Per-product status mapping — each product uses its own ticket workflow
- Per-product concurrency — rate-sensitive products can be throttled independently

**Environment:**

```bash
GITHUB_TOKEN=ghp_shared_token_for_both_products
WEBHOOK_SECRET_EDGEREG=secret-1
WEBHOOK_SECRET_CIDMS=secret-2
JIRA_API_TOKEN=shared_token
```

Both products will use the shared Jira token. To use different Jira instances per product, use `providerConfig`:

```yaml
products:
  edgereg:
    providerConfig:
      jira:
        domain: edgereg.atlassian.net
        email: bot-edgereg@company.com
        token: ${JIRA_TOKEN_EDGEREG}
  cidms:
    providerConfig:
      jira:
        domain: cidms.atlassian.net
        email: bot-cidms@company.com
        token: ${JIRA_TOKEN_CIDMS}
```

Then define both tokens:

```bash
JIRA_TOKEN_EDGEREG=token_1
JIRA_TOKEN_CIDMS=token_2
```
