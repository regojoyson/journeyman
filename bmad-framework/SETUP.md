# Setup Guide — PDLC + AIDLC Workflow

How to stand up the workflow from scratch. Follow the steps in order. Each step says
**what you do** and **why it matters**.

> New to this? Read [README.md](./README.md) first for the big picture, then come back here.

---

## What you're building (in one breath)

A single **Project Hub** repo that holds all your product + technical context as
markdown. **Jira** tracks status only. An **engine** (Journeyman by default) runs AI
agents at each phase, writes results into the Hub, and asks a human to approve the big
moments. The agents and templates come from the **BMAD** framework.

## Prerequisites

- A Jira project (Epic → Story → Subtask hierarchy enabled).
- Your existing GitHub code repos (the multi-repo project).
- The engine you'll run agents with (Journeyman = reference). Local or hosted.
- BMAD source (the upstream agent/persona/template/checklist files) to copy from.
- Permissions: a Jira API token + a GitHub token the engine can use.

---

## Step 1 — Create the Project Hub repo

**Do:** Create a new, empty git repo named e.g. `project-hub`. Add this folder layout:

```
project-hub/
├── product/        prd.md · roadmap.md · knowledge-base/
├── technical/      architecture.md · adr/ · knowledge-base/
├── epics/          (one folder per epic — created by agents)
├── repos/          registry.yaml
├── process/        workflow.yaml · agents/ · templates/
└── .engine/        (optional) engine adapter config
```

**Why:** The Hub is the single source of truth. Everything else points at it. Keeping
the **process itself** (`process/`) in the Hub means the standard is versioned with the
project and travels with it.

## Step 2 — Vendor BMAD content into `process/`

**Do:** Copy the BMAD pieces you actually use (see the table below) into:

- `process/agents/` — one persona file per role (Analyst, PM, PO, UX, Architect, SM, Dev, QA).
- `process/templates/` — `project-brief`, `prd`, `front-end-spec`, `architecture`, `story`.
- Adapt each to your house style. Add your coding standards / definition-of-done.

| Phase | BMAD agent | Copy these |
|---|---|---|
| Discovery | Analyst (+ Architect) | brainstorming, project-brief, market-research, competitor-analysis, **document-project** |
| Design | UX Expert | front-end-spec, generate-ai-frontend-prompt |
| Grooming | PM + PO | prd (or brownfield-prd), **shard-doc**, po-master-checklist |
| Solution | Architect + SM | fullstack-/brownfield-architecture, architect-checklist |
| Implementation | SM → Dev → QA | create-next-story, story-draft-checklist, story-dod-checklist, QA `*risk *design *trace *nfr *review *gate` |
| Release | (your own agents) | QA `*gate` only |

**Skip:** `bmad-orchestrator`, `bmad-master`, KB-mode, expansion packs. Those are for
interactive chat, not an automated engine.

**Why:** You adopt BMAD's *content*, not its runtime. Your engine is the runtime.

## Step 3 — Fill the repo registry

**Do:** List every code repo in `repos/registry.yaml`:

```yaml
repos:
  api:   { url: github.com/org/api,   tech: node,  owners: [@be] }
  web:   { url: github.com/org/web,   tech: react, owners: [@fe] }
  infra: { url: github.com/org/infra, tech: tf,    owners: [@ops] }
```

**Why:** This is the map of your multi-repo project. Stories reference these short names
(`repos: [api, web]`) so the engine knows exactly what to clone.

## Step 4 — Configure Jira (keep it thin)

**Do:**
1. Build the **Story workflow** with these statuses:
   `NEW → PM SCOPING / ARCHITECTURE SCOPING → READY FOR DEVELOPMENT → IN PROGRESS →
   AWAITING/IN CODE REVIEW → READY FOR TESTING → TESTING → PRE-RELEASE VERIFICATION →
   TO BE DEPLOYED → POST-RELEASE VERIFICATION → READY FOR RELEASE → DONE`.
2. Add **one custom field**: `Hub Path` (link back to the story doc).
3. Add a **webhook** that fires on *issue status change* → the engine's trigger endpoint.
4. **Epics stay in the Hub** — you do *not* create Jira epics. Only stories get issues.

