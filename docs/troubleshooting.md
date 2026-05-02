# Pipeline Troubleshooting Runbook

This document covers known failure modes, diagnostics, and remediation steps for the Journeyman pipeline.

## Run stuck in "running" status after server restart

**Symptom:** A run shows `status: running` long after the process that was executing it has died. No progress updates for hours.

**Diagnostics:** 
- Check the run's state file: `jq '.steps[-1].status' workspaces/<product>/state/<sessionId>.json`
- If the last step shows `running` but no process is alive, it's a dangling run
- Verify with `curl http://localhost:3000/api/runs/<sessionId>` that status is still `running`

**Fix:** 
- `Pipeline.recover()` runs automatically on the next server boot and scans for dangling runs
- Dangling runs are marked `failed` with `code: process-crash`
- Admins can trigger a re-run via `/api/trigger/:productId` (uses the same ticket/event)
- Alternatively, bump the run's `startedAt` timestamp in the state file to force recovery on next boot

---

## Webhook returns 200 with "ignored" in body

**Symptom:** GitHub/GitLab/Jira webhook delivery log shows HTTP 200, but no run was created. The response body contains an `ignored` key.

**Diagnostics:**
- Check the webhook response body for the `ignored` message:
  - `"label-mismatch"` — the trigger label filter didn't match
  - `"status-mismatch"` — the ticket status is not in `ticketWorkflow.trigger.statusFilter`
  - `"no-ticket"` — GitHub Issue number/GitLab merge request could not be resolved to a ticket
- Verify the trigger labels configured for the product in the UI.

**Fix:**
- Adjust `productConfig.ticketWorkflow.trigger` gating rules
- Add the required label to the ticket (if using label-based triggers)
- Ensure the ticket/issue is in a status that matches `statusFilter`
- For GitHub Issues, verify the issue number is correctly parsed from the webhook payload

---

## Boot error: Flow X references unknown phase Y

**Symptom:** Server fails to start with an error like: `Flow "create-pr" references unknown phase "post-review" not in registered phases: [analyze, plan, implement, create-pr, notify]`

**Diagnostics:**
- The error lists all registered phases in the registry
- Open the flow in the UI flow editor and check for typos in step definitions
- Verify each `step.phase` matches a registered phase name (case-sensitive)

**Fix:**
- Correct the typo in the flow YAML configuration
- Run `journeyman validate-config` before restarting to catch syntax errors early
- Reload the server after fixing

---

## Boot error: semantic status not defined in product

**Symptom:** Server fails with: `Flow "X" step "mark-in-review" uses semantic status "code-revue" not defined in product "edgereg"`

**Diagnostics:**
- The error tells you which flow, step, and status key are missing
- Check the ticket workflow status mappings configured for the product in the UI.
- Verify all status keys referenced in steps exist in the statuses map.

**Fix:**
- Add the missing semantic status to the product's ticket workflow in the UI.
- Restart the worker.

---

## Boot error: Product has no repos configured

**Symptom:** Server fails to start with: `Product "my-app" has no repos configured`

**Diagnostics:**
- Check the repos configured for the product in the UI.
- Confirm at least one repo is configured.

**Fix:**
- Add at least one repository entry to the product:
  ```yaml
  products:
    my-app:
      repos:
        - owner: "my-org"
          name: "my-repo"
          credentialsEnv: "GITHUB_TOKEN"
  ```
- Restart the server

---

## PR creation failed: "A pull request already exists"

**Symptom:** A `create-pr` phase fails with: `Error: A pull request already exists for <branch>`

**Diagnostics:**
- This error should be prevented by the `listPRs` preflight check in `CreatePRPhase`
- If it still occurs, verify that `GitHubProvider.listPRs()` is correctly returning the existing PR
- Check the provider's token permissions: `github_token` scope must include `repo:read`

**Fix:**
- Verify the GitHub/GitLab token has sufficient permissions (`repo:read` or higher)
- Check that `listPRs()` is being called with the correct owner/repo
- If the PR exists on a different branch, adjust branch naming logic
- Re-run the flow once permissions are corrected

---

## `implement` phase times out

**Symptom:** A step in the `implement` phase fails with `code: AbortError` or similar timeout-related error. The step shows a very long `durationMs` close to or exceeding `timeoutMs`.

