---
id: STORY-product-search-2
title: Typo-tolerant query API
epic: EPIC-product-search
jiraKey: PROJ-413
repos: [api, search-svc]
points: 8
lane: developer
status: IN CODE REVIEW   # read-only echo of Jira
created: 2026-06-02
---

# Typo-tolerant query API

## User story

As the storefront, I want a fast, typo-tolerant search endpoint with facets, so that the
UI can show relevant results and "did you mean" suggestions.

## Acceptance criteria

- [ ] `GET /search` on `api` proxies to `search-svc` over gRPC and shapes the response.
- [ ] Fuzzy matching tolerates 1–2 char typos; returns a `suggestion` on low/zero hits.
- [ ] Facets returned for category, brand, price band.
- [ ] p95 latency < 200ms at catalog scale (load-tested).
- [ ] No PII written to search logs.

## Technical notes

- Spans two repos — `search-svc` (query handler + index mapping `products-v1`) and `api`
  (REST proxy). One PR per repo, cross-linked.
- Contract: see [epic architecture](../architecture.md#api--contracts).

## Definition of Done

- [ ] Code + tests merged in `api` and `search-svc`
- [ ] Code review passed (security: query injection, rate limiting)
- [ ] QA gate passed incl. load test
- [ ] API docs updated
