# 0001. Search engine: OpenSearch over Postgres FTS

- **Status:** accepted
- **Date:** 2026-05-12
- **Deciders:** @search, Architect (Winston)

## Context

Product search needs typo tolerance, faceting, and < 200ms p95 over ~2M SKUs. Postgres
full-text search is already available but weak on typo tolerance and facet performance
at this scale.

## Decision

Use **OpenSearch** in a dedicated `search-svc`, fed by catalog-change events from `api`.

## Consequences

- **Positive:** strong relevance, fuzzy matching, fast facets; isolates search load.
- **Negative / trade-offs:** a new service to operate; eventual consistency between
  catalog writes and the index (bounded by event lag).

## Alternatives considered

- **Postgres FTS** — simplest, but poor typo tolerance + facet latency at 2M SKUs.
- **Algolia (hosted)** — great DX, but cost at our query volume and data-residency concerns.
