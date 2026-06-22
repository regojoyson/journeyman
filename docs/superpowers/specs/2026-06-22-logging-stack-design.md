# Centralized Log Management for the Compose Deployment

**Date:** 2026-06-22
**Status:** Approved — ready for implementation plan

## Goal

Add a Kibana/Datadog-style log aggregation and search UI to the full compose
deployment (`compose.deploy.yml`) so the stack feels prod-like: every container's
logs flow into one place, are searchable, are kept for a bounded window, and are
viewable in a browser dashboard. Nothing about the existing services changes —
they keep logging to stdout as they do today.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Primary goal | Datadog/Kibana-style aggregation + search UI |
| Stack | **Grafana Loki + Grafana Alloy + Grafana** |
| Collection | Sidecar collector (Alloy), socket-based — no changes to existing services |
| Capture scope | **Everything on the host Docker daemon** — named compose services *and* the ephemeral sandbox/runner containers the worker spawns as siblings |
| Persistence | Bind-mount Loki + Grafana data under `JOURNEYMAN_BASE_DIR` |
| Retention | **7 days (168h)**, enforced by Loki's compactor |
| Access | Grafana anonymous Viewer + Explore enabled; admin login for editing |
| Service count | Keep all 3 (Loki + Alloy + Grafana) — only combo satisfying whole-daemon capture + retention + search UI with zero host setup |

## Architecture

```
┌──────────────── host Docker daemon ────────────────┐
│  journeyman-deploy services        sandbox runners  │
│  (api-app, worker, web, …)         (spawned by      │
│         │  stdout                   worker)         │
│         │                              │  stdout    │
└─────────┼──────────────────────────────┼───────────┘
          │   Docker API (socket)        │
          ▼                              ▼
        ┌──────────────────────────────────┐
        │  alloy  (discovery.docker +       │
        │          loki.source.docker)      │
        └──────────────┬───────────────────┘
                       │ push (HTTP, in-network)
                       ▼
              ┌──────────────────┐        ┌────────────────────┐
              │  loki  :3100     │◀───────│  grafana  :3000    │
              │  (store + retain)│  query │  → host :6300       │
              └──────────────────┘        └────────────────────┘
```

Alloy uses `discovery.docker` (reads the Docker socket to enumerate containers)
and `loki.source.docker` (tails each container's logs **through the Docker API**,
not by reading `/var/lib/docker/containers` files). Socket-only collection keeps
it working cleanly on Docker Desktop for Mac and automatically picks up the
sandbox/runner containers, which are siblings on the same daemon.

## New services (added to `compose.deploy.yml`)

Host ports follow the existing 6000-series convention. Only Grafana is published;
Loki and Alloy are in-network only.

### `loki`

```yaml
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

### `alloy`

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

### `grafana`

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

> **Note:** image tags above are concrete starting points; the implementer should
> confirm the latest stable patch of each at build time and pin it.

## Config files (new)

```
infra/logging/
├── loki-config.yml
├── alloy-config.alloy
└── grafana/provisioning/
    ├── datasources/loki.yml
    └── dashboards/
        ├── dashboards.yml
        └── journeyman-logs.json
```

### `infra/logging/loki-config.yml`

Single-binary Loki, filesystem storage, TSDB schema, compactor-enforced 7-day
retention. Auth disabled (in-network only).

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

### `infra/logging/alloy-config.alloy`

Discover all containers on the daemon, relabel into useful labels, tail via the
Docker API, push to Loki.

```alloy
discovery.docker "containers" {
  host = "unix:///var/run/docker.sock"
}

discovery.relabel "containers" {
  targets = discovery.docker.containers.targets

  // compose service name → `service` label (e.g. api-app, worker)
  rule {
    source_labels = ["__meta_docker_container_label_com_docker_compose_service"]
    target_label  = "service"
  }
  // compose project → `project` label
  rule {
    source_labels = ["__meta_docker_container_label_com_docker_compose_project"]
    target_label  = "project"
  }
  // container name (strip leading slash) → `container` label
  rule {
    source_labels = ["__meta_docker_container_name"]
    regex         = "/(.*)"
    target_label  = "container"
  }
  // image → `image` label
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

> The sandbox-runner fallback label (`service = "sandbox"`) is a starting rule.
> If the runner containers carry a recognizable name or image prefix, the
> implementer may refine the relabel to derive a more specific label
> (e.g. `sandbox-<id>`). Whatever the final rule, it must not silently drop
> containers — every container on the daemon gets a `service` label.

### `infra/logging/grafana/provisioning/datasources/loki.yml`

```yaml
apiVersion: 1
datasources:
  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    isDefault: true
    jsonData:
      maxLines: 1000
```

### `infra/logging/grafana/provisioning/dashboards/dashboards.yml`

```yaml
apiVersion: 1
providers:
  - name: journeyman
    folder: Journeyman
    type: file
    options:
      path: /etc/grafana/provisioning/dashboards
```

### `infra/logging/grafana/provisioning/dashboards/journeyman-logs.json`

A starter dashboard with:
- a **log-volume-by-service** time series panel (LogQL: `sum by (service) (count_over_time({project="journeyman-deploy"}[$__interval]))`),
- a **live logs** panel with a `service` template variable so you can filter to
  any single service (or `sandbox`).

The implementer builds this as a minimal valid Grafana dashboard JSON; exact
panel layout is not load-bearing — Explore is the primary query surface and the
dashboard is a convenience.

## Compose wiring notes

- Add `loki`, `alloy`, `grafana` to `compose.deploy.yml` `services:`.
- `alloy` and `grafana` `depends_on: loki` (`condition: service_healthy`).
- No new top-level named volumes — Loki and Grafana use bind-mounts under
  `JOURNEYMAN_BASE_DIR`, consistent with postgres/redis. Add a brief comment to
  the existing data-root note.
- Default-on: the three services start with plain `npm run compose:up`. (We
  considered gating behind a `profiles: [logging]` block; rejected in favor of
  default-on because the point is to simulate prod. Can be revisited.)
- macOS / Docker Desktop: socket-based collection (`loki.source.docker`) avoids
  any `/var/lib/docker/containers` bind mount, so it works without VM path
  juggling. The socket is already mounted by the existing `dockerproxy` service,
  so the pattern is proven in this compose file.

## Security / scope caveats (local-sim only)

- Grafana anonymous Viewer access and `admin`/`admin` are fine for a local
  prod-simulation, **not** for a real deployment.
- Alloy mounts the Docker socket read-only; like `dockerproxy`, this is
  root-equivalent host access. Acceptable for local/trusted use only.
- Loki has auth disabled and is unpublished (in-network only).

## Out of scope (YAGNI)

- Metrics/traces (Prometheus, Tempo) — logs only.
- Alerting / notification rules.
- Multi-tenancy, TLS, real auth on Loki/Grafana.
- Changing how any existing service emits logs (structured-log parsing in Alloy
  could be added later but is not required).
- The Kubernetes overlay (`k8s:*`) — this design targets `compose.deploy.yml`
  only.

## Verification

1. `npm run compose:up`; confirm `loki`, `alloy`, `grafana` reach healthy/started.
2. Open `http://localhost:6300` → Explore → datasource Loki.
3. Query `{service="api-app"}` and confirm API logs stream in.
4. Trigger a workflow run; query `{service="worker"}` and `{service="sandbox"}`
   and confirm worker logs + the ephemeral AI-runner container logs appear.
5. Open the provisioned "Journeyman" dashboard and confirm the log-volume panel
   and per-service filter work.
