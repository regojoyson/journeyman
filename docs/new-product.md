# Adding a new product to an existing instance

A **product** in Journeyman is one project/team that has its own repos, ticket source, and pipeline configuration. You can add as many products as you need to a single running instance.

---

## What you will do

1. Add the product block to `pipeline.yaml`
2. Set any new environment variables
3. Configure the webhook in your Git/ticket platform
4. Validate and reload

No code changes are required — everything is driven by config.

---

## Step 1 — Add the product to `pipeline.yaml`

Open `config/pipeline.yaml` and add a new key under `products`. Each product key becomes the `:productId` segment in webhook and API URLs.

```yaml
products:

  # ── existing product ────────────────────────────────────────────────────────
  existing-product:
    # ... leave this untouched ...

  # ── new product ─────────────────────────────────────────────────────────────
  new-product:                          # ← choose a short, URL-safe key
    flow: default                       # name of the flow YAML to run (config/flows/<name>.yaml)
    workspace: ./workspaces/new-product # isolated directory for cloned repos and run state
    concurrency: 1                      # max parallel runs for this product (optional, default unlimited)

    repos:
      - providerId: github              # "github" or "gitlab"
        owner: my-org
        repo: new-repo
        url: https://github.com/my-org/new-repo
        defaultBranch: main
      # add more repos if the flow should clone multiple:
      # - providerId: github
      #   owner: my-org
      #   repo: another-repo
      #   url: https://github.com/my-org/another-repo
      #   defaultBranch: develop

    providerConfig:
      ticket:
        provider: github-issues         # or: jira, linear, monday, gitlab-issues
        # Jira example:
        # provider: jira
        # host: https://myorg.atlassian.net
        # projectKey: NEWPROJ
        # userEnv: JIRA_USER
        # tokenEnv: JIRA_TOKEN
      git:
        provider: github                # or: gitlab
        tokenEnv: GITHUB_TOKEN          # reuse existing env var, or set a new one
      coding:
        provider: claude
        apiKeyEnv: ANTHROPIC_API_KEY
      notification:
        provider: slack
        tokenEnv: SLACK_BOT_TOKEN
        channel: "#new-team-alerts"

    ticketWorkflow:
      trigger:
        matchLabels: [journeyman]       # only process issues/PRs with this label
        # matchStatus: ["To Do"]        # alternatively gate on ticket status
      statuses:
        inProgress: "In Progress"
        review:     "In Review"
        done:       "Done"

    webhookSecrets:
      github: NEW_PRODUCT_WEBHOOK_SECRET   # env var name — one secret per product is recommended
```

### Provider options at a glance

| Category | Available providers |
|---|---|
| `ticket` | `github-issues`, `github-projects`, `gitlab-issues`, `jira`, `linear`, `monday` |
| `git` | `github`, `gitlab` |
| `coding` | `claude`, `gemini`, `codex` |
| `notification` | `slack` |

---

## Step 2 — Set new environment variables

If this product needs its own webhook secret (recommended):

```bash
# Generate a new HMAC secret for this product
openssl rand -hex 32
# → set as NEW_PRODUCT_WEBHOOK_SECRET
```

The server auto-detects both `.env` and real environment variables — `process.env` always wins over `.env` for the same key.

**Option A — add to `.env` (local dev)**

Append to your existing `.env` file in the repo root:

```bash
NEW_PRODUCT_WEBHOOK_SECRET=<generated-above>

# Only if this product uses different credentials:
NEW_JIRA_TOKEN=...
NEW_LINEAR_API_KEY=...
```

**Option B — shell export / Docker / systemd**

```bash
export NEW_PRODUCT_WEBHOOK_SECRET=<generated-above>
```

If the new product reuses credentials already set (e.g. `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`), you don't need to add them again — just point `*Env` keys to the same variable names.

---

## Step 3 — Create a flow (if needed)

If the new product needs different steps from the default, create a new flow file:

```bash
cp config/flows/default.yaml config/flows/new-product-flow.yaml
```

Edit `config/flows/new-product-flow.yaml` — change the `name` field and adjust steps:

```yaml
name: new-product-flow    # must be unique

providers:
  ticket:   github-issues
  git:      github
  coding:   claude
  notification: slack

steps:
  - id: get-ticket
    phase: getTicket

  - id: require-label
    phase: requireField
    config:
      field: labels
      contains: journeyman
    onFailure: block        # block (don't fail) if the label is missing

  - id: clone-repos
    phase: cloneRepos
    timeoutMs: 120000

  - id: analyze
    phase: analyze

  - id: implement
    phase: implement
    timeoutMs: 600000

  - id: commit-push
    phase: commitPushRepos

  - id: create-pr
    phase: createPR
    onFailure: skip

  - id: cleanup
    phase: cleanupRepos
```

Then point the product at the new flow in `pipeline.yaml`:

