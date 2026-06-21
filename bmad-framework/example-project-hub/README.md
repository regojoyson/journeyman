# Example Project Hub — "Shopfront"

A **filled-in** example of the [Project Hub skeleton](../project-hub-skeleton/), for a
fictional e-commerce platform called **Shopfront**. Use it to see what real content looks
like and how the pieces connect.

It shows one epic — **EPIC-product-search** — partway through the workflow: discovery,
design, and solution are done; two stories are mirrored into Jira and mid-flight in the
dev workflow.

## What to look at

| File | Shows |
|---|---|
| [`repos/registry.yaml`](./repos/registry.yaml) | three real repos the project spans |
| [`product/prd.md`](./product/prd.md) | a concrete PRD with goals + metrics |
| [`technical/architecture.md`](./technical/architecture.md) | system architecture across repos |
| [`technical/adr/0001-search-engine.md`](./technical/adr/0001-search-engine.md) | a real decision record |
| [`epics/EPIC-product-search/epic.md`](./epics/EPIC-product-search/epic.md) | a filled epic (`phase: done`) |
| [`epics/EPIC-product-search/ux/design-spec.md`](./epics/EPIC-product-search/ux/design-spec.md) | UX/design spec |
| [`epics/EPIC-product-search/architecture.md`](./epics/EPIC-product-search/architecture.md) | per-epic solution design |
| [`.../stories/STORY-product-search-1.md`](./epics/EPIC-product-search/stories/STORY-product-search-1.md) | a story `IN PROGRESS`, `repos: [web]` |
| [`.../stories/STORY-product-search-2.md`](./epics/EPIC-product-search/stories/STORY-product-search-2.md) | a story `IN CODE REVIEW`, `repos: [api, search-svc]` |

## Notice how the sync shows up

- Each story's `jiraKey` is filled (it was mirrored to Jira) and its `status` is the
  **read-only echo** of the live Jira status.
- The `repos:` lists differ per story — that's exactly what the engine clones for each.
