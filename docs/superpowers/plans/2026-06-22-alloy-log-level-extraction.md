# Pino Log-Level Extraction in Alloy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Grafana show and filter log levels (info/warn/error/…) for the built-in pino services (api-app, api-webhooks, api-control-plane, worker, analytics, sandbox) by extracting pino's numeric level in the Alloy collector and promoting it to a `level` stream label.

**Architecture:** Insert a `loki.process` component between `loki.source.docker` and `loki.write` in the Alloy config. It runs only for the pino services (via `stage.match`), JSON-parses each line, maps the numeric pino level to a name, and promotes it to a `level` label. No app code, no new services, no compose changes.

**Tech Stack:** Grafana Alloy 1.10 (`loki.process` with `stage.match` / `stage.json` / `stage.template` / `stage.labels`), Loki 3.5, Grafana 11.6. Edits one file: `infra/logging/alloy-config.alloy`.

**Spec:** [docs/superpowers/specs/2026-06-22-alloy-log-level-extraction-design.md](../specs/2026-06-22-alloy-log-level-extraction-design.md)

---

## Execution constraints (from the user)

- **Branch:** work on `master` directly. No worktree, no feature branch.
- **Commits:** do **not** commit at any point. Leave changes in the working tree.
- **Validation:** run it **once at the end** (Task 3). For this config-only change the "typecheck" equivalent is `alloy fmt` + `npm run typecheck` to prove no TS regressed.
- This is config only — no unit-test loop. The task creates the config change and validates it parses with the real `alloy` binary, then proves levels appear at runtime.

## Pre-flight

The logging stack from the previous plan is already running (`loki` healthy, `alloy`, `grafana` up). Image tag in use: `grafana/alloy:v1.10.0`. Keep the validation `docker run` tag matching the compose service tag.

## File structure

```
infra/logging/alloy-config.alloy   (modify — repoint source + add loki.process "levels")
```

Single file. The `loki.process "levels"` block owns level interpretation; the
existing `discovery.*` / `loki.source.docker` / `loki.write` blocks keep their
current responsibilities.

---

### Task 1: Add the level-extraction processor to the Alloy config

**Files:**
- Modify: `infra/logging/alloy-config.alloy`

- [ ] **Step 1: Repoint `loki.source.docker` to forward into the new processor**

In `infra/logging/alloy-config.alloy`, find the `loki.source.docker "containers"` block. Change its `forward_to` from the Loki writer to the new processor's receiver.

Replace:
```alloy
loki.source.docker "containers" {
  host       = "unix:///var/run/docker.sock"
  targets    = discovery.relabel.containers.output
  forward_to = [loki.write.default.receiver]
}
```
with:
```alloy
loki.source.docker "containers" {
  host       = "unix:///var/run/docker.sock"
  targets    = discovery.relabel.containers.output
  forward_to = [loki.process.levels.receiver]
}
```

- [ ] **Step 2: Add the `loki.process "levels"` block**

Insert this block immediately **after** the `loki.source.docker "containers"` block and **before** the `loki.write "default"` block:

```alloy
// Extract pino's numeric log level into a `level` stream label for the built-in
// services. Other containers (postgres, redis, conductor, loki, web) are not
// matched and keep Loki's own detected_level.
loki.process "levels" {
  forward_to = [loki.write.default.receiver]

  stage.match {
    selector = "{service=~\"api-app|api-webhooks|api-control-plane|worker|analytics|sandbox\"}"

    stage.json {
      expressions = { level = "level" }
    }
    stage.template {
      source   = "level"
      // No `{{ else }}{{ .Value }}` fallback: a missing field renders Go's
      // "<no value>" string and would survive as a bogus level. Fall through to
      // empty so Loki drops the label.
      template = "{{ if eq .Value \"10\" }}trace{{ else if eq .Value \"20\" }}debug{{ else if eq .Value \"30\" }}info{{ else if eq .Value \"40\" }}warn{{ else if eq .Value \"50\" }}error{{ else if eq .Value \"60\" }}fatal{{ end }}"
    }
    stage.labels {
      values = { level = "" }
    }
  }
}
```

- [ ] **Step 3: Confirm `loki.write` is unchanged and the wiring is end-to-end**

Verify the file still contains exactly one `loki.write "default"` block, unchanged:
```alloy
loki.write "default" {
  endpoint {
    url = "http://loki:3100/loki/api/v1/push"
  }
}
```
The chain must now read: `discovery.docker` → `discovery.relabel` → `loki.source.docker` (→ `loki.process.levels`) → `loki.write.default`.

---

### Task 2: Validate the config parses

**Files:** none (validation only)

- [ ] **Step 1: Run `alloy fmt` against the edited file**

