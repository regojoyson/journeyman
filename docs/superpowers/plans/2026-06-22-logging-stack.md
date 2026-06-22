# Logging Stack (Loki + Alloy + Grafana) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Grafana Loki + Alloy + Grafana logging stack to `compose.deploy.yml` so every container's logs (named services *and* ephemeral sandbox runners) are aggregated, searchable, retained 7 days, and viewable in a browser dashboard.

**Architecture:** Three new compose services. Grafana Alloy discovers all containers on the host Docker daemon via the socket and tails their logs through the Docker API into Loki. Loki stores + retains them; Grafana provides the search UI (Explore) and a starter dashboard. No existing service changes — they keep logging to stdout.

**Tech Stack:** Docker Compose, Grafana Loki 3.5, Grafana Alloy 1.10, Grafana 11.6. Config is YAML (Loki, Grafana provisioning) + Alloy's River-style config + a Grafana dashboard JSON.

**Spec:** [docs/superpowers/specs/2026-06-22-logging-stack-design.md](../specs/2026-06-22-logging-stack-design.md)

---

## Execution constraints (from the user)

- **Branch:** work on `master` directly. No worktree, no feature branch.
- **Commits:** do **not** commit at any point. Leave all changes in the working tree.
- **Typecheck:** run it **once at the very end** (Task 6), not per task.
- This is config/infra: there is no unit-test loop. Each task creates a config file and validates it parses with the real upstream tool before moving on.

## Pre-flight: pin image versions

Before starting, confirm the latest stable patch tags and use them consistently everywhere they appear in this plan:
- `grafana/loki` (plan uses `3.5.0`)
- `grafana/alloy` (plan uses `v1.10.0`)
- `grafana/grafana` (plan uses `11.6.0`)

If you bump a tag, bump it in **both** the validation `docker run` commands and the compose service blocks so they match.

## File structure

```
infra/logging/                                              (new directory)
├── loki-config.yml                                         Task 1
├── alloy-config.alloy                                      Task 2
└── grafana/provisioning/
    ├── datasources/loki.yml                                Task 3
    └── dashboards/
        ├── dashboards.yml                                  Task 4
        └── journeyman-logs.json                            Task 4
compose.deploy.yml                                          Task 5 (modify)
```

Each config file is self-contained with one responsibility: Loki = storage/retention, Alloy = collection/labeling, Grafana provisioning = datasource + dashboard. They are wired together only in `compose.deploy.yml` (Task 5).

---

### Task 1: Loki storage + retention config

**Files:**
- Create: `infra/logging/loki-config.yml`

- [ ] **Step 1: Create the Loki config file**

Single-binary Loki, filesystem storage, TSDB v13 schema, compactor-enforced 7-day (168h) retention, auth disabled (in-network only).

`infra/logging/loki-config.yml`:

```yaml
auth_enabled: false

server:
  http_listen_port: 3100

common:
  instance_addr: 127.0.0.1
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory

schema_config:
  configs:
    - from: 2020-10-24
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h

limits_config:
  retention_period: 168h          # 7 days
  reject_old_samples: false

compactor:
  working_directory: /loki/compactor
  retention_enabled: true
  delete_request_store: filesystem

ruler:
  storage:
    type: local
    local:
      directory: /loki/rules
```

- [ ] **Step 2: Validate the config with Loki's own verifier**

Loki has a `-verify-config` flag that loads the config and exits.

Run (from repo root):
```bash
docker run --rm \
  -v "$(pwd)/infra/logging/loki-config.yml:/etc/loki/loki-config.yml:ro" \
  grafana/loki:3.5.0 \
  -config.file=/etc/loki/loki-config.yml -verify-config
```
Expected: exits 0; output ends with a line confirming the config was parsed (no `level=error`, no `failed to ...`). If you see `field ... not found` or a YAML parse error, fix the file and re-run.

---

### Task 2: Alloy collection + labeling config

**Files:**
- Create: `infra/logging/alloy-config.alloy`

- [ ] **Step 1: Create the Alloy config file**

Discover all containers on the daemon via the socket, relabel into `service` / `project` / `container` / `image`, tail logs through the Docker API, push to Loki. Non-compose containers (sandbox runners) get `service = "sandbox"` so nothing is dropped.

`infra/logging/alloy-config.alloy`:

