# Folder Guide — what each folder is for & how it's used

A plain-language tour of the Project Hub. Two parts: **what each folder is for**, then
**the order they fill** as one epic moves through the workflow.

---

## Part 1 — What each folder is for

Lane = who owns it: 🟣 Product · 🔵 Developer · 🟢 Both · ⬜ Standard (the rulebook).

| Folder / file | Lane | What it's for | Written by | Read by |
|---|---|---|---|---|
| `product/` | 🟣 | Product context — `prd.md`, `roadmap.md` | PM, PO (Grooming) | all product agents |
| `product/knowledge-base/` | 🟣 | Discovery **inputs**: analytics, feedback, competitors, support, RFPs, trends | feeder jobs / team | Analyst (Discovery) |
| `technical/` | 🔵 | System `architecture.md` + decisions `adr/` | Architect (Discovery/Solution) | Dev, QA, Architect |
| `technical/knowledge-base/` | 🔵 | Discovery **inputs**: static analysis, deps, crashes, perf | feeder jobs | Architect & tech-discovery agents |
| `epics/EPIC-x/` | 🟢 | One folder = one epic's **full context** | many (see Part 2) | every agent on that epic |
| `epics/EPIC-x/epic.md` | 🟢 | The epic itself (problem, value, scope) | Analyst (Discovery) | all |
| `epics/EPIC-x/ux/` | 🟣 | UX flows, wireframes, design spec | UX Expert (Design) | Dev, PO |
| `epics/EPIC-x/architecture.md` | 🔵 | Per-epic solution design (impact, API, DB) | Architect (Solution) | Dev, QA |
| `epics/EPIC-x/stories/` | 🟢 | The unit that **crosses into Jira**. Each `STORY-*.md` carries `jiraKey`, `repos[]`, echoed `status` | PO (Grooming), SM | Dev, QA, sync |
| `repos/registry.yaml` | ⬜ | The **multi-repo map**. A story's `repos:[]` resolves here → engine clones those repos | team | engine |
| `process/workflow.yaml` | ⬜ | Phases → agent → gate. The engine reads this to know **what to run when** | team (once) | engine |
| `process/agents/` | ⬜ | One persona-contract per role (reads / produces / BMAD tasks) | seeded from BMAD | engine |
| `process/templates/` | ⬜ | Doc templates agents copy when creating epics/stories | team | agents |
| `CONVENTIONS.md` | ⬜ | Frontmatter schemas + the two one-way **sync rules** | team (once) | everyone + sync |

> **Inputs vs outputs:** the `knowledge-base/` folders are *fed in* (Discovery reads them).
> Everything else under `product/`, `technical/`, and `epics/` is *written out* by agents.

---

## Part 2 — The order they fill (example: `EPIC-product-search`)

### 🟣 Zone 1 — written in the Hub (no Jira issues yet)

| # | Phase | Agent(s) | Reads | Writes |
|---|---|---|---|---|
| 1 | **Discovery** | Analyst + Architect | both `knowledge-base/` | `epics/EPIC-product-search/epic.md`, updates `technical/architecture.md`, `adr/0001-search-engine.md` |
| 2 | **Design** | UX Expert | `epic.md` | `epics/EPIC-product-search/ux/design-spec.md` |
| 3 | **Grooming** | PM + PO | `epic.md`, UX | updates `product/prd.md`, writes `stories/STORY-product-search-1.md` & `-2.md` (with `repos:[]`) |

→ **HANDOFF:** approved stories are **mirrored to Jira** (each gets a `jiraKey`). Gate: PO/PM.

### 🔵 Zone 2 — Jira drives; agents still write the Hub + the code repos

| # | Phase | Agent(s) | Reads | Writes |
|---|---|---|---|---|
| 4 | **Solution** | Architect + SM | epic + UX | `epics/EPIC-product-search/architecture.md`; SM sets `points` on each story |
| 5 | **Implementation** | Dev → Code Review → QA | `STORY-*.md` + `repos/registry.yaml` | **code** to the story's `repos` (one PR each) + test notes; `status` echoes from Jira |
| 6 | **Release** | Release → Deploy → Verify | merged PRs | verification result; story → `DONE` |

> `process/` and `CONVENTIONS.md` are **never written during a run** — they're the rules the
> engine reads *throughout*.

---

## The two rules to remember

1. **One epic folder = one epic's whole life.** Read `epics/EPIC-x/` and you have all the
   context — no hunting across the repo.
2. **Content flows Hub→Jira; status flows Jira→Hub.** Different fields, opposite directions,
   so they never conflict. See [`CONVENTIONS.md`](./CONVENTIONS.md).

See it filled in: [`../example-project-hub/`](../example-project-hub/).