Run (from repo root):
```bash
docker run --rm \
  -v "$(pwd)/infra/logging/alloy-config.alloy:/etc/alloy/config.alloy:ro" \
  grafana/alloy:v1.10.0 \
  fmt /etc/alloy/config.alloy >/dev/null 2>/tmp/alloy_err && echo "alloy config OK" || { echo "alloy FAILED"; cat /tmp/alloy_err; }
```
Expected: prints `alloy config OK`. If it fails, the stderr names the offending block/line (common causes: an unescaped quote in the `template` string, or a missing `}`). Fix in `infra/logging/alloy-config.alloy` and re-run.

---

### Task 3: Apply at runtime and verify levels appear

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the workspace (single run, per the user's instruction)**

No TypeScript changed, but run it to prove nothing regressed.

Run (from repo root):
```bash
npm run typecheck
```
Expected: completes with no errors.

- [ ] **Step 2: Restart Alloy so it loads the new config**

Run (from repo root):
```bash
docker compose -f compose.deploy.yml up -d --force-recreate alloy
docker compose -f compose.deploy.yml ps alloy
```
Expected: `alloy` shows `Up`. If it crash-loops, inspect: `docker compose -f compose.deploy.yml logs alloy | tail -30` (a bad config makes Alloy exit on boot — re-check Task 1 against Task 2).

- [ ] **Step 3: Generate pino-formatted logs from a built-in service**

The pino `level` label only appears once a matched service emits production JSON logs. If the app stack is not running, bring up at least one pino service (the worker is simplest):
```bash
docker compose -f compose.deploy.yml up -d worker 2>&1 | tail -5
```
If the worker image is not built, build the app images first (`npm run images:build`) then re-run the line above. Give it ~20s to emit startup logs.

> Note: services log at `LOG_LEVEL=info` by default, so only `info` (and any
> `warn`/`error`) lines appear — `debug`/`trace` will not unless `LOG_LEVEL` is
> lowered. That is expected and out of scope.

- [ ] **Step 4: Confirm the `level` label now exists in Loki**

Run (from repo root):
```bash
docker compose -f compose.deploy.yml exec -T loki wget -qO- \
  'http://localhost:3100/loki/api/v1/label/level/values'
```
Expected: a JSON body whose `data` array contains level names such as `info` (and `warn`/`error` if any were logged), e.g. `{"status":"success","data":["info","warn","error"]}`. An empty `data` means no matched service has logged yet — re-check Step 3.

- [ ] **Step 5: Confirm a level-filtered query returns the right lines**

Run (from repo root):
```bash
docker compose -f compose.deploy.yml exec -T loki wget -qO- \
  'http://localhost:3100/loki/api/v1/query_range?query=%7Bservice%3D%22worker%22%2Clevel%3D%22info%22%7D&limit=2' \
  | head -c 500
```
Expected: a `resultType:"streams"` response whose stream labels include `"level":"info"` and `"service":"worker"`.

- [ ] **Step 6: Browser confirmation (Grafana)**

Open `http://localhost:6300` → Explore (Loki). Run `{service="worker"} | level="error"` and confirm only error lines return; run `{service="worker"}` and confirm the logs panel colorizes lines by level (a colored bar / level column per line).

- [ ] **Step 7: Leave everything uncommitted**

Per the user's instruction, do **not** `git add` or `git commit`. Confirm the working tree:
```bash
git status --short
```
Expected: shows ` M infra/logging/alloy-config.alloy` (plus any pre-existing untracked files, which are not yours to touch).

---

## Self-review

**Spec coverage** — every spec requirement maps to a task:
- Insert `loki.process` between source and write, repoint `forward_to` → Task 1 Steps 1–2
- `stage.match` selector for the six pino services → Task 1 Step 2
- json → numeric-to-name template → promote to `level` label → Task 1 Step 2
- Config still parses → Task 2
- Restart Alloy; `level` label/values appear; level-filtered query works; Grafana colorizes → Task 3
- "Display only / LOG_LEVEL=info" caveat surfaced → Task 3 Step 3 note

**Type/name consistency** — the new component is named `loki.process "levels"` everywhere it appears (`forward_to = [loki.process.levels.receiver]` in Task 1 Step 1 matches the block name in Step 2). The service list in the `stage.match` selector (`api-app|api-webhooks|api-control-plane|worker|analytics|sandbox`) matches the spec. Image tag `grafana/alloy:v1.10.0` matches the running compose service.

**Placeholder scan** — no TBD/TODO; the full config block is given; every command has an expected result.

**Constraints honored** — no commit steps; a single validation pass at the end (Task 3 Step 1 typecheck + the runtime checks); no branch/worktree creation (master only).
