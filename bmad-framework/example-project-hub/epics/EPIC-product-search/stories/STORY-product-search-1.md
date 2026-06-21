---
id: STORY-product-search-1
title: Search bar + autosuggest UI
epic: EPIC-product-search
jiraKey: PROJ-412
repos: [web]
points: 5
lane: developer
status: IN PROGRESS      # read-only echo of Jira
created: 2026-06-02
---

# Search bar + autosuggest UI

## User story

As a shopper, I want an instant, typo-forgiving search bar with suggestions, so that I
can find products without typing the exact name.

## Acceptance criteria

- [ ] Search bar present in the global header on every storefront page.
- [ ] After 2 characters, autosuggest shows up to 5 products + 3 category chips (150ms debounce).
- [ ] Full keyboard navigation; ARIA combobox semantics; visible focus.
- [ ] Submitting navigates to the results page with the query preserved.
- [ ] Zero-result state shows the "Did you mean …" suggestion from the API.

## Technical notes

- Consume `GET /search` per [epic architecture](../architecture.md#api--contracts).
- Component lives in `web/components/search/`. Reuse existing header layout.

## Definition of Done

- [ ] Code + tests merged in `web`
- [ ] Code review passed
- [ ] QA / quality gate passed
- [ ] Storybook entry + docs updated
