---
id: EPIC-product-search
title: Product Search
type: feature
lane: both
phase: done
status: approved
owner: "@priya-pm"
created: 2026-05-08
repos: [web, api, search-svc]
---

# Product Search

## Problem

40% of sessions use search, but the zero-result rate is 11% and search→product-view is
flat. Knowledge base evidence: top support theme is "can't find products"; competitor
teardown shows typo tolerance + autosuggest as table stakes.

## Value & goals

Lift discovery and conversion: zero-result rate < 4%, search→view +15%, CTR +20%
(see [PRD](../../product/prd.md)).

## Scope

**In scope:** search bar + autosuggest, typo-tolerant query, faceted filters, results page.
**Out of scope:** image search, personalized ranking (future epic).

## Stories

| Story | Jira | Status |
|---|---|---|
| [STORY-product-search-1](./stories/STORY-product-search-1.md) — Search bar + autosuggest UI | PROJ-412 | IN PROGRESS |
| [STORY-product-search-2](./stories/STORY-product-search-2.md) — Typo-tolerant query API | PROJ-413 | IN CODE REVIEW |

## Links

- UX: [ux/design-spec.md](./ux/design-spec.md)
- Solution: [architecture.md](./architecture.md)
- Decision: [ADR-0001](../../technical/adr/0001-search-engine.md)
