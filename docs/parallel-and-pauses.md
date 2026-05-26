# Parallel Branches and Pause Nodes

This doc covers four node types that let your workflow pause for input, wait for external events, and run work in parallel:

| Node | What it does |
|---|---|
| **Human Task** (`human-task`) | Pause for a person to fill a form |
| **Webhook Wait** (`webhook-wait`) | Pause until a matching provider webhook arrives |
| **Fork** (`gateway-and`) | Split flow into parallel branches |
| **Join** (`join`) | Wait for branches; decide how to handle errors |

All four are first-class nodes in the canvas editor.

---

## Human Task

> Pause for a person to do something. Resume when they fill the form in the app.

### Author-time

Drop a **Human Task** node. Configure:

- **Instructions** (`prompt`) — what the person sees, e.g. *"Approve deploy to prod?"*
- **Outputs** — form fields the human fills in. Each has `name`, `type` (`string` / `number` / `boolean` / `date` / `json`), optional `required` flag, optional `default`.
- **Notify** *(optional)* — Slack DM or console log dispatched when the task pauses. The notification carries a deep link to the resolve page.
- **Timeout** *(optional)* — `duration` (e.g. `48h`) + JSON `defaults`. When the timeout fires, the declared outputs are filled from `defaults` and the workflow resumes automatically.

### Runtime

1. The workflow reaches the node → Conductor pauses.
2. The task appears in the user's pending-tasks list.
3. If `notify` is set, a notification goes out (best-effort; failure does not fail the workflow).
4. The person opens the task, fills the form, hits **Submit**.

`POST /workflow-instances/:workflowInstanceId/human-tasks/:nodeId/resolve` with `{ values: {...} }`. Workflow resumes.

### Output artifact

```ts
type HumanTaskOutput = {
  source: "manual" | "timeout";
  actor: string | null;
  resolvedAt: string;
  payload: Record<string, unknown>;   // { ...form values } for manual; {} for timeout
} & Record<string, unknown>;          // declared fields spread at top level
```

Downstream nodes reference `humanTask1.<fieldName>` and meta keys `humanTask1.source`, `.actor`, `.resolvedAt`.

### What's NOT on this node

`listensFor`, `acceptIf`, and `fromPath` do **not** exist on `human-task`. Those concepts belong to `webhook-wait`. A human task is purely person-driven; webhooks never resolve a human task.

---

## Webhook Wait

> Pause until a matching external event arrives.

### Author-time

Drop a **Webhook Wait** node. Configure:

- **Provider** — `jira` / `github` / `gitlab` / `monday` / `linear` / `api`. Determines which inbound webhook endpoint feeds this node.
- **Listens for** (`listensFor`) — comma-separated event-type allowlist. Empty means accept any event from the provider.
- **Accept if** (`acceptIf`) — optional JSONLogic predicate evaluated on the raw payload. Use the visual builder or hand-write JSON.
- **Correlation** (`correlationKey`) — how this paused node binds to incoming events. v1 supports `"issueRef"` only — the workflow's `issueRef` is matched against the event's extracted ref.
- **Outputs** — declared fields. Each has an optional `fromPath` (dot-path into the webhook payload) — the matcher pulls the value at that path into the output.
- **Timeout** *(optional)* — same `duration` + `defaults` as Human Task.

### Runtime

1. Workflow pauses at the node.
2. Event arrives at `POST /webhooks/:provider` (legacy) or `POST /webhooks/in/:tenantToken` (registry).
3. Router looks for `webhook-wait` nodes whose correlation matches the event:
   - Provider matches
   - Event type is in `listensFor` (or `listensFor` is empty)
   - `acceptIf` predicate evaluates truthy
4. If a candidate matches: outputs are extracted via each declared field's `fromPath`, a resolution row is written (`source = "webhook"`), and the workflow resumes.
5. If no waiter matches: the router falls through to workflow trigger matching (start a new workflow).

### Output artifact

```ts
type WebhookWaitOutput = {
  source: "webhook" | "timeout";
  resolvedAt: string;
  webhookEventId: string | null;
  payload: Record<string, unknown>;   // raw webhook body
} & Record<string, unknown>;           // declared fields spread at top level
```

### One webhook URL per provider — internal routing

You only configure **one URL per provider** in Jira/GitHub/GitLab/etc. The internal router decides per event:

1. Does any paused `webhook-wait` match? → resume it.
2. Otherwise, does any workflow trigger match? → start a new workflow.
3. Otherwise → log as `ignored`.

Resume always takes priority over trigger.

---

## Fork (Parallel) and Join

> Run branches in parallel; wait for them with a chosen error mode.

The two nodes always come as a **pair**. Every Fork must have a matching Join.

```
        ┌── Step A1 ── Step A2 ──┐
─ Fork ─┤                        ├─ Join ─ Next step
        └── Step B1 ──────────────┘
```

