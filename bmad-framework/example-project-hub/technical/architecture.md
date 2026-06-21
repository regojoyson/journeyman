# Shopfront — System Architecture

## System context

A React storefront (`web`) talks to a Fastify backend (`api`). Product search is
delegated to a dedicated Go service (`search-svc`) backed by OpenSearch. `api` owns the
catalog source-of-truth in PostgreSQL and publishes catalog changes to `search-svc` for
indexing.

## Repos & responsibilities

| Repo | Responsibility | Tech |
|---|---|---|
| web | Storefront UI, search bar, results, facets | React / Next.js |
| api | Catalog, cart, checkout; proxies search queries | Node / Fastify / PostgreSQL |
| search-svc | Index + query, typo tolerance, facets | Go / OpenSearch |

## Cross-cutting concerns

- **Contracts between repos:** `api` ↔ `search-svc` over gRPC; `web` ↔ `api` over REST.
- **Indexing:** `api` emits `catalog.updated` events; `search-svc` consumes + reindexes.
- **Observability:** OpenTelemetry traces across all three; search latency dashboards.

## Key decisions

- [ADR-0001 — Search engine choice](./adr/0001-search-engine.md)
