# Customer Feedback Summary (Discovery input)

> Sample knowledge-base entry the Analyst mined during Discovery for EPIC-product-search.

## 2026-04 — Search pain themes

- **Signal:** "Can't find products" is the #1 support theme this quarter (312 tickets, +18% QoQ).
- **Source:** `support-tickets/` export, Zendesk tag `search`.
- **Quotes:** "searched for 'wireles headphones' and got nothing"; "filters don't work on mobile".
- **Implication:** typo tolerance + working facets are table stakes → fed EPIC-product-search.

## 2026-04 — Competitor benchmark

- **Signal:** Top 3 competitors all ship autosuggest with thumbnails + typo correction.
- **Source:** `competitors/` teardown.
- **Implication:** autosuggest scoped into STORY-product-search-1.