### Fork (`gateway-and`)

Just splits flow. Config: optional description. The Fork has no error mode — that lives on the Join.

Constraints:
- Exactly 1 incoming edge.
- ≥ 2 outgoing edges. Each outgoing edge is a branch.
- Every branch must reach the paired Join (no branch may escape to an `end` node or to a different Join).

### Join (`join`)

Waits for branches; decides what to do.

**Error mode** — pick one:

| Mode | Behavior |
|---|---|
| `fail-fast` *(default)* | First branch error cancels the others; workflow fails. |
| `wait-all` | Let every branch finish (success or error). Workflow fails only if **all** branches failed. |
| `wait-all-strict` | Let every branch finish. Workflow fails if **any** branch failed. |
| `first-wins` | First branch to **succeed** wins; the others are cancelled. Workflow continues with the winner's output. |

**`first-wins` v1 restriction:** branches may only contain pause nodes (`human-task`, `webhook-wait`, `timer`). Step nodes are not allowed — the editor flags any step inside a first-wins branch as a validation error. This restriction exists because in-flight work (Claude calls, git operations) cannot be cleanly cancelled mid-flight. It will be lifted when proper step cancellation lands.

### Branches can contain anything (subject to the first-wins rule)

A branch can be:
- A single step.
- A long chain of steps.
- An `if`/`gateway-xor` with its own legs (which must close before the branch reaches the Join).
- A nested `human-task`, `webhook-wait`, or `timer`.
- A nested Fork/Join pair (which must close inside the outer branch).

The only hard rule: **every path leaving the Fork must end at the matching Join.**

### Topology rules (enforced in the editor)

The editor refuses to publish if any of these fail:

- Every Fork has exactly one matching Join.
- Every Join has exactly one matching Fork.
- Every branch from a Fork reaches its paired Join (no early `end`s).
- The Join has exactly one incoming edge per branch.
- No node belongs to two branches at once (no shared steps across branches).
- `first-wins` joins have only pause nodes in every branch.

### Output references downstream

After the Join, later nodes have two ways to read branch outputs:

**1. Direct by node id** (works for all error modes):

```
stepA.field        # output of Step A
stepB.field        # output of Step B
```

For `first-wins`, only the **winning branch's** node refs will have defined values at runtime.

**2. Through the Join node** (modes that produce structured results):

```ts
joinNode.winner               // first-wins only — branch head node id of the winner
joinNode.output               // first-wins only — winning branch's last node output
joinNode.results[<branchHeadId>] = {   // wait-all / wait-all-strict
  status: "success" | "error" | "cancelled",
  output: <last node output> | null,
  error?: string,
}
```

The Join's properties panel renders the exact output shape based on the chosen mode.

### Runtime

- The Fork shows `running` while any branch is active.
- Each branch's nodes show status independently — one branch can be `done` while another is `running` or `waiting`.
- The Join shows `waiting` until the mode's completion condition is met.
- For `fail-fast` and `first-wins`: cancelled branch tasks are marked completed with cancellation metadata (`outputData.cancelled = true`). Downstream of the Join continues with the winner's output.

---

## End-to-end example: "human OR webhook, whichever first"

The classic use case for `first-wins`: pause until **either** a human approves **or** Jira moves the issue to Done, whichever comes first.

```
                    ┌── human-task (Approve in app?) ──┐
─ get-issue ─ Fork ─┤                                  ├─ Join ─ deploy-step
                    └── webhook-wait (jira status=Done) ┘
                              ↑ first-wins mode
```

Setup:
- Fork has two outgoing branches.
- Branch A: a single `human-task` asking *"Approve deploy?"*, output `approved: boolean`, optional Slack notify.
- Branch B: a single `webhook-wait` listening for Jira `issue_updated` with `acceptIf: { "==": [{ "var": "issue.fields.status.name" }, "Done"] }`, output `jiraStatus: string` via `fromPath: "issue.fields.status.name"`.
- Join: `mode: "first-wins"`.
- Downstream `deploy-step` references `join.output` (works regardless of which branch won) or `humanTask1.approved` / `webhookWait1.jiraStatus` (only the winner's branch will have a real value).

Result: whichever finishes first wins; the other branch's paused task is cancelled cleanly with no wasted work.

---

## Migration from legacy `human-task` shape

Workflows authored before the split had `listensFor`, `acceptIf`, and `fromPath` directly on `human-task` nodes. On read, the orchestrator auto-converts any `human-task` carrying those fields into a `webhook-wait` node. The migration is read-time only — the stored definition on disk is unchanged until the workflow is next saved. No manual action required.

After the split:
- `human-task` is purely person-driven.
- `webhook-wait` is purely system-driven.
- Authors no longer see webhook config on a human node, or notification config on a webhook node.
