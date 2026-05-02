# Flow YAML: Reference & Authoring Guide

## Overview

A **flow** is a reusable blueprint that automates ticket → PR workflows. Flows are products-agnostic — multiple products can reference the same flow, with status names and provider settings varying per-product. Flows are created and managed in the flow editor UI and stored in the database.

Each flow defines:
- **Providers** — which ticket/git/coding/notification implementations to use (by id)
- **Steps** — ordered list of phases with configuration, retry logic, and failure handling

Flows are loaded by the `PipelineConfigLoader` at boot and validated by `FlowValidator`, which checks:
- All referenced phases are registered
- All referenced providers exist
- Step artifacts form a valid DAG (no missing dependencies)
- Status names match product configuration

---

## Schema

### Top-Level Fields

```yaml
name: string              # Unique flow identifier (e.g. "edgereg-default")
providers:                # One provider id per category
  ticket: string          # e.g. "github-issues"
  git: string             # e.g. "github"
  coding: string          # e.g. "claude"
  notification: string    # e.g. "slack"
steps: FlowStepDefinition[]  # Ordered phase executions
```

**Types:**
- `name`: string, min 1 char
- `providers`: object with exactly 4 keys (`ticket`, `git`, `coding`, `notification`), each a non-empty string
- `steps`: array of objects (see Step schema below), min 1 entry

### Step Definition

Each step describes one phase execution:

```yaml
id: string                # Optional; unique within flow (defaults to phase name)
phase: string             # Registry key (e.g. "getTicket", "analyze")
config: object            # Phase-specific config (optional, varies by phase)
retry:                    # Optional retry policy
  attempts: number        # How many attempts total (>= 1)
  backoffMs: number       # Delay between retries in milliseconds (>= 0)
timeoutMs: number         # Max execution time for this step (optional)
onFailure: string         # One of: fail | skip | retry | block (optional, defaults to "fail")
```

**Field Details:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `id` | string | phase name | Unique within flow; used in trace logs and resume operations |
| `phase` | string | required | Must be a registered phase key |
| `config` | object | {} | Interpreted by the phase; unknown keys are silently ignored |
| `retry.attempts` | number | none | Total attempts (initial + retries); ignored if `onFailure` ≠ "retry" |
| `retry.backoffMs` | number | 0 | Fixed delay between retries; exponential backoff deferred to v2 |
| `timeoutMs` | number | infinite | Timeout enforcement is phase-dependent (soft advisory for now) |
| `onFailure` | enum | "fail" | Determines behavior when step fails; see Failure Policies below |

---

## Providers Block

The `providers` block wires each category to a concrete implementation:

```yaml
providers:
  ticket: "github-issues"       # ITicketProvider impl
  git: "github"                 # IGitProvider impl
  coding: "claude"              # ICodingCLI impl
  notification: "slack"         # INotificationProvider impl
```

**Provider Categories & Examples:**

| Category | Impls | Notes |
|----------|-------|-------|
| `ticket` | `github-issues`, `jira`, `linear`, `monday` | Must support `getTicket()`, `updateStatus()`, `addComment()` |
| `git` | `github`, `gitlab` | Must support `createPR()`, `listPRs()` |
| `coding` | `claude`, `gemini`, `codex` | Must support `analyze()`, `plan()`, `implement()` |
| `notification` | `slack` | Must support `notify()` |

**How Providers Are Resolved:**

Provider ids in the flow are matched against `IProviderMeta.id` from registered instances. At runtime, `ProviderRegistry.resolveForProduct(productId)` looks up each provider in the product's `providerConfig` and instantiates it with per-product settings.

---

## Steps[] Entries — Full Field Reference

### Step ID vs Phase Name

**Step `id`** and **phase name** are separate for a reason: **a flow can run the same phase multiple times with different configurations**.

Example: `updateStatus` appears twice—once to mark in-progress, once to mark completed.

```yaml
steps:
  - id: "mark-in-progress"    # Step id (unique within flow)
    phase: "updateStatus"     # Phase name (can repeat)
    config:
      status: "in-progress"

  - id: "analysis"
    phase: "analyze"
    config:
      outputFormat: "markdown"

  - id: "mark-completed"      # Same phase, different step
    phase: "updateStatus"
    config:
      status: "completed"
```

If `id` is omitted, it defaults to the phase name. Using default ids with repeated phases will fail validation (step id must be unique).

### Config Field