**Why:** Jira holds status (the orchestration signal) and minimal fields. Content lives
in the Hub. The webhook is what turns a status change into an agent run.

## Step 5 — Map statuses to agents in `process/workflow.yaml`

**Do:** Declare which agent runs on each status entry and which transitions are gated:

```yaml
phases:
  pm-scoping:        { agent: pm,           gate: po }
  architecture-scoping: { agent: architect, gate: architect }
  in-progress:       { agent: dev,          gate: none, auto_next: awaiting-code-review }
  in-code-review:    { agent: code-review,  gate: on-flag }
  testing:           { agent: qa,           gate: on-flag }
  pre-release-verification: { agent: release, gate: po }
  to-be-deployed:    { agent: deploy,       gate: none }
  post-release-verification: { agent: prod-verify, gate: qa }
```

**Why:** This is the **trigger contract** — the heart of the standard. Swap the engine
later and this file still describes the same behavior.

## Step 6 — Wire the engine (Journeyman reference)

**Do:** For each phase, create a flow that:
1. Clones the Hub + the story's declared `repos`.
2. Runs the phase agent (persona from `process/agents/`).
3. Opens a Hub PR with the new artifacts (and code PRs for Implementation).
4. **Pauses** for the human gate when `gate` ≠ `none`.
5. On approve → runs the sync step → transitions the Jira status.

**Why:** The engine supplies the hard parts — durable runs, sandboxed multi-repo
clones, human-in-the-loop pauses, multi-provider agents.

## Step 7 — Configure the sync (no drift)

**Do:** Set up two one-way syncs:
- **Content → Jira:** when a story/epic doc is added/changed in the Hub, create or
  update the matching Jira issue. On first creation, write `jiraKey` back into the
  doc's frontmatter.
- **Status → Hub:** when Jira status changes, echo it (read-only) into the doc's
  `status:` frontmatter.

**Why:** Content flows one way, status flows the other, on *different* fields — so they
can never fight. The stable story `id` + `jiraKey` keeps the link unbreakable.

## Step 8 — Set gates + notifications

**Do:**
- **Notify every phase** (Slack/Jira comment) so humans always have visibility.
- **Block** only at: Discovery approval, Ready-for-Development, and Release.
- **Escalate** automatically: any agent that flags a problem opens a gate.

**Why:** Human-in-the-loop without click-fatigue. Exception-based, not approve-everything.

## Step 9 — Dry-run one epic end to end

**Do:** Take a small, real epic. Run Discovery → Design → Grooming in the Hub, let it
mirror a story or two into Jira, and walk the story through to `DONE`. Watch the gates,
the PRs, and the sync.

**Why:** Proves the whole loop before you roll it out to the team.

---

## Who does what (lanes)

| | 🟣 Product lane | 🔵 Developer lane |
|---|---|---|
| **Agents** | Analyst, PM, PO, UX Expert | Architect, SM, Dev, QA + Deploy/Verify |
| **Drives** | Discovery (product), Design, Grooming | Discovery (technical), Solution, Implementation, Release |
| **Approves** | epic prioritization, design sign-off, release | architecture, code review, QA gate, deploy |

**Bridges:** the **SM** turns product stories into dev-ready work; the **PO** stays in
the loop at every gate.

## Day-to-day: how one feature flows

1. Discovery agents draft epics from the knowledge bases → the team iterates → PO approves.
2. UX Expert drafts the design → sign-off.
3. PM/PO write the PRD and shard it into ranked stories → those mirror into Jira.
4. Architect designs the solution → Lead approves.
5. Dev + QA implement each story across its repos → review/test → QA gate.
6. Release agents deploy + verify → PO approves → `DONE`.
7. Every artifact stays in the Hub forever as the project's memory.

## Troubleshooting

- **An agent didn't run on a status change** → check the Jira webhook fired and the
  status name matches `process/workflow.yaml` exactly.
- **A story exists in Jira but has no doc (or vice-versa)** → check the sync step and
  the `jiraKey` write-back; the story `id` is the anchor.
- **Status looks wrong in the Hub doc** → it's a read-only echo; Jira is canonical for
  status. Fix it in Jira and let the echo catch up.
- **Cross-repo PR partially failed** → the story holds at its current status and
  escalates; it never advances half-done.
