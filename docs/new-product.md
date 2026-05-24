# Adding a new product to an existing instance

A **product** in Journeyman is one project/team that has its own repos, ticket source, and pipeline configuration. You can add as many products as you need to a single running instance.

---

## What you will do

1. Add the product in the UI
2. Set any new environment variables
3. Configure the webhook in your Git/ticket platform
4. Restart and test

No code changes are required — everything is driven by the UI and database config.

---

## Step 1 — Add the product in the UI

Create the product in the web UI. Each product key becomes the `:productId` segment in webhook and API URLs. Configure:

- **Repos** — list of repositories (`providerId`, owner, repo name, URL, default branch). Add more repos if the flow should clone multiple.
- **Flow** — select from registered flows (create one first if needed).
- **Concurrency** — max parallel runs (optional, default unlimited).
- **Provider config** — per-category tokens/overrides:
  - `ticket`: provider ID (`github-issues`, `jira`, `linear`, etc.) + connection options
  - `git`: provider ID (`github`, `gitlab`) + `tokenEnv`
  - `notification`: provider + channel
- **Ticket workflow** — trigger labels/statuses + semantic-to-literal status mappings.
- **Webhook secrets** — per-product webhook secret env var name (one secret per product is recommended).

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

If the new product needs different steps from the default, create a new flow in the UI flow editor. You can clone an existing flow and adjust its steps. A typical custom flow:

```yaml
name: new-product-flow    # must be unique

providers:
  ticket:   github-issues
  git:      github
  coding:   claude
  notification: slack

steps:
  - id: get-ticket
    stepType: getTicket

  - id: clone-repos
    stepType: cloneRepos
    timeoutMs: 120000

  - id: analyze
    stepType: analyze

  - id: implement
    stepType: implement
    timeoutMs: 600000

  - id: commit-push
    stepType: commitPushRepos

  - id: create-pr
    stepType: createPR
    onFailure: skip

  - id: cleanup
    stepType: cleanupRepos
```

After saving the flow in the UI, assign it to the product in the product settings.

---

## Step 4 — Validate

Use the UI flow editor's built-in validation to check that all providers and step references are correct before running. Common issues:

| Issue | Fix |
|---|---|
| Unknown step | Typo in the `stepType` field — check available step names |
| Unknown provider | `providers.*` in the flow doesn't match any registered provider ID |
| Missing required input | A step requires an input that no upstream step produces |

Available step names: `getTicket`, `cloneRepos`, `analyze`, `plan`, `implement`, `commitPushRepos`, `createPR`, `cleanupRepos`, `addComment`, `updateStatus`, `review`, `requireField`.

---

## Step 5 — Restart the server

The server must be restarted to pick up config changes (no hot reload):

```bash
# If running with PM2:
pm2 restart journeyman

# If running directly — Ctrl+C then use any of:
npm start
npx journeyman serve
npx journeyman-server
```

Verify the new product appears:

```bash
curl -s http://localhost:3000/api/health | jq .
# Check that flow/step counts increased

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

---

## Using the human-loop flow

If the new product should gate each major step (`analyze`, `plan`, code review) on human approval with bounded rework cycles, point it at the ready-made `human-loop` flow instead of writing a custom flow:

```yaml
products:
  new-product:
    flow: human-loop        # select the human-loop flow from the UI
```

The human-loop flow inserts three `reviewLoop` gates after `analyze`, `plan`, and `createPR`. A reviewer drives the loop by changing the ticket status — the webhook dispatcher auto-resumes the blocked run (see [docs/triggers.md](./triggers.md#status-change-routing)). See [docs/flows.md](./flows.md#human-review-loops) for the full step list and config reference.

Add the semantic-to-literal status mapping required by the flow to the product's `ticketWorkflow.statuses`:

```yaml
products:
  new-product:
    flow: human-loop
    workspace: ./workspaces/new-product

    repos:
      - providerId: github
        owner: my-org
        repo: my-repo
        url: https://github.com/my-org/my-repo
        defaultBranch: main

    providerConfig:
      ticket:
        projectId: "my-org/my-repo"
        tokenEnv: MY_PRODUCT_GITHUB_TOKEN
      git:
        tokenEnv: MY_PRODUCT_GITHUB_TOKEN
      notification:
        channel: "#my-product-reviews"

    ticketWorkflow:
      trigger:
        matchLabels: [Todo]
      statuses:
        development-started: "in-progress"
        analyze-approved:    "analyze-approved"
        analyze-rework:      "analyze-rework"
        plan-approved:       "plan-approved"
        plan-rework:         "plan-rework"
        code-review:         "in-review"
        rework-requested:    "rework-requested"
        completed:           "completed"
        failed:              "failed"

    webhookSecrets:
      github: GITHUB_WEBHOOK_SECRET
```

The literal values on the right-hand side must match whatever your ticket provider actually uses (GitHub labels, Jira workflow states, etc.). See [docs/configuration.md](./configuration.md#semantic-status-names-for-review-loops) for the full semantic-name reference. Ensure the GitHub webhook is subscribed to the `issues` event with the `labeled` / `unlabeled` actions enabled so status changes flow through the dispatcher.