The `config` field is phase-specific and interpreted by each phase's `run()` method. Examples:

**`updateStatus` phase:**
```yaml
config:
  status: "in-progress"  # Semantic status name (mapped to literal value by product)
```

**`analyze` phase:**
```yaml
config:
  outputFormat: "json"   # Phase determines which fields to include
  context: "full"
```

**`requireField` phase (validation gate):**
```yaml
config:
  field: "assignee"      # Ticket field that must be non-null
  message: "Task requires assignee"
```

Unknown config keys are silently ignored.

### Failure Policies

The `onFailure` field controls step-level recovery:

| Value | Behavior | Use Case |
|-------|----------|----------|
| `fail` (default) | Stop run, mark as failed, no retries | Critical steps (getTicket, createPR) |
| `skip` | Run continues, step treated as ok | Side effects (notifications, optional comments) |
| `retry` | Re-execute using `retry.attempts` and `retry.backoffMs` | Transient failures (API rate limits, network flakes) |
| `block` | Run pauses, waits for manual or external resumption | Review loops, approval gates |

**Example: soft-fail comment step**
```yaml
- id: "notify-in-pr"
  phase: "addComment"
  config:
    message: "Analysis complete"
  onFailure: "skip"  # PR comment failing doesn't stop the run
```

**Example: retry on flaky API**
```yaml
- id: "create-pr"
  phase: "createPR"
  config:
    draftMode: false
  retry:
    attempts: 3
    backoffMs: 2000
  onFailure: "retry"  # Retries on failure
```

---

## Flow Resolution Order

When a webhook or API call triggers a run, the flow name is resolved in this order:

1. **Explicit `flowName` in trigger** (highest priority)
   ```json
   POST /api/runs
   { "productId": "edgereg", "ticketKey": "edgereg/edgereg-api#42", "flowName": "custom-flow" }
   ```

2. **Product's `flow` setting** (second)
   ```yaml
   products:
     edgereg:
       flow: "edgereg-default"  # Used if trigger doesn't specify flowName
   ```

3. **`defaultFlow`** (fallback)
   ```yaml
   defaultFlow: "standard"  # Used if product has no explicit flow
   ```

---

## Authoring a New Flow

### Step-by-Step Walkthrough

Let's create a minimal 3-step flow: get ticket → analyze → implement.

**1. Plan the steps:**
- Load ticket details
- Run analysis on repo
- Implement changes

**2. Identify artifacts:**
- `getTicket` writes `ticket`
- `analyze` reads nothing, writes `analysis`
- `implement` reads `analysis`, writes `implementResults`

**3. Declare providers:**
Choose one id per category (must match registered providers).

**4. Write the YAML:**

```yaml
name: minimal-example

providers:
  ticket: "github-issues"
  git: "github"
  coding: "claude"
  notification: "slack"

steps:
  - id: "fetch-ticket"
    phase: "getTicket"
    # No config; phase uses context.ticketKey automatically

  - id: "code-analysis"
    phase: "analyze"
    config:
      outputFormat: "markdown"
      includeMetrics: true
    timeoutMs: 300000  # 5 minutes max
    onFailure: "fail"  # Critical; stop if analysis fails

  - id: "implement-changes"
    phase: "implement"
    config:
      strategy: "incremental"
    retry:
      attempts: 2
      backoffMs: 5000
    onFailure: "fail"  # Also critical
```

**5. Save the flow** in the flow editor UI.

**6. Assign to a product** by selecting the flow in the product's settings in the UI.

**7. Run and validate:**

Trigger a run via the UI or API. If steps fail, the run log will report missing artifacts or unknown phases.

---

## Complete Reference Flow

Here's an annotated 11-step flow resembling edgereg-default:

```yaml
name: edgereg-default
# Description: Full ticket-to-PR workflow with analysis, planning, implementation, review, PR creation, and cleanup.

providers:
  ticket: "github-issues"           # ITicketProvider: GitHub issue tracker
  git: "github"                     # IGitProvider: GitHub REST API
  coding: "claude"                  # ICodingCLI: Claude Agent SDK
  notification: "slack"             # INotificationProvider: Slack webhook

steps:
  # --- Phase 1: Setup ---
  - id: "get-ticket"
    phase: "getTicket"
    # Writes: ticket, ticketMd
    # No config; phase uses context.ticketKey
    onFailure: "fail"

  - id: "require-assignee"
    phase: "requireField"
    # Writes: nothing (validation gate)
    config:
      field: "assignee"
      message: "Ticket must have assignee before processing"
    onFailure: "fail"

  # --- Phase 2: Clone and Analyze ---
  - id: "clone-repos"
    phase: "cloneRepos"
    # Writes: cloned
    config:
      shallow: false
      sshKey: "${SSH_KEY_ENV}"  # Optional env var substitution (phase-handled)
    timeoutMs: 600000  # 10 minutes
    onFailure: "fail"

  - id: "analyze-code"
    phase: "analyze"
    # Reads: ticket, ticketMd
    # Writes: analysis, reportPath
    config:
      outputFormat: "markdown"
      includeMetrics: true
      maxFileSize: 1000000  # bytes
    timeoutMs: 1200000  # 20 minutes
    retry:
      attempts: 2
      backoffMs: 10000  # 10 seconds between retries
    onFailure: "fail"

  # --- Phase 3: Plan & Implement ---
  - id: "plan-changes"
    phase: "plan"
    # Reads: ticket, analysis
    # Writes: plan
    config:
      iterationLimit: 5
    timeoutMs: 600000
    retry:
      attempts: 1
      backoffMs: 0
    onFailure: "fail"

  - id: "implement-changes"
    phase: "implement"
    # Reads: plan
    # Writes: implementResults
    config:
      applyChanges: true
    timeoutMs: 1800000  # 30 minutes
    onFailure: "fail"

  # --- Phase 4: Commit & PR ---
  - id: "commit-push"
    phase: "commitPush"
    # Reads: implementResults
    # Writes: commitInfo
    config:
      message: "Auto-fix: {{ticket.title}}"  # Phase interpolates from artifacts
      branch: "claude/{{ticket.shortKey}}"
    onFailure: "fail"

  - id: "create-pr"
    phase: "createPR"
    # Reads: commitInfo, analysis
    # Writes: prInfo
    config:
      draftMode: false
      titleTemplate: "{{ticket.title}} ({{ticket.shortKey}})"
      bodyTemplate: |
        Closes {{ticket.key}}
        
        ## Analysis
        {{analysis}}
    onFailure: "fail"

  # --- Phase 5: Finalization ---
  - id: "mark-in-progress"
    phase: "updateStatus"
    # Reads: ticket
    # Writes: statusHistory
    config:
      status: "in-progress"  # Semantic status; mapped to literal via product config
    onFailure: "skip"  # Soft-fail; PR is already created

  - id: "notify-slack"
    phase: "notify"
    # Reads: ticket, prInfo
    # Writes: notificationSent
    config:
      channel: "engineering"
      template: "pr-created"
    onFailure: "skip"  # Notification failure doesn't block

  - id: "cleanup"
    phase: "cleanupRepos"
    # Writes: cleaned
    config:
      removeClones: true
    onFailure: "skip"  # Always attempt cleanup, even if prior steps fail
```

**Artifacts Flow:**
```
getTicket
  ├─ ticket ──────────┬──→ requireField
  │                   ├──→ analyze
  │                   └──→ plan
  └─ ticketMd

cloneRepos
  └─ cloned

analyze
  ├─ analysis ──────────────────────┬──→ plan
  │                                 └──→ createPR
  └─ reportPath

plan
  └─ plan ──────→ implement

implement
  └─ implementResults ──→ commitPush

commitPush
  └─ commitInfo ──────→ createPR

createPR
  ├─ prInfo ──────────┬──→ updateStatus
  │                   └──→ notify
  └─ (writes prInfo for artifact store)

updateStatus
  └─ statusHistory

cleanup (final)
```

---

## Reusing Flows

### Across Products

Multiple products can reference the same flow. In the UI, set each product's flow to the same flow ID.

  another-product:
    flow: "standard"            # Same flow!
    workspace: "/tmp/another"
    repos:
      - providerId: "github"
        owner: "another-org"
        repo: "another-repo"
        url: "https://github.com/another-org/another-repo"
        defaultBranch: "main"
```

### Per-Product Status Mappings

Even though both use the same flow, status names can differ via `ticketWorkflow.statuses`:

```yaml
products:
  edgereg:
    flow: "standard"
    ticketWorkflow:
      statuses:
        in-progress: "In Progress"      # Literal GitHub issue label/status
        completed: "Done"
        blocked: "On Hold"

  another-product:
    flow: "standard"
    ticketWorkflow:
      statuses:
        in-progress: "active"           # Different literal values
        completed: "resolved"
        blocked: "waiting-on-external"
