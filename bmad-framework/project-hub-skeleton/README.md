# Project Hub — Skeleton

This is a ready-to-copy starting point for a **Project Hub** repo that follows the
[PDLC + AIDLC workflow](../README.md). Copy this whole folder into a new git repo, then
fill it in as your project grows.

## What goes where

```
project-hub/
├── CONVENTIONS.md          ← read this: frontmatter schemas + naming rules
├── product/                ← product context (Product lane)
│   ├── prd.md              ← master PRD
│   ├── roadmap.md
│   └── knowledge-base/     ← Discovery inputs (analytics, feedback, competitors, …)
├── technical/              ← technical context (Developer lane)
│   ├── architecture.md     ← system-wide architecture
│   ├── adr/                ← architecture decision records
│   └── knowledge-base/     ← Discovery inputs (static analysis, deps, crashes, perf)
├── epics/                  ← one folder per epic (see epics/EPIC-template/)
├── repos/registry.yaml     ← map of all code repos in the project
└── process/                ← THE STANDARD (engine-agnostic)
    ├── workflow.yaml        ← phases, status→agent, gates
    ├── agents/              ← BMAD role personas (fill from BMAD upstream)
    └── templates/           ← doc templates (epic, story, prd, …)
```

## First steps

1. Copy this folder into a new repo named e.g. `project-hub`.
2. Read [`CONVENTIONS.md`](./CONVENTIONS.md) — it defines the frontmatter every doc needs.
3. Fill [`repos/registry.yaml`](./repos/registry.yaml) with your real repos.
4. Seed [`process/agents/`](./process/agents/) from BMAD (see [../SETUP.md](../SETUP.md) Step 2).
5. Create your first epic by copying [`epics/EPIC-template/`](./epics/EPIC-template/).

> Want to see it filled in? Look at [`../example-project-hub/`](../example-project-hub/).
