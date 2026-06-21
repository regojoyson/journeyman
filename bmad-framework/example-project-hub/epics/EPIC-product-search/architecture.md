# Solution Architecture — Product Search

> Produced in Solution by the Architect (Winston). Approved 2026-05-26.

## Impact

- **web:** new search bar, autosuggest, results page, facet rail.
- **api:** `/search` proxy endpoint → gRPC to `search-svc`; emits `catalog.updated`.
- **search-svc:** new query handler (fuzzy + facets), index mapping for products.

## Approach

`web` calls `api /search?q=&facets=`; `api` forwards to `search-svc` over gRPC and shapes
the response for the storefront. Indexing is event-driven: `api` already owns the catalog
and emits change events that `search-svc` consumes.

## API / contracts

- REST `GET /search` (api): `q`, `facets[]`, `page` → `{ results[], facets[], total, suggestion? }`
- gRPC `Search.Query` (search-svc): mirrors the above; adds `fuzziness`.

## Data

- OpenSearch index `products-v1` with analyzers for typo tolerance; facet fields keyword-mapped.
- No PostgreSQL schema change (catalog already exists).

## Security & NFRs

- p95 < 200ms at 2M SKUs; query rate limit per IP; no PII in search logs.

## Sequencing

1. `search-svc` query + index mapping (STORY-2, backend)
2. `api` `/search` proxy (STORY-2 continues)
3. `web` UI against the contract (STORY-1) — can start once the contract is fixed.

## Decisions

- [ADR-0001 — Search engine choice](../../technical/adr/0001-search-engine.md)