**Diagnostics:**
- Check the step's metadata: `jq '.steps[] | select(.phase=="implement") | {name, timeoutMs, durationMs, status, code}' workspaces/<product>/state/<sessionId>.json`
- Verify `ANTHROPIC_API_KEY` is valid and not rate-limited (check Claude API dashboard)
- Look at step logs: `tail -f workspaces/<product>/logs/<sessionId>/<stepId>.log` while reproducing

**Fix:**
- Increase `timeoutMs` for the step in the flow YAML (e.g., from 300000 to 600000 for 10 minutes)
- Verify Claude API quota is not exhausted (rate limit or account balance)
- Reduce `concurrency` in product config if multiple runs are hammering the API simultaneously
- Check for transient network issues between the server and Anthropic API

---

## Webhook 401 "invalid signature"

**Symptom:** Webhook delivery returns HTTP 401 with error: `Invalid signature`

**Diagnostics:**
- GitHub/GitLab computes a signature using the shared webhook secret
- Verify the secret on both sides matches:
  - Check `GITHUB_WEBHOOK_SECRET` environment variable (or `products.<id>.webhookSecrets.github`)
  - Verify the same secret is configured in GitHub's webhook settings (Settings → Webhooks → [webhook] → Secret)

**Fix:**
- Ensure both the server and GitHub have the exact same secret value
- If rotating the secret:
  1. Update the secret in your `.env` or via the secrets vault in the UI.
  2. Restart the server
  3. Update the secret in GitHub's webhook settings
  4. Test with a fresh webhook delivery
- If you don't know the current secret, generate a new one and update both sides simultaneously

---

## Webhook 404 "unknown product: X"

**Symptom:** Webhook delivery returns HTTP 404 with: `Unknown product: "my-app"`

**Diagnostics:**
- The webhook URL path should match a product ID registered in the database.
- Check the webhook URL: `POST http://server/webhooks/<productId>/<source>`

**Fix:**
- Update the webhook URL in GitHub/GitLab to use the correct product ID
- Confirm the product exists in the database with the correct ID.
- Test the webhook delivery again

---

## Duplicate runs for the same ticket

**Symptom:** Multiple runs are created for a single ticket event (e.g., a label was added, and it triggered 2–3 runs).

**Cause:** Run deduplication is in-process only. If you have multiple server replicas running, each may independently create a run for the same webhook event.

**Fix:**
- Scale down to a single server replica
- Or implement an atomic state store (e.g., Postgres) with optimistic locking for the webhook endpoint
- Alternatively, use a message queue (e.g., RabbitMQ) to ensure only one replica processes each webhook event

---

## `getTicket` returns no ticket

**Symptom:** A step fails with: `AdapterError: getTicket: missing field "ticket"`

**Diagnostics:**
- The ticket provider could not find the ticket by ID
- Check the ticket ID format for your provider:
  - **GitHub Issues:** format is `"owner/repo#number"` (e.g., `"acme/platform#42"`)
  - **Jira:** format is the issue key (e.g., `"PROJ-123"`)
  - **Linear:** format is the issue ID (e.g., `"issue_abc123xyz"`)
- Verify the ID is correctly parsed from the webhook payload

**Fix:**
- Ensure the ticket ID format matches the provider's expectations
- For GitHub Issues, verify the webhook payload contains the correct owner, repo, and issue number
- Test `getTicket` manually: `curl http://localhost:3000/api/tickets/<providerId>/<ticketId>`
- Verify the provider's API token has read access to the ticket

---

## Cleanup step failed

**Symptom:** A cleanup step (e.g., `cleanup-artifacts`) is marked failed, but the overall run still reached its target status.

**Diagnostics:**
- Check the flow YAML for the cleanup step's `onFailure` setting
- If `onFailure: skip`, the run will continue even if cleanup fails
- Inspect the cleanup step's log: `tail workspaces/<product>/logs/<sessionId>/<cleanupStepId>.log`

**Fix:**
- If cleanup is optional, `onFailure: skip` is correct — no action needed
- If cleanup should block the run, change to `onFailure: fail` in the flow YAML
- For orphaned artifacts/directories, run the retention sweep manually:
  ```bash
  journeyman sweep --product <productId> --older-than 7d
  ```
- Or implement a scheduled retention policy to clean up automatically

---

## `EADDRINUSE` on server start

**Symptom:** Server fails to start with: `Error: listen EADDRINUSE: address already in use :::3000`

**Diagnostics:**
- Another process is already listening on the configured port (default 3000)
- Check which process: `lsof -i :3000`

