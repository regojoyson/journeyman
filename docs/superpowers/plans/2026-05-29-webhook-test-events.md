# More Webhook Test Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a common set of sample webhook events for GitHub (code + issues), Jira, and GitLab, and make a test fire set the event-type header for header-based providers so GitHub test events resolve their type.

**Architecture:** Sample events are JSON files under `packages/webhooks/presets/<provider>/samples/` declared in each `preset.json`'s `sampleEvents` map; the loader and test-panel dropdown already handle any number. A single code change in the test route sets the event-type header (e.g. `x-github-event`) from the chosen sample key for header-based providers; body-based providers (Jira/GitLab) already carry the type in the payload.

**Tech Stack:** TypeScript (ESM, `.ts` import extensions), JSON preset manifests + sample files, Fastify test route. Tests are assert-based `.test.ts` files run with `npx tsx <file>` (the webhooks/api-server packages have no test runner).

**User constraints (override skill defaults):**
- **Do NOT commit** at any point. There are no `git commit` steps in this plan.
- **Run `npm run typecheck` at the very end** (final task) as the completion gate.

**Spec:** `docs/superpowers/specs/2026-05-29-webhook-test-events-design.md`

**Background facts (verified against the code):**
- Samples are minimal/compact: ingest schema validation defaults to `"off"`, preset schemas have no `required` fields and `additionalProperties: true`, and the loader only `JSON.parse`s samples (no schema check). So new samples need only the event-type field + a few representative fields.
- `loadAllPresets()` / `getPreset(id)` live in `packages/webhooks/src/presets/loader.ts`; `samples` is keyed by the `sampleEvents` keys.
- `load()` in the test route returns the full `Webhook`, which has `eventTypePath?: string`.
- For GitHub the sample **key** equals the `X-GitHub-Event` value. For Jira/GitLab the sample **body** carries the real type (`webhookEvent` / `object_kind`).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/webhooks/presets/github/samples/release.json` | GitHub release sample | Create |
| `packages/webhooks/presets/github/samples/create.json` | GitHub branch/tag create sample | Create |
| `packages/webhooks/presets/github/samples/delete.json` | GitHub branch/tag delete sample | Create |
| `packages/webhooks/presets/github/preset.json` | Declare the 3 new samples | Modify |
| `packages/webhooks/presets/github-issues/samples/issue_comment.json` | GitHub issue comment sample | Create |
| `packages/webhooks/presets/github-issues/preset.json` | Declare the new sample | Modify |
| `packages/webhooks/presets/jira/samples/issue_created.json` | Jira issue created | Create |
| `packages/webhooks/presets/jira/samples/comment_created.json` | Jira comment created | Create |
| `packages/webhooks/presets/jira/samples/issue_deleted.json` | Jira issue deleted | Create |
| `packages/webhooks/presets/jira/preset.json` | Declare the 3 new samples | Modify |
| `packages/webhooks/presets/gitlab/samples/merge_request.json` | GitLab merge request | Create |
| `packages/webhooks/presets/gitlab/samples/pipeline.json` | GitLab pipeline | Create |
| `packages/webhooks/presets/gitlab/samples/tag_push.json` | GitLab tag push | Create |
| `packages/webhooks/presets/gitlab/preset.json` | Declare the 3 new samples | Modify |
| `packages/webhooks/src/presets/webhook-test-delivery`… | (see Task 5 — helper lives in api-server) | — |
| `packages/api-server/src/services/webhook-test-delivery.ts` | `eventTypeHeaderForSample` helper | Modify |
| `packages/api-server/src/services/webhook-test-delivery.eventtype.test.ts` | Unit test for the helper | Create |
| `packages/api-server/src/routes/webhooks-management.ts` | Set event-type header on test fire | Modify |
| `packages/webhooks/src/presets/loader.samples.test.ts` | Smoke test: new samples load | Create |

---

## Task 1: GitHub (code) samples — release, create, delete

**Files:**
- Create: `packages/webhooks/presets/github/samples/release.json`, `create.json`, `delete.json`
- Modify: `packages/webhooks/presets/github/preset.json`

- [ ] **Step 1: Create `release.json`**

`packages/webhooks/presets/github/samples/release.json`:

```json
{
  "action": "published",
  "release": { "tag_name": "v1.2.0", "name": "v1.2.0", "draft": false, "prerelease": false },
  "repository": { "id": 1, "name": "demo", "full_name": "acme/demo", "owner": { "login": "acme" } },
  "sender": { "login": "alice" }
}
```

- [ ] **Step 2: Create `create.json`**

`packages/webhooks/presets/github/samples/create.json`:

```json
{
  "ref": "feat/x",
  "ref_type": "branch",
  "master_branch": "main",
  "repository": { "id": 1, "name": "demo", "full_name": "acme/demo", "owner": { "login": "acme" } },
  "sender": { "login": "alice" }
}
```

- [ ] **Step 3: Create `delete.json`**

`packages/webhooks/presets/github/samples/delete.json`:

```json
{
  "ref": "feat/old",
  "ref_type": "branch",
  "repository": { "id": 1, "name": "demo", "full_name": "acme/demo", "owner": { "login": "acme" } },
  "sender": { "login": "alice" }
}
```

- [ ] **Step 4: Declare the new samples in `preset.json`**

In `packages/webhooks/presets/github/preset.json`, replace the `sampleEvents` object:

```json
  "sampleEvents": {
    "push": "./samples/push.json",
    "pull_request": "./samples/pull_request.json",
    "release": "./samples/release.json",
    "create": "./samples/create.json",
    "delete": "./samples/delete.json"
  }