```alloy
discovery.docker "containers" {
  host = "unix:///var/run/docker.sock"
}

discovery.relabel "containers" {
  targets = discovery.docker.containers.targets

  // compose service name -> `service` label (e.g. api-app, worker)
  rule {
    source_labels = ["__meta_docker_container_label_com_docker_compose_service"]
    target_label  = "service"
  }
  // compose project -> `project` label
  rule {
    source_labels = ["__meta_docker_container_label_com_docker_compose_project"]
    target_label  = "project"
  }
  // container name (strip leading slash) -> `container` label
  rule {
    source_labels = ["__meta_docker_container_name"]
    regex         = "/(.*)"
    target_label  = "container"
  }
  // image title -> `image` label
  rule {
    source_labels = ["__meta_docker_container_label_org_opencontainers_image_title"]
    target_label  = "image"
  }
  // Non-compose containers (sandbox runners) have no compose service label;
  // fall back to "sandbox" so they are still grouped and queryable.
  rule {
    source_labels = ["service"]
    regex         = ""
    target_label  = "service"
    replacement   = "sandbox"
  }
}

loki.source.docker "containers" {
  host       = "unix:///var/run/docker.sock"
  targets    = discovery.relabel.containers.output
  forward_to = [loki.write.default.receiver]
}

loki.write "default" {
  endpoint {
    url = "http://loki:3100/loki/api/v1/push"
  }
}
```

- [ ] **Step 2: Validate the config with `alloy fmt`**

`alloy fmt` parses the config and re-emits it; it exits non-zero on any syntax error.

Run (from repo root):
```bash
docker run --rm \
  -v "$(pwd)/infra/logging/alloy-config.alloy:/etc/alloy/config.alloy:ro" \
  grafana/alloy:v1.10.0 \
  fmt /etc/alloy/config.alloy >/dev/null && echo "alloy config OK"
```
Expected: prints `alloy config OK`. If it errors, the message names the line/block — fix and re-run.

---

### Task 3: Grafana Loki datasource provisioning

**Files:**
- Create: `infra/logging/grafana/provisioning/datasources/loki.yml`

- [ ] **Step 1: Create the datasource provisioning file**

Wires Loki as the default datasource with a fixed `uid: loki` (the dashboard in Task 4 references this uid).

`infra/logging/grafana/provisioning/datasources/loki.yml`:

```yaml
apiVersion: 1
datasources:
  - name: Loki
    type: loki
    uid: loki
    access: proxy
    url: http://loki:3100
    isDefault: true
    jsonData:
      maxLines: 1000
```

- [ ] **Step 2: Validate it is well-formed YAML**

Run (from repo root):
```bash
docker run --rm -v "$(pwd)/infra/logging/grafana/provisioning/datasources/loki.yml:/c.yml:ro" \
  mikefarah/yq:4 '.datasources[0].uid' /c.yml
```
Expected: prints `loki`. (Any YAML error makes yq exit non-zero with a parse message.)

---

### Task 4: Grafana dashboard provisioning + starter dashboard

**Files:**
- Create: `infra/logging/grafana/provisioning/dashboards/dashboards.yml`
- Create: `infra/logging/grafana/provisioning/dashboards/journeyman-logs.json`

- [ ] **Step 1: Create the dashboard provider config**

`infra/logging/grafana/provisioning/dashboards/dashboards.yml`:

```yaml
apiVersion: 1
providers:
  - name: journeyman
    folder: Journeyman
    type: file
    options:
      path: /etc/grafana/provisioning/dashboards
```

- [ ] **Step 2: Create the starter dashboard JSON**

Minimal valid Grafana dashboard: a `service` template variable, a log-volume-by-service time series, and a live logs panel filtered by the selected service. References datasource uid `loki` from Task 3.

`infra/logging/grafana/provisioning/dashboards/journeyman-logs.json`:

