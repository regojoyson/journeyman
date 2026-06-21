# UX / Design Spec — Product Search

> Produced in Design by the UX Expert (Sally). Approved 2026-05-20.

## User flows

1. Shopper focuses the search bar → autosuggest shows top 5 products + 3 categories after 2 chars.
2. Shopper submits → results page with relevance-ranked grid + left-hand facets.
3. Zero results → "Did you mean …" typo suggestion + popular categories fallback.

## Wireframes

- Search bar (collapsed/expanded) — see `figma: shopfront/search-bar`
- Results page with facets — see `figma: shopfront/search-results`

## Screen specs

| Screen | Key elements | Notes |
|---|---|---|
| Autosuggest | product thumbs, category chips, recent searches | debounce 150ms; keyboard nav |
| Results | grid, facet rail, sort dropdown, result count | infinite scroll, 24/page |
| Zero-result | suggestion line, popular categories | never a dead end |

## Accessibility

- Full keyboard navigation of suggestions; ARIA combobox semantics; visible focus.

## Open UX questions

- Show prices in autosuggest, or product name only? (PO to confirm)