```

- [ ] **Step 5: Verify the preset still loads**

Run: `npx tsx -e "import('./packages/webhooks/src/presets/loader.ts').then(m=>{const p=m.getPreset('github');console.log(Object.keys(p.samples))})"`
Expected: prints `[ 'push', 'pull_request', 'release', 'create', 'delete' ]` (a malformed JSON file would throw here).

---

## Task 2: GitHub issues sample — issue_comment

**Files:**
- Create: `packages/webhooks/presets/github-issues/samples/issue_comment.json`
- Modify: `packages/webhooks/presets/github-issues/preset.json`

- [ ] **Step 1: Create `issue_comment.json`**

`packages/webhooks/presets/github-issues/samples/issue_comment.json`:

```json
{
  "action": "created",
  "issue": { "number": 7, "title": "Bug: button does not click", "state": "open", "user": { "login": "alice" } },
  "comment": { "body": "I can reproduce this.", "user": { "login": "bob" } },
  "repository": { "full_name": "acme/demo" },
  "sender": { "login": "bob" }
}
```

- [ ] **Step 2: Declare it in `preset.json`**

In `packages/webhooks/presets/github-issues/preset.json`, replace the `sampleEvents` object:

```json
  "sampleEvents": {
    "issues": "./samples/issues.json",
    "issue_comment": "./samples/issue_comment.json"
  }
```

- [ ] **Step 3: Verify the preset still loads**

Run: `npx tsx -e "import('./packages/webhooks/src/presets/loader.ts').then(m=>{const p=m.getPreset('github-issues');console.log(Object.keys(p.samples))})"`
Expected: prints `[ 'issues', 'issue_comment' ]`.

---

## Task 3: Jira samples — issue_created, comment_created, issue_deleted

**Files:**
- Create: `packages/webhooks/presets/jira/samples/issue_created.json`, `comment_created.json`, `issue_deleted.json`
- Modify: `packages/webhooks/presets/jira/preset.json`

- [ ] **Step 1: Create `issue_created.json`**

`packages/webhooks/presets/jira/samples/issue_created.json`:

```json
{
  "webhookEvent": "jira:issue_created",
  "timestamp": 1700000000000,
  "issue": {
    "id": "10002",
    "key": "DEMO-8",
    "fields": {
      "summary": "New issue from webhook",
      "status": { "name": "To Do" },
      "issuetype": { "name": "Task" },
      "reporter": { "displayName": "Bob" }
    }
  },
  "user": { "displayName": "Bob" }
}
```

- [ ] **Step 2: Create `comment_created.json`**

`packages/webhooks/presets/jira/samples/comment_created.json`:

```json
{
  "webhookEvent": "comment_created",
  "timestamp": 1700000000000,
  "issue": { "id": "10001", "key": "DEMO-7", "fields": { "summary": "Fix login button" } },
  "comment": { "id": "20001", "body": "A new comment", "author": { "displayName": "Alice" } }
}
```

- [ ] **Step 3: Create `issue_deleted.json`**

`packages/webhooks/presets/jira/samples/issue_deleted.json`:

```json
{
  "webhookEvent": "jira:issue_deleted",
  "timestamp": 1700000000000,
  "issue": { "id": "10001", "key": "DEMO-7", "fields": { "summary": "Fix login button" } },
  "user": { "displayName": "Bob" }
}
```

- [ ] **Step 4: Declare them in `preset.json`**

In `packages/webhooks/presets/jira/preset.json`, replace the `sampleEvents` object:

```json
  "sampleEvents": {
    "issue_updated": "./samples/issue_updated.json",
    "issue_created": "./samples/issue_created.json",
    "comment_created": "./samples/comment_created.json",
    "issue_deleted": "./samples/issue_deleted.json"
  }
