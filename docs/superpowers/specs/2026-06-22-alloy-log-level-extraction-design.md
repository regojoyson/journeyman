# Pino Log-Level Extraction in the Alloy Pipeline

**Date:** 2026-06-22
**Status:** Approved — ready for implementation plan

## Goal

Make Grafana show and filter log levels (`info` / `warn` / `error` / …) for the
built-in services — api-app, api-webhooks, api-control-plane, worker, analytics,
and the ephemeral `sandbox` runners. Today these show no level at all.

## Problem

The services log via **pino** (`packages/core/src/logger.ts`). In production
(`NODE_ENV=production`, which `compose.deploy.yml` sets) pino writes JSON to
stderr with a **numeric** level field:

```json
{"level":30,"time":1782137032743,"ns":"worker","msg":"…"}
```

Pino numeric levels: `10` trace, `20` debug, `30` info, `40` warn, `50` error,
`60` fatal.

Loki's built-in level auto-detection (`detected_level`) only recognizes **string**
levels — logfmt `level=info` or JSON `"level":"info"`. It sees pino's `"level":30`
and assigns no level. That is why Loki's *own* logs (logfmt) carry a level but the
pino services do not.

This was chosen to be fixed in the **Alloy pipeline**, not the logger: the app
logger stays the single source of truth and its emitted format is unchanged. No
downstream consumer reads the numeric wire level — the in-app instance-logs panel
uses a separate structured-event path (`append-step-event` / `LogTail`), not the
stdout/stderr stream Alloy captures.

## Approach

Insert a `loki.process` component between `loki.source.docker` and
`loki.write.default`. It runs **only for the pino services** (via a `stage.match`
selector, so postgres/redis/conductor/loki/web logs are never JSON-parsed),
extracts pino's numeric `level`, maps it to a name, and promotes it to a
low-cardinality **`level` stream label**.

A `level` label makes both of these work:
- LogQL filtering: `{service="worker", level="error"}`
- Grafana log-line colorization (the logs panel recognizes a field named `level`).

### Data flow change

```
discovery.docker → discovery.relabel
   → loki.source.docker   (forward_to → loki.process.levels.receiver)   ← changed
   → loki.process.levels  (NEW: stage.match → json → template → labels)
   → loki.write.default
```

## Change to `infra/logging/alloy-config.alloy`

### 1. Repoint the source

`loki.source.docker "containers"` `forward_to` changes from
`[loki.write.default.receiver]` to `[loki.process.levels.receiver]`.

### 2. Add the processor

```alloy
loki.process "levels" {
  forward_to = [loki.write.default.receiver]

  // Only the pino-JSON services; everything else (postgres, redis, conductor,
  // loki, web) passes straight through and keeps Loki's own detected_level.
  stage.match {
    selector = "{service=~\"api-app|api-webhooks|api-control-plane|worker|analytics|sandbox\"}"

    stage.json {
      expressions = { level = "level" }   // pino's numeric level field
    }
    stage.template {
      source   = "level"
      template = "{{ if eq .Value \"10\" }}trace{{ else if eq .Value \"20\" }}debug{{ else if eq .Value \"30\" }}info{{ else if eq .Value \"40\" }}warn{{ else if eq .Value \"50\" }}error{{ else if eq .Value \"60\" }}fatal{{ else }}{{ .Value }}{{ end }}"
    }
    stage.labels {
      values = { level = "" }   // promote extracted `level` to a stream label
    }
  }
}
```

The `stage.json` reads pino's top-level `level` key into the extracted map.
`stage.template` rewrites that key from the number to a name (passing through any
unexpected value unchanged). `stage.labels` with an empty string promotes the
extracted `level` to a stream label of the same name.

## Boundaries / behavior

- **Cardinality:** `level` has ≤6 distinct values — safe as a stream label.
- **Non-matching services:** not processed; keep Loki's `detected_level`.
- **Matching but non-JSON or level-less lines:** `level` stays empty in the
  extracted map; Loki drops empty-value labels, so no spurious `level=""`.
- **Display only:** services still emit at `LOG_LEVEL=info` by default, so
  `debug`/`trace` lines won't appear unless `LOG_LEVEL` is lowered. Out of scope.
- **No app changes, no new services, no `compose.deploy.yml` changes.**

## Out of scope (YAGNI)

- Extracting pino `msg` / `ns` / `time` as labels or reshaping the log body.
- Normalizing levels for infra services (loki, conductor, postgres, redis).
- Changing the logger output format (the alternative we rejected).
- Adjusting default `LOG_LEVEL`.

## Verification

1. `docker run --rm -v …/alloy-config.alloy:/etc/alloy/config.alloy:ro grafana/alloy:v1.10.0 fmt …` — config still parses.
2. Restart Alloy: `docker compose -f compose.deploy.yml up -d alloy`.
3. With an app service running (e.g. worker), query Loki for label values:
   `…/loki/api/v1/label/level/values` returns `info`, `warn`, `error`, etc.
4. In Grafana Explore, `{service="worker", level="error"}` returns only error
   lines, and the logs panel colorizes lines by level.
