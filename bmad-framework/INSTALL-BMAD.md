# Installing & using BMAD — in easy words

**What BMAD is:** a ready-made "AI team in a box" — an Analyst, PM, Architect, Dev, QA
and more — plus the document templates they use. You install it into a project and talk
to each role.

---

## Before you start

- Install **Node.js**, version **20 or newer**. Check it: `node -v`.
- Open your project folder.

## Install — one command

In your project folder:

```bash
npx bmad-method install
```

It's an **interactive installer**: it asks a couple of questions (which editor you use,
what to include) and sets everything up. Nothing is installed globally. Run the same
command again later to update.

## What it puts in your project

- **`.bmad-core/`** — the brains: agent **personas**, **tasks**, **templates**, **checklists**.
- **Editor hooks** so you can call agents by name (Cursor / Claude Code / VS Code, …).

## How you use it — two stages

1. **Planning (big thinking):** Analyst → **PM** (writes the PRD) → **Architect** (writes
   the architecture) → **PO** (splits it into stories).
2. **Building (the loop):** **Scrum Master** drafts the next story → **Dev** builds it →
   **QA** checks it. Repeat per story.

## Talking to an agent

- Select the agent (by name or a slash command in your editor).
- Type **`*help`** to see its commands.
- Commands start with `*` — e.g. `*create-doc`, `*shard-doc`, `*draft`, `*review`.

---

## The important part — how this fits *our* workflow

We do **not** run BMAD live in every developer's editor. Instead:

1. **Install BMAD once** (command above) to get its files.
2. **Copy the useful personas + templates** from `.bmad-core/` into the Project Hub's
   [`process/`](./project-hub-skeleton/process/) folder — see [SETUP.md](./SETUP.md) Step 2.
3. Your **engine** (Journeyman) runs those agents **automatically** at each phase — nobody
   types `*commands` by hand.

> **One line:** install BMAD → harvest its content → drop it into `process/` → the engine drives it.

### Which pieces to copy (and which to skip)

| Copy into `process/agents/` & `process/templates/` | Skip |
|---|---|
| Analyst, PM, PO, UX Expert, Architect, SM, Dev, QA personas | `bmad-orchestrator`, `bmad-master` |
| Templates: project-brief, PRD, front-end-spec, architecture, story | KB-mode, advanced-elicitation |
| Checklists: po-master, architect, story-DoD | Expansion packs (non-software) |
| Tasks: document-project, shard-doc, create-next-story, QA `*` commands | BMAD's web-UI planning runtime |

(See the full mapping in the [design spec](../docs/superpowers/specs/2026-06-21-pdlc-aidlc-workflow-design.md#bmad-adoption).)
