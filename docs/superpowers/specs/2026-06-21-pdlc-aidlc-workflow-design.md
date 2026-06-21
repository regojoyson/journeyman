# PDLC + AIDLC Workflow — Design Spec

**Date:** 2026-06-21
**Status:** Draft for review
**Author:** Samuel Rego (with Claude)

## In plain words (what this is)

We want one standard way to take an idea all the way to a shipped feature, across
several code repos, using AI agents at every step and humans approving the
important moments.

- **Jira** holds the *status* — where a piece of work is right now. Moving a ticket
  forward is what makes the next agent run.
- A new **Project Hub** repo holds *all the real content* — PRDs, epics, stories,
  UX/design, architecture — as plain markdown files. This is the project's memory.
- **AI agents** (organized using the **BMAD** framework's roles) do the actual work
  in each phase and write their results into the Hub.
- **Humans** are always told what happened, and must approve the big gates.
- The whole thing is a **standard** that any engine can run. **Journeyman** is the
  default engine, but it's swappable.

## Goal & scope

Define a portable, engine-agnostic standard for a Product + AI Development Life
Cycle (PDLC/AIDLC) that:

1. Spans **one Jira project across multiple GitHub repos**.
2. Uses the **BMAD** framework's agent roles, templates, and checklists as the
   content of each phase.
3. Stores **all context** in a single **Project Hub** repository.
4. Keeps **Jira thin** (status + minimal fields) and **Hub canonical** (content).
5. Puts a **human in the loop** with notify-every-phase + block-at-key-gates.

This spec defines the **standard**. It names Journeyman as the reference engine but
does not design Journeyman flows in detail — that belongs in the implementation plan.

Out of scope: the knowledge-base feeder jobs (analytics/crash-report ingestion), the
concrete Jira automation rules, and per-engine adapter code. Those are follow-ups.

## Core model

Two layers with a clean split of responsibility:

| Layer | Owns | Holds |
|---|---|---|
| **Jira** | *status* (the orchestration signal) | thin tracking: title, key, assignee, links, status |
| **Project Hub** (new repo) | *content* (the "why & what") | all BMAD artifacts as versioned markdown |
| **Engine** (Journeyman = ref impl) | *execution* | triggers, sandbox, agents, pauses, sync |

**The universal phase loop** (repeats for every phase):

1. A status change (Jira) or Hub state change fires a trigger.
2. The engine maps the trigger to that phase's agent(s).
3. The engine clones the Hub (+ any target code repos) into a sandbox.
4. The agent(s) read Hub context, do the work, write markdown artifacts back, open a Hub PR.
5. **Human gate**: notify always; block at key gates; auto-escalate if an agent flags an issue.
6. Sync + advance: mirror approved content to Jira, move to the next status → next phase.

## Standard vs engine (the portability contract)

The **standard** is fixed and lives in the Hub under `process/`. It defines:

- **Phase state machine** — statuses, transitions, and which transitions are human-gated.
- **Hub structure** — folder layout + artifact schemas (markdown + frontmatter).
- **Agent role contracts** — per phase: what context it reads, what artifacts it must produce.
- **Jira mirror contract** — Hub-first content mirroring + status echo (see Sync).
- **Multi-repo conventions** — the repo registry + how a story declares target repos.
- **Trigger contract** — "state X entered ⇒ run phase X's agents."

The **engine** is pluggable: Journeyman (reference — durable runs, pauses, sandbox,
multi-provider), GitHub Actions, another agent framework, or a human following the
process manually. This mirrors Journeyman's own provider pattern, one level up.

## Two orchestration zones

The phases split across two zones, joined at Grooming.

### Zone 1 — Hub-driven (Epics): Discovery → Design → Grooming

- **No Jira issues.** Epics are markdown docs in the Hub.
- Phase lives in the epic's frontmatter (`phase: design`).
- Transitions = Hub PRs merged after review.
- Agents triggered by Hub state changes (engine-agnostic).
- Grooming's output is a set of **Story docs** in the Hub.

### Zone 2 — Jira-driven (Stories): Scoping → Dev → Review → Test → Release

- Each story doc is **mirrored to a Jira issue** (status `NEW`).
- Jira **status** is the orchestration spine; status entry triggers the phase agent (webhook).
- Agents write artifacts to the Hub; code goes to the code repos.
- Terminal: `DONE`.

**The handoff:** Grooming approves a set of story docs → sync mirrors them into Jira →
the dev workflow begins.

## Phases

### 1. Discovery (crucial, collaborative, iterative)

Two parallel tracks converging at one collaborative human gate. Unlike later phases,
Discovery is **iterative**: pause → human input → re-run agents → re-draft, multiple
rounds, before epics lock.

| Track | Inputs (Hub KB) | Agent + sub-roles | Output |
|---|---|---|---|
| **Product** | analytics, customer feedback, competitors, support tickets, RFPs, market trends | Product Discovery: UI/UX reviewer, feature-gap, competitor, user-feedback, monetization, roadmap | Feature Backlog Epics |
| **Technical** | source repos, PR history, static analysis, dependencies, crash reports, perf, CI/CD logs | Tech Discovery: code-quality, dependency, architecture, performance, test-quality | Technical Backlog Epics |

**Gate:** BA + Developers + PO + Architects review draft epics together, iterate with
agents, then prioritize & approve. Approved epics advance (frontmatter `phase: design`).

### 2. Design (Product lane)

UX Expert produces UX flows, wireframes, and a design spec into `epics/EPIC-x/ux/`.
Gate: PO/Designer sign-off.

### 3. Grooming (Product lane, with SM bridge)

PM authors/refines the PRD; PO shards epics into ranked **Story docs** and validates
cohesion. SM checks story readiness. Gate: PO/PM approve. **This is the handoff into Jira.**

### 4. Solution (Developer lane, with PO sprint mapping)

Architect produces the architecture/impact doc (API, DB, security, scalability) into
`epics/EPIC-x/architecture.md`; SM estimates/sizes; PO maps to sprints/iterations.
Gate: Architect/Lead approval.

### 5. Implementation (Developer lane)

Per story, in Jira's dev workflow. SM drafts the dev-ready story → Dev implements +
writes tests, clones the story's declared repos, opens one code PR per repo → QA runs
code review and test architecture. Notify always; gate on flag + at code review/QA.

### 6. Release (mixed)

Pre-release verification, deploy, post-release verification. BMAD contributes only the
QA `*gate` (release-quality). Deploy + production verification are your own agents
(CI/CD trigger, feature flags, smoke tests, critical journeys, API health). Gates: PO
release approval; QA verification / rollback decision.

## Jira workflows

Two workflows at two levels (the first diagram spans both).

**Epic level (Zone 1):** lives in the Hub only (no Jira). Phase tracked in frontmatter.

**Story level (Zone 2)** — the real dev workflow:

```
NEW → PM SCOPING / ARCHITECTURE SCOPING → READY FOR DEVELOPMENT
    → IN PROGRESS → AWAITING/IN CODE REVIEW → READY FOR TESTING → TESTING
    → PRE-RELEASE VERIFICATION → TO BE DEPLOYED → POST-RELEASE VERIFICATION
    → READY FOR RELEASE → DONE
```

Status → agent → gate mapping:

| Status | Agent on entry | Gate |
|---|---|---|
| `NEW` | mirror from Hub | ⚙️ auto-route |
| `PM SCOPING` | PM/Product agent refines context | 🔒 PO |
| `ARCHITECTURE SCOPING` | Architecture agent writes design/impact | 🔒 Architect |
| `READY FOR DEVELOPMENT` | queue | ⚙️ on capacity |
| `IN PROGRESS` | Dev agent: implement + tests + code PR(s) | ⚙️ → ready for review |
| `AWAITING/IN CODE REVIEW` | Code Review agent (standards, security, perf, arch) | ⚙️ unless flagged |
| `READY FOR TESTING / TESTING` | Test/QA agent | ⚙️ unless flagged |
| `PRE-RELEASE VERIFICATION` | Release agent (quality, notes, candidate) | 🔒 PO · or "No Release Needed" → DONE |
| `TO BE DEPLOYED` | Deployment agent (CI/CD, flags) | ⚙️ Deployed |
| `POST-RELEASE VERIFICATION` | Production Verification agent (smoke, journeys, API health) | 🔒 QA/PO or rollback |
| `READY FOR RELEASE → DONE` | released | ⚙️ terminal |

**Gating model (reconciled):** *notify* every phase (Slack/Jira comment), *block* at
key gates (Ready-for-Dev, Release, Discovery approval), *escalate* on any agent flag.

## Project Hub structure

One repo, canonical context for the whole project:

```
project-hub/
├── product/
│   ├── prd.md                  # master PRD
│   ├── roadmap.md
│   └── knowledge-base/         # Discovery input · Product KB
│       └── analytics/ customer-feedback/ competitors/ support-tickets/ rfps/ market-trends.md
├── technical/
│   ├── architecture.md         # system-wide
│   ├── adr/                    # decision records
│   └── knowledge-base/         # Discovery input · Technical KB
│       └── static-analysis/ dependencies/ crash-reports/ perf/
├── epics/
│   └── EPIC-product-search/
│       ├── epic.md             # frontmatter: phase, type, owner
│       ├── ux/design-spec.md   # Design output
│       ├── architecture.md     # Solution: impact, API, DB
│       └── stories/
│           ├── STORY-001.md    # frontmatter: id, jiraKey, repos[], status
│           └── STORY-002.md
├── repos/
│   └── registry.yaml           # multi-repo map: name, url, purpose, tech, owners
├── process/                    # THE STANDARD (engine-agnostic)
│   ├── workflow.yaml           # phases, status→agent, gates
│   ├── agents/                 # BMAD role defs + prompts
│   └── templates/              # epic/story/adr/design-spec templates
└── .engine/                    # optional adapter config (e.g. Journeyman flows)
```

Principles: per-epic context is **co-located** (one folder = full context); stories
**declare their repos**; the **process lives in the Hub** (versioned + portable); KBs
are folders refreshed by feeders and read by Discovery agents.

## Multi-repo coordination

- `repos/registry.yaml` is the map of all repos (url, purpose, tech, owners).
- A story declares its targets in frontmatter: `repos: [api, web]`.
- The Dev agent clones **Hub + the declared code repos** into one sandbox, implements
  across them, opens **one code PR per repo**, and cross-links them in the story doc and Jira.

## Hub ↔ Jira sync (no drift)

Two **one-way** flows on **different fields** — never bidirectional on the same field:

- **CONTENT → Jira (Hub canonical):** story/epic docs create/update the Jira issue
  (title, description, links). Hub wins.
- **STATUS ← Jira (Jira canonical):** a Jira status change is echoed into the doc's
  `status:` frontmatter (read-only). Jira wins.
- **Identity:** the story file `id` is stable from birth; `jiraKey` is written back once
  on first mirror. That link never breaks.

Full lifecycle: Discovery/Design/Grooming run in Hub → approved story docs → mirror to
Jira (`NEW`) + write `jiraKey` back → Jira status drives the dev workflow → agents run
per phase, artifacts to Hub, code to repos → notify/gate/escalate → `DONE`, context
preserved forever in the Hub.

## BMAD adoption

**Adopt BMAD's *content* (personas, templates, checklists, key tasks) into `process/`.
Do not adopt its interactive runtime** — the engine is the runtime.

Phase → BMAD agent → tasks/templates → output:

| Phase | BMAD agent | Use these | Produces (→Hub) |
|---|---|---|---|
| Discovery | Analyst (+ Architect for tech) | facilitate-brainstorming, `project-brief-tmpl`, `market-research-tmpl`, `competitor-analysis-tmpl`, **document-project** (brownfield) | brief, research → Feature + Technical epics |
| Design | UX Expert | `front-end-spec-tmpl`, **generate-ai-frontend-prompt** | design/UX spec |
| Grooming | PM + PO | `prd-tmpl`/`brownfield-prd-tmpl`, **shard-doc**, `po-master-checklist` | PRD + ranked stories |
| Solution | Architect + SM | `fullstack-architecture-tmpl`/`brownfield-architecture-tmpl`, `architect-checklist`, sizing | architecture + tasks |
| Implementation | SM → Dev → QA | **create-next-story**, `story-draft-checklist`, `story-dod-checklist`, QA `*risk *design *trace *nfr *review *gate` | code + tests + QA gate |
| Release | *(your own agents)* | QA `*gate` only | deploy + verification |

**Skip:** `bmad-orchestrator`, `bmad-master`, KB-mode, advanced-elicitation, expansion
packs, BMAD's web-UI planning runtime.

**Ordering note:** BMAD's canonical order is PRD → UX → architecture. This pipeline does
**Design (UX) before Solution (architecture)** and grooms stories before Solution. We
adopt BMAD's *artifacts*, not its sequence.

### Product lane vs Developer lane

| Phase | 🟣 Product lane | 🔵 Developer lane |
|---|---|---|
| Discovery | **Analyst** — research → Feature epics · 🔒 PO/PM | **Architect** — document-project scan → Technical epics · 🔒 Architect |
| Design | **UX Expert** — design spec · 🔒 PO/Designer | — (feasibility input only) |
| Grooming | **PM + PO** — PRD, shard, prioritize · 🔒 PO/PM | **SM** — story readiness |
| Solution | **PO** — sprint mapping, scope sign-off | **Architect** — architecture; **SM** — sizing · 🔒 Architect/Lead |
| Implementation | — (PO clarifications only) | **Dev** + **QA** — code, review, tests, gate · 🔒 Lead/QA |
| Release | **PO** — release approval, notes, rollback call · 🔒 PO | **Deployment + Production Verification** (own) · 🔒 QA |

- **Product owns:** Analyst, PM, PO, UX Expert; Discovery(product)/Design/Grooming;
  gates for *what & why*; artifacts brief/research/PRD/UX/ranked stories.
- **Developer owns:** Architect, SM, Dev, QA + Deploy/Verify; Discovery(technical)/
  Solution/Implementation/Release; gates for *how & sound*; artifacts architecture/
  ADRs/code/tests/gates.
- **Bridges:** SM (product story → dev-ready work), PO (in the loop at every gate).

## Error handling & edge cases

- **Agent flag → gate:** any agent that detects a problem (failed checks, ambiguity,
  conflict) opens a human gate instead of advancing.
- **Rejected gate:** loops back to the phase agent with the reviewer's feedback for a re-run.
- **Sync conflict:** content/status are separate one-way fields, so conflicts can't form
  on the same field; a failed mirror retries and surfaces to the notify channel.
- **Cross-repo partial failure:** if one repo's PR fails, the story holds at its current
  status and escalates rather than advancing partially.
- **Discovery iteration:** explicitly multi-round; no cap, ends on human approval.

## Testing strategy

- **Contract tests** for the standard: validate Hub artifact schemas (frontmatter
  required fields), `repos/registry.yaml`, and `process/workflow.yaml`.
- **Sync tests:** Hub→Jira content mirror and Jira→Hub status echo, including idempotency
  and the `jiraKey` write-back.
- **Trigger tests:** status/state change → correct phase agent selected.
- **Gate tests:** notify/block/escalate behavior, including reject-loop.
- **Dry-run** a single epic end-to-end (Discovery → DONE) on a sample multi-repo project
  before rollout.

## Open questions (for the implementation plan)

1. Concrete trigger mechanism per engine (Jira webhook vs polling) for the reference impl.
2. Exact frontmatter schemas (fields, enums) for epic/story/ADR.
3. Where the engine stores pause/run state for Zone-1 (Hub-driven) phases.
4. KB feeder jobs — ownership, cadence, format.
5. How `process/agents/` prompts are seeded from BMAD's upstream files (vendor + adapt).
