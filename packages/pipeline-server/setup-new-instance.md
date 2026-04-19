# Setting up a new Journeyman instance

This guide walks you from zero to a running pipeline-server. Follow every section in order.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 20+ |
| npm | 10+ |
| A ticket source | GitHub Issues, GitLab Issues, or Jira |
| An AI provider | Anthropic API key (for ClaudeProvider) |
| A Git provider token | GitHub PAT or GitLab token |

---

## 1. Clone and install

```bash
git clone <this-repo>
cd <repo-root>
npm install          # installs all workspace packages
```

---

## 2. Create the config directory

```
config/
├── pipeline.yaml        ← server + product config
└── flows/
    └── default.yaml     ← default flow definition
```

```bash
mkdir -p config/flows
```

---

## 3. Write `config/pipeline.yaml`

This is the main config file. Copy the template below and fill in your values.

```yaml
# ── Global defaults ────────────────────────────────────────────────────────────
defaultFlow: default          # flow name used when a trigger doesn't specify one

# ── Server settings ────────────────────────────────────────────────────────────
server:
  port: 3000
  bearerTokenEnv: JOURNEYMAN_API_TOKEN   # env var that holds your API secret

  webhooks:
    github:
      secretEnv: GITHUB_WEBHOOK_SECRET   # env var for HMAC secret
      # path: /webhooks/github/:productId  ← default, override only if needed
    # gitlab:
    #   secretEnv: GITLAB_WEBHOOK_SECRET
    # jira:
    #   secretEnv: JIRA_WEBHOOK_SECRET

# ── Workspace / cleanup ────────────────────────────────────────────────────────
workspaces:
  cleanupOn: [completed, cancelled]   # delete run working dirs on these statuses
  retentionDays: 7                    # keep state files for 7 days

# ── Products ───────────────────────────────────────────────────────────────────
products:
  my-product:                          # ← your product key (used in webhook URLs)
    flow: default                      # which flow YAML to use
    workspace: ./workspaces/my-product # where cloned repos and run state are stored
    concurrency: 2                     # max parallel runs for this product

    repos:
      - providerId: github             # "github" or "gitlab"
        owner: my-org
        repo: my-repo
        url: https://github.com/my-org/my-repo
        defaultBranch: main

    providerConfig:
      ticket:
        provider: github-issues        # which ticket provider to use
        # For Jira:
        # provider: jira
        # host: https://myorg.atlassian.net
        # projectKey: PROJ
        # userEnv: JIRA_USER
        # tokenEnv: JIRA_TOKEN
      git:
        provider: github
        tokenEnv: GITHUB_TOKEN
      coding:
        provider: claude
        apiKeyEnv: ANTHROPIC_API_KEY
      notification:
        provider: slack
        tokenEnv: SLACK_BOT_TOKEN
        channel: "#deployments"

    ticketWorkflow:
      trigger:
        matchLabels: [journeyman]      # only trigger on issues/PRs with this label
      statuses:
        inProgress: "In Progress"
        review:     "In Review"
        done:       "Done"

    webhookSecrets:
      github: GITHUB_WEBHOOK_SECRET    # env var — can be different per product
```

> **Tip:** All `*Env` values are environment variable **names**, not the secrets themselves. The server reads `process.env[value]` at startup.

---

## 4. Write `config/flows/default.yaml`

A flow defines the ordered steps that run for each ticket. Each `phase` maps to a registered phase class.

```yaml
name: default

providers:
  ticket:   github-issues   # must match providerConfig.ticket.provider
  git:      github
  coding:   claude
  notification: slack

steps:
  - id: get-ticket
    phase: getTicket

  - id: clone-repos
    phase: cloneRepos
    timeoutMs: 120000
    retry:
      attempts: 2
      backoffMs: 5000

  - id: analyze
    phase: analyze
    timeoutMs: 300000

  - id: plan
    phase: plan
    timeoutMs: 180000

  - id: implement
    phase: implement
    timeoutMs: 600000

  - id: commit-push
    phase: commitPushRepos
    retry:
      attempts: 2
      backoffMs: 3000

  - id: create-pr
    phase: createPR
    onFailure: skip           # don't fail the whole run if PR already exists

  - id: add-comment
    phase: addComment
    config:
      template: "PR created: {{prUrl}}"
    onFailure: skip

  - id: cleanup
    phase: cleanupRepos
```