**Fix:**
- Kill the other process: `kill -9 <pid>`
- Or change the server port via the `PORT` env var in `.env`
- Restart the server

---

## "no webhook secret configured"

**Symptom:** Webhook delivery returns an error: `No webhook secret configured for source: github`

**Diagnostics:**
- The server cannot verify webhook signatures because the secret is not set
- Check if the secret is defined:
  - Via environment variable: `GITHUB_WEBHOOK_SECRET` (or source-specific env vars)
  - Via config: `products.<id>.webhookSecrets.github` or `server.webhooks.github.secretEnv`

**Fix:**
- Set the webhook secret via environment variable:
  ```bash
  export GITHUB_WEBHOOK_SECRET="your-secret-here"
  ```
- Or set it in `.env`:
  ```bash
  GITHUB_WEBHOOK_SECRET=your-secret-here
  ```
- Restart the server and update the webhook in GitHub's settings

---

## Claude SDK rate-limited

**Symptom:** `analyze`, `plan`, or `implement` steps fail with quota/rate-limit errors from Claude API (HTTP 429 or similar).

**Diagnostics:**
- Check the Claude API usage dashboard for your API key
- Verify the `ANTHROPIC_API_KEY` is valid and has quota remaining
- If multiple runs are in progress, they may be contending for API quota

**Fix:**
- Reduce the `concurrency` setting in the product config to limit parallel runs
- Stagger run triggers (e.g., space out webhook events or manual triggers)
- Upgrade to a higher-tier API key or account if quota is the bottleneck
- Wait for quota to reset if it's a temporary limit

---

## Artifact file missing from `/api/runs/:id/artifacts/:key`

**Symptom:** A GET request to `/api/runs/<sessionId>/artifacts/<key>` returns HTTP 404.

**Diagnostics:**
- The artifact may not have been written to storage
- Check the run state: `jq '.artifacts | .. | select(type=="object" and .kind=="artifact")' workspaces/<product>/state/<sessionId>.json`
- Look for the artifact entry — if it's missing `reportHandle`, it was never persisted
- Check the phase code that produced the artifact — it should call `artifactStore.putPath()`

**Fix:**
- Verify the phase that creates the artifact actually calls `artifactStore.putPath()` with the correct key
- Check the phase's logs for write errors: `tail workspaces/<product>/logs/<sessionId>/<phaseId>.log`
- Manually check the artifact store directory: `ls -la workspaces/<product>/artifacts/<sessionId>/`
- If missing, re-run the phase that produces the artifact

---

## State file corrupt JSON

**Symptom:** State file cannot be read: `SyntaxError: Unexpected token ...`

**Diagnostics:**
- State files use atomic writes, so this is very rare
- Check for incomplete writes: `ls -la workspaces/<product>/state/ | grep "\.tmp-"`
- Any `.tmp-*` files are partial writes that should have been cleaned up

**Fix:**
- Inspect the corrupt file to understand what happened: `cat workspaces/<product>/state/<sessionId>.json`
- Move it aside temporarily: `mv workspaces/<product>/state/<sessionId>.json workspaces/<product>/state/<sessionId>.json.bak`
- The next run will overwrite the state file with a fresh one
- If you need to recover the run, restore from the backup and manually fix the JSON

---

## Quick Reference: Common Diagnostic Commands

```bash
# Watch a live run's event stream
curl -N -H "Authorization: Bearer $TOK" http://localhost:3000/api/runs/<sessionId>/stream

# Tail a step's log in real time
tail -f workspaces/<product>/logs/<sessionId>/<stepId>.log

# Inspect artifact handles in the state file
jq '.artifacts | .. | select(type=="object" and .kind=="artifact")' workspaces/<product>/state/<sessionId>.json

# Find all stuck runs (status=running)
jq 'select(.status=="running")' workspaces/*/state/*.json

# Check for temporary/partial writes
ls -la workspaces/*/state/ | grep "\.tmp-"

# List all runs in a product
jq '.metadata.sessionId' workspaces/<product>/state/*.json | sort | uniq

# Inspect the last step of a run
jq '.steps[-1]' workspaces/<product>/state/<sessionId>.json

# Check webhook secrets via the secrets vault in the UI or in .env

# Monitor server logs (if using systemd)
journalctl -u journeyman-pipeline -f

# Manually trigger a run for a product
curl -X POST http://localhost:3000/api/trigger/<productId> \
  -H "Content-Type: application/json" \
  -d '{"ticketId":"PROJ-123","source":"manual"}'
```