```json
{
  "annotations": { "list": [] },
  "editable": true,
  "graphTooltip": 0,
  "schemaVersion": 39,
  "tags": ["journeyman", "logs"],
  "title": "Journeyman Logs",
  "uid": "journeyman-logs",
  "version": 1,
  "time": { "from": "now-1h", "to": "now" },
  "templating": {
    "list": [
      {
        "name": "service",
        "label": "Service",
        "type": "query",
        "datasource": { "type": "loki", "uid": "loki" },
        "query": { "label": "service", "stream": "", "type": 1 },
        "refresh": 2,
        "includeAll": true,
        "multi": true,
        "current": { "text": "All", "value": "$__all" }
      }
    ]
  },
  "panels": [
    {
      "id": 1,
      "type": "timeseries",
      "title": "Log volume by service",
      "datasource": { "type": "loki", "uid": "loki" },
      "gridPos": { "h": 8, "w": 24, "x": 0, "y": 0 },
      "fieldConfig": { "defaults": { "custom": { "drawStyle": "bars", "fillOpacity": 50, "stacking": { "mode": "normal" } } }, "overrides": [] },
      "targets": [
        {
          "refId": "A",
          "datasource": { "type": "loki", "uid": "loki" },
          "expr": "sum by (service) (count_over_time({service=~\"$service\"}[$__interval]))",
          "legendFormat": "{{service}}"
        }
      ]
    },
    {
      "id": 2,
      "type": "logs",
      "title": "Logs",
      "datasource": { "type": "loki", "uid": "loki" },
      "gridPos": { "h": 16, "w": 24, "x": 0, "y": 8 },
      "options": { "showTime": true, "wrapLogMessage": true, "enableLogDetails": true, "sortOrder": "Descending" },
      "targets": [
        {
          "refId": "A",
          "datasource": { "type": "loki", "uid": "loki" },
          "expr": "{service=~\"$service\"}"
        }
      ]
    }
  ]
}
```

- [ ] **Step 3: Validate the dashboard JSON parses and has the expected uid**

Run (from repo root):
```bash
node -e "const d=require('./infra/logging/grafana/provisioning/dashboards/journeyman-logs.json'); if(d.uid!=='journeyman-logs') throw new Error('bad uid'); if(!Array.isArray(d.panels)||d.panels.length!==2) throw new Error('expected 2 panels'); console.log('dashboard JSON OK');"
```
Expected: prints `dashboard JSON OK`. Any JSON syntax error throws a parse error naming the position.

---

### Task 5: Wire the three services into `compose.deploy.yml`

**Files:**
- Modify: `compose.deploy.yml` (add `loki`, `alloy`, `grafana` under `services:`)

- [ ] **Step 1: Add the `loki` service**

Insert this block under `services:` in `compose.deploy.yml`, after the `web` service (keep alphabetical-ish grouping with the other logging services that follow). Loki is in-network only (no published port); data bind-mounted under `JOURNEYMAN_BASE_DIR` like postgres/redis.

```yaml
  # ── logging stack: Loki (store+retain) + Alloy (collect) + Grafana (UI) ──────
  # Aggregates ALL container logs on the host daemon — named services AND the
  # ephemeral sandbox runners the worker spawns. Local prod-simulation only:
  # Loki auth is off and Grafana allows anonymous viewing. See docs/superpowers/
  # specs/2026-06-22-logging-stack-design.md.
  loki:
    image: grafana/loki:3.5.0
    command: ["-config.file=/etc/loki/loki-config.yml"]
    volumes:
      - ./infra/logging/loki-config.yml:/etc/loki/loki-config.yml:ro
      - ${JOURNEYMAN_BASE_DIR:-./.journeyman-data}/loki:/loki
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3100/ready"]
      interval: 5s
      timeout: 5s
      retries: 20
```

- [ ] **Step 2: Add the `alloy` service**

Directly after `loki`. Socket-only collection (no `/var/lib/docker/containers` mount), so it works on Docker Desktop for Mac.

```yaml
  alloy:
    image: grafana/alloy:v1.10.0
    command:
      - run
      - /etc/alloy/config.alloy
      - --server.http.listen-addr=0.0.0.0:12345
      - --storage.path=/var/lib/alloy/data
    volumes:
      - ./infra/logging/alloy-config.alloy:/etc/alloy/config.alloy:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
    depends_on:
      loki:
        condition: service_healthy
    restart: unless-stopped
```

- [ ] **Step 3: Add the `grafana` service**

Directly after `alloy`. Published on host `6300`; provisioning mounted read-only; data bind-mounted for saved explorations.

```yaml
  grafana:
    image: grafana/grafana:11.6.0
    environment:
      GF_AUTH_ANONYMOUS_ENABLED: "true"
      GF_AUTH_ANONYMOUS_ORG_ROLE: "Viewer"
      GF_SECURITY_ADMIN_USER: admin
      GF_SECURITY_ADMIN_PASSWORD: admin
      GF_USERS_DEFAULT_THEME: dark
    volumes:
      - ./infra/logging/grafana/provisioning:/etc/grafana/provisioning:ro
      - ${JOURNEYMAN_BASE_DIR:-./.journeyman-data}/grafana:/var/lib/grafana
    ports: ["6300:3000"]
    depends_on:
      loki:
        condition: service_healthy
```

- [ ] **Step 4: Validate the merged compose file parses**