```

At runtime, when the flow's `updateStatus` phase runs with `config.status: "in-progress"`, it looks up the semantic name in the product's `statuses` map and uses the literal value. No flow modification needed.

---

## Common Patterns

### Validation Gates

Use `requireField` to block processing until a ticket property is set:

```yaml
- id: "gate-unassigned"
  phase: "requireField"
  config:
    field: "assignee"
    message: "Ticket must be assigned before processing"
  onFailure: "block"  # Pause; wait for manual assignment
```

Supported fields vary by provider; GitHub issues support `assignee`, `labels`, `milestone`, etc.

### Soft-Fail Side Effects

Comment and notification steps should rarely block the run:

```yaml
- id: "post-comment"
  phase: "addComment"
  config:
    message: "PR ready for review: {{prInfo.url}}"
  onFailure: "skip"  # If PR comment API fails, continue

- id: "slack-notification"
  phase: "notify"
  config:
    channel: "reviews"
    template: "pr-created"
  onFailure: "skip"
```

### Retries on Flaky Integrations

External APIs may rate-limit or timeout. Use retry for transient failures:

```yaml
- id: "create-pr"
  phase: "createPR"
  config:
    draftMode: false
  retry:
    attempts: 3
    backoffMs: 5000  # 5 seconds between retries
  onFailure: "fail"  # After 3 attempts, stop

- id: "list-existing-prs"
  phase: "listPRs"  # Idempotency preflight
  retry:
    attempts: 2
    backoffMs: 2000
  onFailure: "fail"
```

### Status Transitions

Mark workflow progress at key milestones:

```yaml
- id: "mark-in-progress"
  phase: "updateStatus"
  config:
    status: "in-progress"
  onFailure: "skip"

# ... analysis, implementation ...

- id: "mark-review"
  phase: "updateStatus"
  config:
    status: "review"
  onFailure: "skip"

- id: "mark-completed"
  phase: "updateStatus"
  config:
    status: "completed"
  onFailure: "skip"
```

---

## Validation

### Boot-Time Checks

`FlowValidator.validate()` runs at pipeline startup and checks:

1. **Phase existence** — all `phase` names are registered
2. **Provider existence** — all provider ids match registered instances
3. **Artifact DAG** — `reads` ⊆ `writes` from prior steps (no missing dependencies)
4. **Defaults** — `defaultFlow` exists
5. **Product flows** — each product's flow exists
6. **Status names** — semantic statuses in `updateStatus` steps match `product.ticketWorkflow.statuses`

**Example error output:**
```
Flow "edgereg-default" step "plan-changes" (phase plan) needs artifacts [analysis]
that no earlier step produces. Available: [ticket, ticketMd, cloned].
```

### Flow File Format

Flows are YAML with optional environment variable substitution:

```yaml
name: my-flow

# Env var substitution (phase-handled)
providers:
  ticket: "github-issues"
  git: "github"
  coding: ${CODING_PROVIDER:-claude}  # Default to "claude"
  notification: "slack"

