# Quickstart — Setup and run in 10 minutes

Minimum viable pipeline. GitHub Issues + GitHub repo + Claude. One product. One manual trigger.

For the full reference, see [setup.md](setup.md).

## What you'll end up with

- A running pipeline server on `http://localhost:3000`.
- One product called `demo` pointing at one of your GitHub repos.
- An end-to-end run triggered via `curl` that opens a PR on that repo.

## Prerequisites

Have these ready before starting:

- Node.js 22+, npm 10+, git.
- **A GitHub repo** you control (you'll need admin rights for the webhook step later — not required for the manual-trigger test below).
- **A GitHub Personal Access Token** with scopes `repo` + `issues`. Generate at <https://github.com/settings/tokens>.
- **An Anthropic API key**. Generate at <https://console.anthropic.com>.
- **An open issue** on your repo with a clear description of a small change. Good first candidates: "rename X to Y", "add a null-check in Z", "write a README paragraph about W".

## 1. Install

```bash
git clone https://github.com/<your-org>/journeyman.git
cd journeyman
npm install
```

Verify:

```bash
npm run typecheck
```

Expected: all packages exit 0.

## 2. Set env vars

Create a `.env` file in the repo root (or export to your shell — both work):

```bash
JOURNEYMAN_API_TOKEN=        # generate: openssl rand -hex 32
GITHUB_ACCESS_TOKEN=ghp_your_token_here
# ANTHROPIC_API_KEY=         # only if NOT logged in via `claude login`
```

> Add `.env` to `.gitignore`.
>
> **Claude auth** — if you've run `claude login` (or use Claude Code desktop), the SDK picks up your `~/.claude/` session automatically and no API key is needed. Only required on servers / Docker / CI.
>
> **Webhook secret** — not needed for the manual-trigger path; only when wiring up real GitHub webhooks (covered at the end).
>
> **Workspace directory** — optionally set `JOURNEYMAN_BASE_DIR=/your/path/to/workspaces` in `.env` to control where run workspaces are created. Falls back to the OS temp dir.

## 3. Run it two ways

### Option A — one-shot CLI (no server)

Simplest smoke: run a single ticket end-to-end without starting the server.

```bash
npm run run-once -- \
  --product demo \
  --ticket "YOUR_GITHUB_USER_OR_ORG/YOUR_REPO#123"
```

Replace `123` with the number of an actual issue on your repo.

Expected output:

```
run <sessionId> → completed
```

Exit codes:
- `0` — completed (PR opened).
- `1` — failed or cancelled.
- `2` — blocked (if your flow ends with `review`, this is normal).

Go look at your GitHub repo — there should be a new PR linked to the issue.

### Option B — long-running server

Start:

```bash
npm start
```

Expected:

```
journeyman pipeline-server listening on 3000
```

Trigger a run:

```bash
curl -X POST http://localhost:3000/api/trigger/demo \
  -H "Authorization: Bearer $JOURNEYMAN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ticketKey":"YOUR_GITHUB_USER_OR_ORG/YOUR_REPO#123"}'
```

Expected: `{ "accepted": true }` with HTTP 202.

List runs:

```bash
curl http://localhost:3000/api/runs \
  -H "Authorization: Bearer $JOURNEYMAN_API_TOKEN" | jq
```

Watch one live via SSE:

```bash
curl -N http://localhost:3000/api/runs/<sessionId>/stream \
  -H "Authorization: Bearer $JOURNEYMAN_API_TOKEN"
```

Fetch an artifact (e.g. the plan report):

```bash
curl http://localhost:3000/api/runs/<sessionId>/artifacts/plan-report \
  -H "Authorization: Bearer $JOURNEYMAN_API_TOKEN" > plan.md
```

Stop the server: `Ctrl-C`. In-flight runs are cancelled, workspace preserved.

## 7. What just happened

If the run completed, the pipeline:

1. Fetched issue #123 from GitHub.
2. Cloned your repo into `workspaces/demo/runs/<sessionId>/repos/YOUR_REPO/`.
3. Ran Claude's analyse pass → wrote `workspaces/demo/artifacts/<sessionId>/analyze-report.md`.
4. Posted an analysis summary comment on the issue.
5. Added a `status:in-development` label to the issue.
6. Ran Claude's plan pass → `plan-report.md`.
7. Ran Claude's implement pass → edited files in the clone.
8. Committed + pushed a branch named something like `auto/fix-issue-123`.
9. Opened a PR on GitHub.
10. Swapped `status:in-development` label for `status:code-review`.
11. Deleted the local clone.

Inspect:

```bash
ls workspaces/demo/                              # state/ logs/ artifacts/
cat workspaces/demo/state/<sessionId>.json | jq  # full run record
ls workspaces/demo/artifacts/<sessionId>/        # analyze-report.md, plan-report.md, implement-report.md
```

## 8. Next: real webhooks

Once the manual trigger works, wire up a GitHub webhook so labelling an issue kicks off a run automatically.

1. Generate a webhook secret and add it to `.env`: `GITHUB_WEBHOOK_SECRET="$(openssl rand -hex 32)"`.
2. Configure the webhook secret and trigger labels for the product in the UI (product settings → webhook secrets and trigger configuration).
3. In your GitHub repo: **Settings → Webhooks → Add webhook**:
   - Payload URL: `https://your-host/webhooks/github/demo` (needs to be reachable from GitHub — use ngrok or a Cloudflare Tunnel for local testing).
   - Content type: `application/json`.
   - Secret: same value as `GITHUB_WEBHOOK_SECRET`.
   - Events: "Issues".
4. Restart the server.
5. Label an issue with `ready-for-dev` → check `curl http://localhost:3000/api/runs?product=demo | jq`.

For non-GitHub sources (GitLab, Jira) + multi-product / multi-tenant setups, see [setup.md](setup.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `npx journeyman: command not found` | Run from repo root after `npm install`. Or use `npx tsx packages/pipeline/src/cli.ts` directly. |
| `AdapterError: getTicket: missing field "ticket"` | Ticket id format. For GitHub Issues, must be `owner/repo#number`. |
| `Flow "default" references unknown phase "foo"` | Typo in flow YAML. Run `validate-config`. |
| `Product "demo" must declare at least one repo` | Empty `repos:` list. Add one. |
| `no webhook secret configured` | Set `GITHUB_WEBHOOK_SECRET` env var (or the per-product override). |
| Run stuck in `running` after restart | Normal — `Pipeline.recover()` marks them `failed` on next boot. Re-trigger. |
| `listPRs preflight failed: ...` | Transient GitHub API error. Step `retry` config will handle it, or `onFailure: skip` to skip idempotency check (not recommended). |

Full runbook: [troubleshooting.md](troubleshooting.md).

---

That's the fast path. You now have a working pipeline. Tune the flow, add more products, wire webhooks, and you're in production territory.
