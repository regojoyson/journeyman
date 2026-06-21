# Shopfront — Product Requirements Document

## Vision

Make Shopfront the fastest way for shoppers to find and buy the right product, with a
search experience that feels instant and forgiving of typos.

## Goals & success metrics

| Goal | Metric | Target |
|---|---|---|
| Help shoppers find products fast | Search → product-view rate | +15% |
| Reduce zero-result searches | Zero-result rate | < 4% |
| Improve relevance | Search-result CTR | +20% |

## Personas

- **Casual shopper** — browses, searches loosely, abandons on friction.
- **Intent buyer** — knows roughly what they want, wants it fast and accurate.

## Scope

**In scope:** keyword search, typo tolerance, faceted filters, autosuggest.
**Out of scope (YAGNI):** visual/image search, personalized ranking (later epic).

## Epics

| Epic | Type | Status | Link |
|---|---|---|---|
| EPIC-product-search | feature | approved | [epic](../epics/EPIC-product-search/epic.md) |
| EPIC-search-infra-hardening | technical | draft | — |

## Constraints & assumptions

- Catalog ~2M SKUs; search must stay < 200ms p95.
- OpenSearch already operated by the @search team (see ADR-0001).