steps: [...]
```

### Linting

No automated linting yet; manual review checklist:

- [ ] All `phase` names valid and registered
- [ ] All `config` keys match phase expectations (unknown keys silently ignored)
- [ ] Step `id`s are unique within flow
- [ ] Artifact reads match prior writes
- [ ] Retry `attempts` >= 1, `backoffMs` >= 0
- [ ] `onFailure` is one of: fail, skip, retry, block
- [ ] Provider ids match registered instances
- [ ] Semantic status names exist in all relevant products

---

## Tips for Authoring

1. **Start with a single-product flow** — get one working before generalizing.
2. **List artifacts explicitly** — add comments above each step noting reads/writes.
3. **Fail fast** — mark critical steps `onFailure: "fail"` (getTicket, createPR).
4. **Soft-fail side effects** — mark notifications/comments `onFailure: "skip"`.
5. **Use step ids** — even if phase-default would work, explicit ids aid debugging.
6. **Test flow resolution** — validate config at boot: `npm run pipeline -- validate-config`.
7. **Reserve `status`** — use semantic names in `updateStatus.config.status` (mapped per product).
8. **Timeout conservatively** — set `timeoutMs` for long-running phases (analyze, implement).
9. **Retry sparingly** — only for known transients; don't retry hard errors.
10. **Document assumptions** — add comments about provider capabilities and limits.

---

## Human review loops

The `reviewLoop` phase lets a flow gate any automated step on a human approval carried via a ticket status change, and re-run rework sub-phases until the reviewer approves. It is the canonical way to add human-in-the-loop checkpoints between `analyze` / `plan` / `implement` / PR review.

### Diagrams

- [Overview](./diagrams/human-loop-overview.svg) — full pipeline with three `reviewLoop` gates and the human interaction lane.
- [Sequence](./diagrams/human-loop-sequence.svg) — swim-lane walkthrough of one code-review rework cycle.
- [State machine](./diagrams/human-loop-states.svg) — BLOCKED ↔ REWORKING → DONE | FAILED transitions across successive resumes.

### Config keys

Each `reviewLoop` step takes these config keys:

| Key | Type | Required | Description |
|---|---|---|---|
| `approveStatus` | string | Yes | Semantic status name that exits the loop with `ok` — must exist in `productConfig.ticketWorkflow.statuses`. |
| `reworkStatus` | string | Yes | Semantic status name that triggers the `onRework` sub-phases and re-blocks. |
| `onRework` | string[] | Yes | Ordered list of phase registry keys to run on each rework cycle (e.g. `[fetchPRComments, plan, implement, commitPushRepos]`). |
| `maxCycles` | number | No | Default `3`. When exceeded the phase fails the run. |

The `awaitTicketStatus` phase is a lighter-weight alternative for a one-shot "pause until human approves" gate with no rework sub-phases — it takes `continueOn: string[]` and optional `failOn: string[]`.

Misconfiguration of `onRework` (e.g. a typo in a sub-phase name, or a sub-phase that reads an artifact no prior step produced) is only caught at run time, not by the static flow validator — sub-phases are invoked lazily from `PhaseRegistry` and are not surfaced as their own steps.

### Ready-to-use flow (human-loop)

```yaml
name: human-loop

providers:
  ticket:       github-issues
  git:          github
  coding:       claude
  notification: slack

steps:
  - id: fetch-ticket
    phase: getTicket

  - id: clone
    phase: cloneRepos
    timeoutMs: 120000

  - id: mark-in-progress
    phase: updateStatus
    config: { status: development-started }
    onFailure: skip

  - id: checkout
    phase: checkoutRepo

  - id: analyze
    phase: analyze

  - id: notify-analyze-ready
    phase: notify
    config: { message: "Analysis ready for #{ticket}" }
    onFailure: skip

  - id: analyze-review
    phase: reviewLoop
    config:
      approveStatus: analyze-approved
      reworkStatus: analyze-rework
      maxCycles: 2
      onRework: [fetchTicketComments, analyze]

  - id: plan
    phase: plan

  - id: notify-plan-ready
    phase: notify
    config: { message: "Plan ready for #{ticket} — please approve" }
    onFailure: skip

  - id: plan-review
    phase: reviewLoop
    config:
      approveStatus: plan-approved
      reworkStatus: plan-rework
      maxCycles: 3
      onRework: [fetchTicketComments, plan]

  - id: implement
    phase: implement

  - id: commit-push
    phase: commitPushRepos
    config:
      pattern: "#{ticket} : {summary}"

  - id: open-pr
    phase: createPR
    onFailure: skip

  - id: notify-pr-ready
    phase: notify
    config: { message: "PR ready for #{ticket}" }
    onFailure: skip

  - id: mark-in-review
    phase: updateStatus
    config: { status: code-review }
    onFailure: skip

  - id: code-review
    phase: reviewLoop
    config:
      approveStatus: completed
      reworkStatus: rework-requested
      maxCycles: 3
      onRework: [fetchPRComments, plan, implement, commitPushRepos]

  - id: notify-complete
    phase: notify
    config: { message: "#{ticket} completed" }
    onFailure: skip

  - id: cleanup
    phase: cleanupRepos
    onFailure: skip
```

Products opt in by setting `flow: human-loop` and mapping the semantic status names (`analyze-approved`, `analyze-rework`, `plan-approved`, `plan-rework`, `code-review`, `rework-requested`, `completed`, `failed`) to the literal status values used by the ticket provider. See [docs/configuration.md](./configuration.md#semantic-status-names-for-review-loops) for the full list.

---

## References

- **Core types:** `packages/core/src/types/pipeline.types.ts`
- **Phase registry:** `packages/phases/src/catalog.ts`