```

- [ ] **Step 5: Verify the preset still loads**

Run: `npx tsx -e "import('./packages/webhooks/src/presets/loader.ts').then(m=>{const p=m.getPreset('jira');console.log(Object.keys(p.samples))})"`
Expected: prints `[ 'issue_updated', 'issue_created', 'comment_created', 'issue_deleted' ]`.

---

## Task 4: GitLab samples — merge_request, pipeline, tag_push

**Files:**
- Create: `packages/webhooks/presets/gitlab/samples/merge_request.json`, `pipeline.json`, `tag_push.json`
- Modify: `packages/webhooks/presets/gitlab/preset.json`

- [ ] **Step 1: Create `merge_request.json`**

`packages/webhooks/presets/gitlab/samples/merge_request.json`:

```json
{
  "object_kind": "merge_request",
  "event_type": "merge_request",
  "project": { "id": 1, "name": "demo", "path_with_namespace": "acme/demo" },
  "object_attributes": {
    "iid": 7,
    "title": "Add feature X",
    "state": "opened",
    "action": "open",
    "source_branch": "feat/x",
    "target_branch": "main"
  },
  "user": { "username": "alice" }
}
```

- [ ] **Step 2: Create `pipeline.json`**

`packages/webhooks/presets/gitlab/samples/pipeline.json`:

```json
{
  "object_kind": "pipeline",
  "project": { "id": 1, "name": "demo", "path_with_namespace": "acme/demo" },
  "object_attributes": { "id": 1001, "ref": "main", "status": "success", "sha": "abc1234" },
  "user": { "username": "alice" }
}
```

- [ ] **Step 3: Create `tag_push.json`**

`packages/webhooks/presets/gitlab/samples/tag_push.json`:

```json
{
  "object_kind": "tag_push",
  "event_name": "tag_push",
  "ref": "refs/tags/v1.2.0",
  "checkout_sha": "abc1234",
  "project": { "id": 1, "name": "demo", "path_with_namespace": "acme/demo" },
  "user": { "username": "alice" }
}
```

- [ ] **Step 4: Declare them in `preset.json`**

In `packages/webhooks/presets/gitlab/preset.json`, replace the `sampleEvents` object:

```json
  "sampleEvents": {
    "push": "./samples/push.json",
    "merge_request": "./samples/merge_request.json",
    "pipeline": "./samples/pipeline.json",
    "tag_push": "./samples/tag_push.json"
  }
```

- [ ] **Step 5: Verify the preset still loads**

Run: `npx tsx -e "import('./packages/webhooks/src/presets/loader.ts').then(m=>{const p=m.getPreset('gitlab');console.log(Object.keys(p.samples))})"`
Expected: prints `[ 'push', 'merge_request', 'pipeline', 'tag_push' ]`.

---

## Task 5: Event-type header on test fire (header-based providers)

**Files:**
- Modify: `packages/api-server/src/services/webhook-test-delivery.ts`
- Test: `packages/api-server/src/services/webhook-test-delivery.eventtype.test.ts`
- Modify: `packages/api-server/src/routes/webhooks-management.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/api-server/src/services/webhook-test-delivery.eventtype.test.ts`:

```ts
import assert from "node:assert/strict";
import { eventTypeHeaderForSample } from "./webhook-test-delivery.ts";

// Header-based provider + a chosen sample key → set that header to the key.
assert.deepEqual(
  eventTypeHeaderForSample("header:x-github-event", "release"),
  { name: "x-github-event", value: "release" },
);

// Header name is lowercased.
assert.deepEqual(
  eventTypeHeaderForSample("header:X-GitHub-Event", "push"),
  { name: "x-github-event", value: "push" },
);

// Body-based provider → no header (type is in the payload).
assert.equal(eventTypeHeaderForSample("$.object_kind", "merge_request"), null);
assert.equal(eventTypeHeaderForSample("$.webhookEvent", "issue_created"), null);

// No sample chosen, or no eventTypePath → null.
assert.equal(eventTypeHeaderForSample("header:x-github-event", undefined), null);
assert.equal(eventTypeHeaderForSample(undefined, "release"), null);