```yaml
products:
  new-product:
    flow: new-product-flow   # ← changed from "default"
```

---

## Step 4 — Validate the config

Before restarting, validate that your YAML is well-formed and all providers/phases are known:

```bash
npx journeyman validate-config
npx journeyman validate-config --config path/to/pipeline.yaml   # custom path
```

If validation passes you will see:
```
config ok — 2 products, 2 flows, 12 phases
```

Common validation errors:

| Error | Fix |
|---|---|
| `Unknown phase: X` | Typo in the `phase` field — check the phase name list below |
| `Unknown provider: X` | `providers.*` in the flow doesn't match any provider ID |
| `No repos defined for product X` | `repos` array is empty or missing |
| `Flow "X" not found` | Flow file name doesn't match the `flow:` value in the product |

Available phase names: `getTicket`, `cloneRepos`, `analyze`, `plan`, `implement`, `commitPushRepos`, `createPR`, `cleanupRepos`, `addComment`, `updateStatus`, `review`, `requireField`.

---

## Step 5 — Restart the server

The server must be restarted to pick up config changes (no hot reload):

```bash
# If running with PM2:
pm2 restart journeyman

# If running directly — Ctrl+C then use any of:
npm start
npx journeyman serve
npx journeyman serve --config path/to/pipeline.yaml
npx journeyman-server
```

Verify the new product appears:

```bash
curl -s http://localhost:3000/api/health | jq .
# Check that flow/phase counts increased

curl -s -H "Authorization: Bearer $JOURNEYMAN_API_TOKEN" \
  http://localhost:3000/api/flows | jq '.[].name'
```

---

## Step 6 — Configure the webhook in GitHub/GitLab/Jira

### GitHub

1. Go to `https://github.com/<owner>/<repo>/settings/hooks`
2. Click **Add webhook**
3. Fill in:
   - **Payload URL:** `https://your-host/webhooks/github/new-product`
   - **Content type:** `application/json`
   - **Secret:** the value of `NEW_PRODUCT_WEBHOOK_SECRET`
   - **Events:** `Issues` and/or `Pull requests`
4. Save. GitHub sends a ping — check the delivery log for `200`.

### GitLab

1. Go to the project → **Settings → Webhooks**
2. Fill in:
   - **URL:** `https://your-host/webhooks/gitlab/new-product`
   - **Secret token:** the value of `NEW_PRODUCT_WEBHOOK_SECRET`
   - **Trigger:** Issues events
3. Save and click **Test**.

### Jira

1. Go to **Jira Settings → System → WebHooks**
2. Click **Create a WebHook**
3. Fill in:
   - **URL:** `https://your-host/webhooks/jira/new-product`
   - **Events:** issue updated / issue created
4. Save.

> Jira webhooks don't support secrets natively — use network-level protection (VPN / IP allowlist) instead.

---

## Step 7 — Test with a manual trigger

Send a test trigger without needing a real webhook event:

```bash
curl -X POST http://localhost:3000/api/trigger/new-product \
  -H "Authorization: Bearer $JOURNEYMAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ticketKey": "my-org/new-repo#1",
    "ticketShortKey": "1",
    "flowName": "new-product-flow"
  }'
```

Expected response: `{"accepted": true}` with HTTP 202.

Watch the run:

```bash
# List active runs
curl -s -H "Authorization: Bearer $JOURNEYMAN_API_TOKEN" \
  "http://localhost:3000/api/runs?product=new-product&status=running" | jq .

# Stream live events (replace <sessionId> from the list above)
curl -N -H "Authorization: Bearer $JOURNEYMAN_API_TOKEN" \
  http://localhost:3000/api/runs/<sessionId>/stream
```

---

## Product config reference

```yaml
products:
  <product-key>:
    flow: <string>                  # required — flow YAML name (without .yaml)
    workspace: <path>               # required — local directory for state + cloned repos
    concurrency: <int>              # optional — max parallel runs (default: unlimited)

    repos:                          # required — at least one repo
      - providerId: github|gitlab
        owner: <string>
        repo: <string>
        url: <string>
        defaultBranch: <string>

    providerConfig:
      ticket:
        provider: <providerId>
        # ... provider-specific keys ...
      git:
        provider: <providerId>
        tokenEnv: <envVarName>
      coding:
        provider: <providerId>
        apiKeyEnv: <envVarName>
      notification:
        provider: <providerId>
        tokenEnv: <envVarName>
        channel: <string>

    ticketWorkflow:
      trigger:
        matchLabels: [<string>]     # optional — label allowlist
        matchStatus: [<string>]     # optional — ticket status allowlist
      statuses:
        inProgress: <string>        # ticket status to set when run starts
        review: <string>            # ticket status to set when PR is created
        done: <string>              # ticket status to set when run completes

    webhookSecrets:
      github: <envVarName>          # optional — per-product secret override
      gitlab: <envVarName>
      jira: <envVarName>
```