Available phases: `getTicket`, `cloneRepos`, `analyze`, `plan`, `implement`, `commitPushRepos`, `createPR`, `cleanupRepos`, `addComment`, `updateStatus`, `review`, `requireField`.

---

## 5. Set environment variables

Generate secrets first:

```bash
# API bearer token (protects the management API)
openssl rand -hex 32
# → paste as JOURNEYMAN_API_TOKEN

# GitHub webhook HMAC secret (shared with GitHub webhook settings)
openssl rand -hex 32
# → paste as GITHUB_WEBHOOK_SECRET
```

Then export everything (or put it in a `.env` file and use `dotenv`):

```bash
export JOURNEYMAN_API_TOKEN=<generated-above>
export GITHUB_WEBHOOK_SECRET=<generated-above>
export ANTHROPIC_API_KEY=sk-ant-...
export GITHUB_TOKEN=ghp_...

# Optional — only if using Slack
export SLACK_BOT_TOKEN=xoxb-...

# Optional — only if using Jira
export JIRA_USER=you@company.com
export JIRA_TOKEN=<jira-api-token>
```

---

## 6. Start the server

Three equivalent ways — pick whichever feels natural:

```bash
# Option 1 — npm start (simplest, from repo root)
npm start

# Option 2 — journeyman CLI serve command
npx journeyman serve
npx journeyman serve --config path/to/pipeline.yaml   # custom config path

# Option 3 — dedicated server bin
npx journeyman-server
npx journeyman-server path/to/pipeline.yaml
```

All three default to `config/pipeline.yaml` if no config path is given.

You should see:
```
journeyman pipeline-server listening on 3000
```

Verify it's healthy:
```bash
curl http://localhost:3000/api/health
# {"status":"ok","registries":{"phases":12,"flows":1,...}}
```

---

## 7. Configure the GitHub webhook

1. Go to your GitHub repo → **Settings → Webhooks → Add webhook**
2. Set:
   - **Payload URL:** `https://your-host/webhooks/github/my-product`
   - **Content type:** `application/json`
   - **Secret:** the value of `GITHUB_WEBHOOK_SECRET`
   - **Events:** select `Issues` and/or `Pull requests`
3. Click **Add webhook**

GitHub will send a ping — you should see `200` in the webhook delivery log.

To test a trigger without a real event:
```bash
curl -X POST http://localhost:3000/api/trigger/my-product \
  -H "Authorization: Bearer $JOURNEYMAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ticketKey":"my-org/my-repo#1","ticketShortKey":"1"}'
```

---

## 8. Running in production

### With PM2

```bash
npm install -g pm2
pm2 start "npm start" --name journeyman --env production
pm2 save
pm2 startup    # auto-start on reboot
```

Or with a custom config path:
```bash
pm2 start "npx journeyman serve --config /etc/journeyman/pipeline.yaml" \
  --name journeyman
```

### With Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm ci
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t journeyman .
docker run -p 3000:3000 \
  -e JOURNEYMAN_API_TOKEN=... \
  -e GITHUB_WEBHOOK_SECRET=... \
  -e ANTHROPIC_API_KEY=... \
  -e GITHUB_TOKEN=... \
  -v $(pwd)/config:/app/config \
  -v $(pwd)/workspaces:/app/workspaces \
  journeyman
```

### With a systemd service

```ini
# /etc/systemd/system/journeyman.service
[Unit]
Description=Journeyman Pipeline Server
After=network.target

[Service]
WorkingDirectory=/opt/journeyman
ExecStart=/usr/bin/npm start
Restart=on-failure
EnvironmentFile=/etc/journeyman/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable journeyman
sudo systemctl start journeyman
sudo journalctl -u journeyman -f   # tail logs
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Server exits immediately | Check the env var named in `bearerTokenEnv` is set |
| `Unknown phase: X` | Phase name in the flow YAML doesn't match a registered phase |
| `Unknown provider: X` | `providers.*` in the flow doesn't match any registered provider ID |
| `401 invalid signature` | GitHub secret mismatch — regenerate and update both `.env` and GitHub settings |
| Webhook events ignored (`label-mismatch`) | Issue doesn't have the label listed in `matchLabels` |
| Run stuck as `running` after server restart | `Pipeline.recover()` runs on startup and marks orphaned runs as `failed` — restart the server |