`docker compose config` reads `env_file: .env.production`, which is gitignored and may be absent locally — create an empty placeholder first if so (do NOT commit it).

Run (from repo root):
```bash
[ -f .env.production ] || touch .env.production
docker compose -f compose.deploy.yml config --quiet && echo "compose config OK"
```
Expected: prints `compose config OK` with no errors. If you see `service "alloy" refers to undefined...` or an indentation error, fix the added blocks. (A warning about the missing/empty `.env.production` values is fine; a hard error is not.)

- [ ] **Step 5: Confirm the three services and the Grafana port are present**

Run (from repo root):
```bash
docker compose -f compose.deploy.yml config --services | grep -E '^(loki|alloy|grafana)$'
docker compose -f compose.deploy.yml config | grep -A2 'grafana:' | grep -q '6300' && echo "grafana port OK"
```
Expected: lists `alloy`, `grafana`, `loki` (order may vary) and prints `grafana port OK`.

---

### Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the workspace (single run, per the user's instruction)**

No TypeScript changed, but run it to prove nothing regressed.

Run (from repo root):
```bash
npm run typecheck
```
Expected: completes with no errors (same baseline as before the change — config-only edits do not touch any TS package).

- [ ] **Step 2: Bring the stack up and confirm the logging services are healthy**

Run (from repo root):
```bash
npm run compose:up
docker compose -f compose.deploy.yml ps loki alloy grafana
```
Expected: `loki` shows `healthy`, `grafana` and `alloy` show `running`/`Up`. If `loki` is unhealthy, check `docker compose -f compose.deploy.yml logs loki`.

- [ ] **Step 3: Confirm logs are flowing into Loki**

Query Loki directly for the set of discovered `service` label values (avoids needing the browser for this check).

Run (from repo root):
```bash
curl -s "http://localhost:6032/ready" >/dev/null 2>&1 || true   # noop; ports differ per service
curl -s "http://localhost:6300/api/health" | grep -q ok && echo "grafana up"
docker compose -f compose.deploy.yml exec -T loki wget -qO- \
  'http://localhost:3100/loki/api/v1/label/service/values'
```
Expected: `grafana up`, and the Loki label query returns a JSON body listing services such as `api-app`, `worker`, `web`, `postgres`, etc. (sandbox runners appear as `sandbox` once a workflow has run).

- [ ] **Step 4: Manual browser confirmation**

Open `http://localhost:6300` → **Explore** (Loki datasource is the default), run `{service="api-app"}`, and confirm log lines stream in. Then open the **Journeyman › Journeyman Logs** dashboard and confirm the "Log volume by service" panel and the `Service` filter work.

- [ ] **Step 5: Confirm sandbox-runner capture (optional but validates the headline feature)**

Trigger a workflow run from the web UI, then in Grafana Explore run `{service="sandbox"}` (or `{project="journeyman-deploy"} | container=~".*runner.*"`) and confirm the ephemeral AI-runner container's logs appear. If they don't, inspect Alloy: `docker compose -f compose.deploy.yml logs alloy | grep -i error`.

- [ ] **Step 6: Leave everything uncommitted**

Per the user's instruction, do **not** `git add` or `git commit`. Confirm the working tree holds the new `infra/logging/` files and the modified `compose.deploy.yml`:

```bash
git status --short
```
Expected: shows `?? infra/logging/` and ` M compose.deploy.yml` (and possibly an untracked `.env.production` placeholder — leave it, it is gitignored).

---

## Self-review

**Spec coverage** — every spec section maps to a task:
- Loki store + 7d retention → Task 1
- Alloy socket collection + labels (incl. sandbox fallback) → Task 2
- Grafana datasource → Task 3; dashboard provisioning + starter dashboard → Task 4
- Three services wired into compose with bind-mount persistence, Grafana on 6300, default-on → Task 5
- Verification (compose up, query worker + sandbox logs, dashboard) → Task 6

**Type/name consistency** — datasource `uid: loki` (Task 3) is referenced by every panel and the template variable in the dashboard JSON (Task 4). Service names `loki` / `alloy` / `grafana` and the `loki` healthcheck (`condition: service_healthy`) referenced by Alloy + Grafana `depends_on` (Task 5) match Task 1's healthcheck. Image tags `3.5.0` / `v1.10.0` / `11.6.0` are identical between each validation `docker run` and its compose block.

**Placeholder scan** — no TBD/TODO; every config file is given in full; every command has an expected result.

**Constraints honored** — no commit steps anywhere; typecheck appears once (Task 6, Step 1); no branch/worktree creation (master only).
