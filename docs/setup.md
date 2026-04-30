# Setup Guide

Complete installation and configuration — from a clean machine to a running pipeline with one or more products.

> **For a minimal 10-minute walkthrough**, read [quickstart.md](quickstart.md) instead. This document is the full reference.

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Install the monorepo](#2-install-the-monorepo)
3. [Environment variables](#3-environment-variables)
4. [Instance-level config (`pipeline.yaml`)](#4-instance-level-config-pipelineyaml)
5. [Default flow (`flows/default.yaml`)](#5-default-flow-flowsdefaultyaml)
6. [Adding your first product](#6-adding-your-first-product)
7. [Adding additional products](#7-adding-additional-products)
8. [Webhook setup per provider](#8-webhook-setup-per-provider)
9. [Validate and run](#9-validate-and-run)
10. [Deployment notes](#10-deployment-notes)
11. [Common post-setup tasks](#11-common-post-setup-tasks)

---

## 1. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 22+ | Pipeline uses native `AbortSignal.any`, ESM, and `parseArgs` |
| npm | 10+ | Ships with Node 22 |
| git | 2.30+ | For worktree + remote ops |
| GitHub account | — | At least one repo with admin rights (for webhook setup) |
| Anthropic API key | — | For `ClaudeProvider` |

Optional:
- Reverse proxy (nginx / Caddy / Cloudflare Tunnel) for TLS termination on your webhook host.
- `tmux` / `systemd` / `pm2` for long-running server.

## 2. Install the monorepo

```bash
git clone https://github.com/<your-org>/journeyman.git
cd journeyman
npm install
```

`npm install` links every workspace package. Verify with:

```bash
npm run typecheck
```

All 8 packages should typecheck clean (exit 0).

## 3. Environment variables

Pipeline loads secrets from `.env` file (auto-loaded at startup) or real environment variables — real env vars always win over `.env` for the same key.

### Required for any deployment

```bash
# Bearer token for /api/* management routes + /api/trigger
JOURNEYMAN_API_TOKEN=...          # generate with: openssl rand -hex 32
```

### Claude authentication (pick one)

The Claude Agent SDK inherits `process.env` when spawning its subprocess. It auths one of two ways — you only need ONE:

| Method | When it works | Setup |
|---|---|---|
| `~/.claude/` session | Local dev, interactive | Run `claude login` once on the machine |
| `ANTHROPIC_API_KEY` env var | Servers, Docker, CI | `ANTHROPIC_API_KEY=sk-ant-...` in `.env` |

> **Note:** The `apiKeyEnv: ANTHROPIC_API_KEY` field in `providerConfig.coding` is **not read by any code** — it's historical dead config. The SDK just inherits whatever's in `process.env`. You can omit the `coding` block entirely.

### Required if any product uses GitHub (repos or issues)

```bash
# GitHub PAT used by GitHubProvider + GitHubIssuesProvider + GitHubProjectsProvider
GITHUB_ACCESS_TOKEN=ghp_...
```

Token scopes:
- `repo` (full control) — clone, push, create PRs, list PRs
- `issues` (read/write) — read issue metadata, add comments, manage labels

### Required per enabled webhook source

```bash
export GITHUB_WEBHOOK_SECRET="$(openssl rand -hex 32)"   # shared with GitHub webhook settings
export GITLAB_WEBHOOK_SECRET="$(openssl rand -hex 32)"   # only if using GitLab
export JIRA_WEBHOOK_SECRET="$(openssl rand -hex 32)"     # only if using Jira
```

### Per-product override (optional)

If one product needs its own GitHub App / webhook secret / Slack workspace, declare override env var names in the product's `providerConfig` or `webhookSecrets` block (see §7), then export those vars too.

### What's NOT an env var

The following go in the YAML config, not env:

- Webhook URL paths (default `/webhooks/github/:productId`, etc. — overridable per trigger).
- Product ids, repo names, owners, default branches.
- Flow step configs (timeouts, retry counts, status names).

## 4. Instance-level config (`pipeline.yaml`)

Create `config/pipeline.yaml` at the repo root. This is the single source of truth for products, server settings, and webhooks.

```yaml
defaultFlow: default

# Products come later — start empty if you're setting up a fresh instance.
products: {}

server:
  port: 3000
  bearerTokenEnv: JOURNEYMAN_API_TOKEN
  webhooks:
    github: { secretEnv: GITHUB_WEBHOOK_SECRET }
    # gitlab: { secretEnv: GITLAB_WEBHOOK_SECRET }
    # jira:   { secretEnv: JIRA_WEBHOOK_SECRET }

stateStorage:
  type: file
  directory: ./workspaces

workspaces:
  cleanupOn: ["completed", "cancelled"]
  retentionDays: 14
  keepFailed: true
```

Field notes:

| Field | Purpose |
|---|---|
| `defaultFlow` | Which flow to use when a trigger doesn't specify one and no product matches. |
| `stateStorage.type` | Backend for run state, traces, and artifacts. Only `file` is supported today. |
| `stateStorage.directory` | Root dir for file-based state. Absolute or relative to the server CWD. Defaults to `./workspaces`. |
| `products` | Map of productId → product config. We'll populate this in §6. |
| `server.port` | HTTP port to listen on. |
| `server.bearerTokenEnv` | Name of the env var holding the management API bearer. |
| `server.webhooks` | Which webhook sources to mount. Omit a key to disable that source. |
| `workspaces.cleanupOn` | After a run reaches one of these terminal states, the ephemeral `runs/<sessionId>/` dir is deleted. State + logs + artifacts are preserved separately. |
| `workspaces.retentionDays` | `journeyman sweep` deletes run dirs older than this. |
| `workspaces.keepFailed` | Preserve `failed` runs' work dirs for debugging. |

For the full reference, see [configuration.md](configuration.md).

## 5. Default flow (`flows/default.yaml`)

Create `config/flows/default.yaml`. This is the flow `defaultFlow: default` references. A reasonable starting flow for GitHub Issues:

```yaml
name: default

providers:
  ticket:       github-issues
  git:          github
  coding:       claude
  notification: slack        # no-op until SlackProvider is implemented; safe to leave

steps:
  - { id: fetch-ticket,     phase: getTicket }
  - { id: clone,            phase: cloneRepos }
  - { id: analyze,          phase: analyze,         timeoutMs: 900000 }
  - { id: comment-analysis, phase: addComment,      config: { template: analysis-summary }, onFailure: skip }
  - { id: mark-in-progress, phase: updateStatus,    config: { status: development-started } }
  - { id: plan,             phase: plan,            timeoutMs: 900000 }
  - { id: implement,        phase: implement,       timeoutMs: 1800000 }
  - { id: commit-push,      phase: commitPushRepos, config: { pattern: "#{ticket} : {summary}", prSummaryStyle: detailed } }
  - { id: open-pr,          phase: createPR }
  - { id: mark-in-review,   phase: updateStatus,    config: { status: code-review }, onFailure: skip }
  - { id: cleanup,          phase: cleanupRepos,    onFailure: skip }
```

What each step does, in one line each:

| Step | What it does |
|---|---|
| `fetch-ticket` | Calls `ticket.getTicket` and saves `ticket` + `ticketMd` to artifacts. |
| `clone` | Clones every repo in the product's `repos:` list under `workspaces/<product>/runs/<sessionId>/repos/`. |
| `analyze` | Runs Claude analyse against the primary repo; persists `analyze-report.md` as an artifact. |
| `comment-analysis` | Posts a summary comment on the ticket. Soft-fails (run continues if comment fails). |
| `mark-in-progress` | Updates ticket status to the product's `development-started` literal. |
| `plan` | Runs Claude plan; persists `plan-report.md`. |
| `implement` | Runs Claude implement; edits files; persists `implement-report.md`. |
| `commit-push` | Commits changes on a branch auto-named by the agent, pushes to the remote. Produces `commit` artifact with branch + sha + pre-formatted PR title/body. |
| `open-pr` | Calls `git.createPR`. Idempotent: if an open PR already exists for the branch, reuses it. |
| `mark-in-review` | Updates ticket status to the product's `code-review` literal. Soft-fails. |
| `cleanup` | Removes local clones. Soft-fails. |

For custom flows, see [flows.md](flows.md) and [phases.md](phases.md).

## 6. Adding your first product

Populate `products:` in `pipeline.yaml`. For a product called **edgereg** using one GitHub repo:

```yaml
products:
  edgereg:
    flow: default
    workspace: ./workspaces/edgereg
    concurrency: 2
    repos:
      - providerId: github
        owner: your-org
        repo: edgereg-api
        url: "git@github.com:your-org/edgereg-api.git"
        defaultBranch: main
    ticketWorkflow:
      trigger:
        matchLabels: ["ready-for-dev"]
      statuses:
        development-started: "in-development"
        code-review:          "code-review"
        done:                 "done"
        blocked:              "blocked"
        failed:               "failed"
```

Required fields per product:

| Field | Purpose |
|---|---|
| `flow` | Which flow to run. Must exist as `config/flows/<flow>.yaml`. |
| `workspace` | Directory under which state / logs / artifacts / runs live. Must be a writable path. |
| `repos[]` | At least one repo. Each needs `providerId`, `owner`, `repo`, `url`, `defaultBranch`. |

Optional fields:

| Field | Purpose |
|---|---|
| `concurrency` | Max parallel runs for this product. Default: unlimited. |
| `ticketWorkflow.trigger.matchLabels` | GitHub-only: trigger fires only if ticket has one of these labels. Unset = no gating. |
| `ticketWorkflow.trigger.matchStatus` | GitLab/Jira: trigger fires only on transition to one of these statuses. |
| `ticketWorkflow.statuses` | Semantic → literal mapping for `updateStatus` phases. Required if any flow step uses `updateStatus`. |
| `providerConfig` | Per-category provider options (see §7 for multi-tenant patterns). |
| `webhookSecrets` | Per-product webhook secret override. |

### Semantic statuses explained

A flow uses semantic names (`development-started`, `code-review`) in its YAML:

```yaml
- { id: mark-in-progress, phase: updateStatus, config: { status: development-started } }
```

At runtime, `UpdateStatusPhase` looks up `development-started` in the product's `ticketWorkflow.statuses` map and passes the resolved literal value (`"in-development"` for edgereg) to `ticket.updateStatus`.

This lets **one flow file** serve many products with different status vocabularies. Jira product might map `development-started: "In Progress"`; GitHub Issues product might map it to `"in-development"` (which becomes a `status:in-development` label).

### Boot validation

The server validates at startup that every `updateStatus` step in every flow has a mapping in every product that uses that flow. A typo in your config is caught before any run starts.

## 7. Adding additional products

Just add another key under `products:`. Products are independent — separate workspace dirs, separate concurrency, independently overridable auth.

### Two products, same flow, same GitHub org

```yaml
products:
  edgereg:
    flow: default
    workspace: ./workspaces/edgereg
    repos:
      - { providerId: github, owner: your-org, repo: edgereg-api, url: "git@github.com:your-org/edgereg-api.git", defaultBranch: main }
    ticketWorkflow: { statuses: { development-started: "in-development", code-review: "code-review", done: "done", blocked: "blocked", failed: "failed" } }

  cidms:
    flow: default
    workspace: ./workspaces/cidms
    repos:
      - { providerId: github, owner: your-org, repo: cidms-api, url: "git@github.com:your-org/cidms-api.git", defaultBranch: main }
    ticketWorkflow: { statuses: { development-started: "in-development", code-review: "code-review", done: "done", blocked: "blocked", failed: "failed" } }
```

Same `GITHUB_ACCESS_TOKEN` serves both. Label an issue in either repo → webhook fires to the matching product path → isolated workspace → isolated state.

### Two products, different flows

```yaml
products:
  edgereg:
    flow: default           # simple 11-step
    workspace: ./workspaces/edgereg
    repos: [...]
    ticketWorkflow: { ... }

  cidms:
    flow: cidms-secure      # custom flow with security-scan + compliance-check phases
    workspace: ./workspaces/cidms
    repos: [...]
    ticketWorkflow: { ... }
```

Create `config/flows/cidms-secure.yaml` with the extra phases. The extra phases need to be registered in `packages/pipeline-server/src/main.ts` (see [phases.md](phases.md) for the "custom phase" section).

### Two products, different GitHub orgs / separate tokens

```yaml
products:
  edgereg:
    flow: default
    workspace: ./workspaces/edgereg
    repos:
      - { providerId: github, owner: edgereg-corp, repo: api, url: "git@github.com:edgereg-corp/api.git", defaultBranch: main }
    providerConfig:
      git:    { tokenEnv: EDGEREG_GITHUB_TOKEN }
      ticket: { tokenEnv: EDGEREG_GITHUB_TOKEN }
    webhookSecrets:
      github: EDGEREG_GH_WEBHOOK_SECRET
    ticketWorkflow: { ... }

  cidms:
    flow: default
    workspace: ./workspaces/cidms
    repos:
      - { providerId: github, owner: cidms-corp, repo: api, url: "git@github.com:cidms-corp/api.git", defaultBranch: main }
    providerConfig:
      git:    { tokenEnv: CIDMS_GITHUB_TOKEN }
      ticket: { tokenEnv: CIDMS_GITHUB_TOKEN }
    webhookSecrets:
      github: CIDMS_GH_WEBHOOK_SECRET
    ticketWorkflow: { ... }
```

Now `export EDGEREG_GITHUB_TOKEN=ghp_...` and `export CIDMS_GITHUB_TOKEN=ghp_...` separately. Rotating one doesn't affect the other.

### Two products, different ticket systems

```yaml
products:
  edgereg:
    flow: default
    workspace: ./workspaces/edgereg
    repos: [ { providerId: github, ... } ]
    ticketWorkflow: { statuses: { development-started: "in-development", code-review: "code-review", ... } }
    # flow uses `ticket: github-issues`

  cidms:
    flow: default-jira       # a flow where `providers.ticket: jira`
    workspace: ./workspaces/cidms
    repos: [ { providerId: github, ... } ]
    providerConfig:
      ticket: { host: "cadmium.atlassian.net", emailEnv: JIRA_USER_EMAIL, tokenEnv: JIRA_API_TOKEN }
    ticketWorkflow: { statuses: { development-started: "In Progress", code-review: "Code Review", ... } }
```

> **Note**: `JiraProvider.getTicket`/`addComment`/`updateStatus` are still stubs as of this writing. Jira-backed products won't run end-to-end until those land.

## 8. Webhook setup per provider

Every webhook URL ends with `/:productId` so the server knows which product the payload belongs to.

### GitHub

1. Repo → **Settings** → **Webhooks** → **Add webhook**.
2. **Payload URL**: `https://<your-host>/webhooks/github/<productId>`.
3. **Content type**: `application/json`.
4. **Secret**: value of `GITHUB_WEBHOOK_SECRET` (or the per-product override if you set one).
5. **Which events to trigger**:
   - Minimum: "Issues", "Issue comments".
   - Optional: "Pull requests", "Pull request reviews" (for future human-loop auto-resume).
6. **Active**: ✅. Save.

Add one webhook per repo per product. If a product has multiple repos, each needs a webhook pointing at the same URL with the same secret.

### GitLab

1. Project → **Settings** → **Webhooks** → **Add new webhook**.
2. **URL**: `https://<your-host>/webhooks/gitlab/<productId>`.
3. **Secret token**: value of `GITLAB_WEBHOOK_SECRET`.
4. **Trigger events**: "Issues events", "Merge request events".
5. Save.

### Jira (via automation rule)

Jira doesn't have per-repo webhooks; you create an automation rule that POSTs to your server on status transition.

1. Project → **Automation** → **Create rule**.
2. **Trigger**: "Issue transitioned" (to whatever status unlocks dev work, e.g. "Ready for Development").
3. **Action**: "Send web request".
   - **URL**: `https://<your-host>/webhooks/jira/<productId>`.
   - **Method**: `POST`.
   - **Headers**: `Authorization: Bearer <JIRA_WEBHOOK_SECRET>` + `Content-Type: application/json`.
   - **Body**: use the "Issue data" template so `issue.key` and `changelog` are included.
4. Publish.

### Manual / API trigger

No webhook setup needed. You `curl` the endpoint:

```bash
curl -X POST https://<your-host>/api/trigger/<productId> \
  -H "Authorization: Bearer $JOURNEYMAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ticketKey":"your-org/edgereg-api#42"}'
```

## 9. Validate and run

### Validate the config before starting

```bash
npm run validate
```

Expected: `✓ config valid`. Errors point to the exact file + field.

### Start the server

Set env vars in a `.env` file (auto-loaded at startup) or export them to your shell — both work, shell exports take precedence:

```bash
# .env file in repo root  (recommended for local dev — add .env to .gitignore)
JOURNEYMAN_API_TOKEN=...
GITHUB_ACCESS_TOKEN=...
GITHUB_WEBHOOK_SECRET=...
# ANTHROPIC_API_KEY=...     ← only if NOT logged in via `claude login`
```

Then start with any of:

```bash
npm start                          # simplest — from repo root
npx journeyman serve               # via CLI
npx journeyman serve --config path/to/pipeline.yaml   # custom config
npx journeyman-server              # dedicated server bin
```

You should see:

```
Loaded 4 variable(s) from .env     ← shown if .env present
journeyman pipeline-server listening on 3000
```

### Smoke-test

```bash
# Health check (no auth needed)
curl http://localhost:3000/api/health

# Trigger a run manually
curl -X POST http://localhost:3000/api/trigger/edgereg \
  -H "Authorization: Bearer $JOURNEYMAN_API_TOKEN" \
  -d '{"ticketKey":"your-org/edgereg-api#42"}'

# Watch live
curl -N http://localhost:3000/api/runs/<sessionId>/stream \
  -H "Authorization: Bearer $JOURNEYMAN_API_TOKEN"

# Tail the plan step's log
tail -f workspaces/edgereg/logs/<sessionId>/plan.log
```

## 10. Deployment notes

### Single-instance only (v1)

Dedup + concurrency are in-process. **Do not run multiple replicas** behind a load balancer — each replica would see fresh state and fire duplicate runs for the same ticket.

For HA, wait for the Postgres state store + queue-backed dispatcher (interfaces already support it — see [security.md](security.md) "Hardening").

### Process supervision

**systemd example** (`/etc/systemd/system/journeyman-pipeline.service`):

```ini
[Unit]
Description=Journeyman Pipeline Server
After=network.target

[Service]
Type=simple
User=journeyman
Group=journeyman
WorkingDirectory=/opt/journeyman
EnvironmentFile=/etc/journeyman/pipeline.env
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=35       # server drains for 30s before exit

[Install]
WantedBy=multi-user.target
```

`SIGTERM` triggers graceful shutdown: in-flight runs are cancelled, server waits up to 30s for them to unwind, then exits. Set `TimeoutStopSec` at least 5s above the drain timeout.

### Reverse proxy

Put TLS termination in front. Sample nginx:

```nginx
location /webhooks/ {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_read_timeout 30s;
}

location /api/ {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_read_timeout 3600s;   # allow SSE long connections
  proxy_buffering off;         # don't buffer SSE
}
```

### Filesystem permissions

```bash
sudo chown -R journeyman:journeyman /opt/journeyman/workspaces
sudo chmod 700 /opt/journeyman/workspaces
```

State files and logs contain ticket content. Lock down the parent directory.

## 11. Common post-setup tasks

### Rotate webhook secret

1. Generate new secret: `openssl rand -hex 32`.
2. Update GitHub/GitLab/Jira webhook config with new value.
3. Update env var (`GITHUB_WEBHOOK_SECRET` or per-product override).
4. Restart server.

Brief overlap window where either old or new would verify is fine; HMAC compares are constant-time.

### Rotate bearer token

1. Generate new: `openssl rand -hex 32`.
2. Update `JOURNEYMAN_API_TOKEN` env var.
3. Restart server.
4. Update every client that calls `/api/*` to use the new value.

### Add a repo to an existing product

1. Add an entry under `products.<id>.repos[]`.
2. Configure a GitHub webhook on the new repo pointing at the same URL.
3. `npm run validate`.
4. Restart server.

### Remove a product

1. Delete its block from `pipeline.yaml`.
2. Disable the corresponding GitHub/GitLab/Jira webhooks.
3. `rm -rf workspaces/<productId>/` once all in-flight runs have completed (check `/api/runs?product=<id>&status=running`).
4. Restart server.

### Change the default flow

1. Edit `defaultFlow:` in `pipeline.yaml`.
2. Make sure the new flow exists in `config/flows/`.
3. `npm run validate`.
4. Restart server.

### Clean up old run dirs

```bash
npm run sweep
```

Or run it on a cron:

```cron
0 3 * * * cd /opt/journeyman && npm run sweep
```

---

## Next steps

- [Quickstart](quickstart.md) — 10-minute walkthrough.
- [Configuration reference](configuration.md) — every `pipeline.yaml` field.
- [Flows reference](flows.md) — authoring custom flows.
- [Phases catalog](phases.md) — writing custom phases.
- [Troubleshooting](troubleshooting.md) — when things go wrong.

---

## Secrets resolution: api-server vs cli-worker

Two execution paths resolve secrets differently:

- **api-server** (production / web-driven runs): uses `SecretsCredentialStore`,
  resolving in the order **user > org > global**. User-scope and org-scope
  secrets stored in Postgres are visible. Missing secrets fail the run with
  `reason: "missing_secrets"` before any phase executes.

- **cli-worker** (`packages/orchestrator/src/cli-worker.ts`): uses
  `EnvCredentialStore`. **Only the global tier is resolved** —
  `process.env.NAME` and `process.env.JM_GLOBAL_NAME`. User-scope and
  org-scope rows in the database are not visible to the CLI worker.

For local development against user/org secrets, run via api-server. The CLI
worker is intended for global-tier flows and quick smoke tests.