console.log("eventTypeHeaderForSample: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx packages/api-server/src/services/webhook-test-delivery.eventtype.test.ts`
Expected: FAIL — `eventTypeHeaderForSample` is not exported.

- [ ] **Step 3: Add the helper**

In `packages/api-server/src/services/webhook-test-delivery.ts`, append after `buildTestDeliveryHeaders`:

```ts
/**
 * For a sample-event test fire, derive the event-type header a header-based
 * provider expects (e.g. GitHub's `x-github-event`). Returns null when the
 * provider reads its event type from the body (e.g. `$.webhookEvent`) or when
 * no sample key was chosen — in those cases the body already carries the type.
 */
export function eventTypeHeaderForSample(
  eventTypePath: string | undefined,
  sampleEvent: string | undefined,
): { name: string; value: string } | null {
  if (!sampleEvent || !eventTypePath || !eventTypePath.startsWith("header:")) return null;
  return { name: eventTypePath.slice("header:".length).toLowerCase(), value: sampleEvent };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx packages/api-server/src/services/webhook-test-delivery.eventtype.test.ts`
Expected: PASS — prints `eventTypeHeaderForSample: ok`.

- [ ] **Step 5: Wire it into the test route**

In `packages/api-server/src/routes/webhooks-management.ts`:

First, add `eventTypeHeaderForSample` to the existing import from `webhook-test-delivery.ts`. Find the line importing `buildTestDeliveryHeaders` and extend it, e.g.:

```ts
import { buildTestDeliveryHeaders, eventTypeHeaderForSample } from "../services/webhook-test-delivery.ts";
```

Then in the `POST /api/webhooks/:id/test` handler, immediately after the existing:

```ts
      const headers = buildTestDeliveryHeaders(r, rawBody, resolvedSecret);
      if (!headers) return reply.code(501).send({ error: "auth_mode_not_synthesizable" });
```

insert:

```ts
      const evtHeader = eventTypeHeaderForSample(r.eventTypePath, body.sampleEvent);
      if (evtHeader) headers[evtHeader.name] = evtHeader.value;
```

(`r` is the loaded `Webhook` and carries `eventTypePath`; `body.sampleEvent` is the chosen sample key.)

- [ ] **Step 6: Typecheck api-server**

Run: `npm run typecheck -w @journeyman/api-server`
Expected: PASS — no type errors.

---

## Task 6: Loader smoke test — all new samples load

**Files:**
- Test: `packages/webhooks/src/presets/loader.samples.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/webhooks/src/presets/loader.samples.test.ts`:

```ts
import assert from "node:assert/strict";
import type { PresetId } from "@journeyman/core";
import { getPreset } from "./loader.ts";

const expected: Record<string, string[]> = {
  github: ["push", "pull_request", "release", "create", "delete"],
  "github-issues": ["issues", "issue_comment"],
  jira: ["issue_updated", "issue_created", "comment_created", "issue_deleted"],
  gitlab: ["push", "merge_request", "pipeline", "tag_push"],
};

for (const [id, keys] of Object.entries(expected)) {
  const p = getPreset(id as PresetId);
  assert.ok(p, `preset '${id}' should load`);
  for (const k of keys) {
    assert.ok(
      p!.samples && p!.samples[k] !== undefined,
      `preset '${id}' should have sample '${k}'`,
    );
  }
}

console.log("preset-samples: ok");
```

- [ ] **Step 2: Run the test**

Run: `npx tsx packages/webhooks/src/presets/loader.samples.test.ts`
Expected: PASS — prints `preset-samples: ok`. (Any malformed/missing sample file throws at `getPreset`, failing the test.)

---

## Task 7: Final verification gate

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck across all workspaces**

Run: `npm run typecheck`
Expected: PASS — no type errors in any workspace.

- [ ] **Step 2: Re-run both new tests as a smoke pass**

Run:
```bash
npx tsx packages/api-server/src/services/webhook-test-delivery.eventtype.test.ts
npx tsx packages/webhooks/src/presets/loader.samples.test.ts
```
Expected: each prints its `ok` line.

> Per user constraint: do **not** commit. Stop here and report results.

---

## Self-Review Notes

- **Spec coverage:** Part 1 samples — GitHub code (Task 1), GitHub issues (Task 2), Jira (Task 3), GitLab (Task 4); Part 2 header fix (Task 5); loader smoke (Task 6); typecheck gate (Task 7). All spec sections mapped.
- **Key/value alignment:** GitHub sample keys (`release`/`create`/`delete`/`issue_comment`) equal the `X-GitHub-Event` values set by Task 5. Jira/GitLab sample bodies carry the real event-type values (`jira:issue_created`, `comment_created`, `jira:issue_deleted`, `merge_request`, `pipeline`, `tag_push`) matching each preset's `knownEventTypes`.
- **Constraints honored:** no `git commit` steps; `npm run typecheck` is the final gate (Task 7).
