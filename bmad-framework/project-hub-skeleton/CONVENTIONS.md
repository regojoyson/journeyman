# Conventions

The rules that keep the Hub machine-readable and in sync with Jira. Agents and the sync
step rely on these — keep them exact.

## Frontmatter schemas

Every epic and story doc starts with YAML frontmatter.

### Epic (`epics/EPIC-<slug>/epic.md`)

```yaml
---
id: EPIC-<slug>            # stable, unique, kebab-case. Never changes.
title: <human title>
type: feature | technical  # which discovery track produced it
lane: product | developer | both
phase: discovery | design | grooming | done   # Zone 1 phase (Hub-driven)
status: draft | in-review | approved
owner: <name or @handle>
created: YYYY-MM-DD
repos: [<short names from repos/registry.yaml>]   # likely-touched repos
---
```

### Story (`epics/EPIC-<slug>/stories/STORY-<id>.md`)

```yaml
---
id: STORY-<epic-slug>-<n>  # stable, unique. Never changes.
title: <human title>
epic: EPIC-<slug>
jiraKey: null              # written back once, on first mirror to Jira
repos: [api, web]          # which code repos this story touches → engine clones these
points: null               # set during Solution sizing
lane: developer
status: null               # READ-ONLY echo of the Jira status. Do not hand-edit.
created: YYYY-MM-DD
---
```

## The two sync directions (don't fight them)

- **CONTENT → Jira** (Hub canonical): title, description, links flow Hub → Jira.
- **STATUS ← Jira** (Jira canonical): the `status:` field is an echo. Change status in
  **Jira**, not here.
- `id` is the anchor and is permanent. `jiraKey` is written back once and never edited.

## Naming

- Epics: `EPIC-<kebab-slug>` (e.g. `EPIC-product-search`).
- Stories: `STORY-<epic-slug>-<n>` (e.g. `STORY-product-search-1`).
- ADRs: `NNNN-<kebab-title>.md`, zero-padded sequence (e.g. `0001-search-engine.md`).
- Repos: short names in `repos/registry.yaml`; stories reference those names.

## Where things live

| Artifact | Location | Owner phase |
|---|---|---|
| Master PRD | `product/prd.md` | Grooming |
| Epic doc | `epics/EPIC-x/epic.md` | Discovery |
| UX / design spec | `epics/EPIC-x/ux/design-spec.md` | Design |
| Solution architecture | `epics/EPIC-x/architecture.md` | Solution |
| Stories | `epics/EPIC-x/stories/STORY-*.md` | Grooming |
| System architecture | `technical/architecture.md` | Discovery/Solution |
| Decisions | `technical/adr/NNNN-*.md` | any |
| Knowledge bases | `product/knowledge-base/`, `technical/knowledge-base/` | Discovery inputs |
