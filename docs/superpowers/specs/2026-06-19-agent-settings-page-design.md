# Agent settings page — replace the agent modal

**Date:** 2026-06-19
**Status:** Approved (design)
**Area:** `packages/web`

## Problem

Agent creation and editing both happen inside `EditAgentModal` — a centered
`max-w-2xl` dialog with seven cramped tabs. Creation today is: click
**+ Create agent** → inline name box → create a draft → the same small modal
opens for all configuration. The modal feels unpolished and is tight for the
amount of configuration it holds.

## Goal

Replace the modal with a dedicated, polished **two-pane settings page** that
handles both creating and editing an agent. Same fields and data; better
structure and visual quality throughout every section.

## Decisions (from brainstorming)

- **Scope:** one page serves both create and edit; `EditAgentModal` is retired.
- **Layout:** two-pane settings page — sticky left section-nav + right content
  pane (chosen over full-width top tabs and single-scroll-with-outline).
- **Create flow:** unchanged entry — **+ Create agent** prompts for a name,
  creates the draft via `agentsApi.create`, then routes to the page where
  everything is editable.
- **Save:** a single **Save changes** button in the header persists the whole
  form via `agentsApi.update` (one `AgentUpdateInput`). Dirty-state aware.
- **Lock:** an **Enabled** toggle calls `enable`/`disable`; while enabled the
  form is read-only with a lock banner (preserves today's behavior). Run now and
  token actions still work while enabled.
- **Depth:** build the page **and** polish all seven sections (consistent
  headings, grouped cards, spacing, inputs, badges) — not a lift-and-shift, and
  not a per-control redesign.

## Routing & navigation

- New route in `App.tsx`:
  `/workspaces/:wsId/agents/:agentId` → `AgentDetailPage`.
- `AgentsList`:
  - **+ Create agent** keeps the name prompt → `agentsApi.create(wsId, {name})`
    → `navigate(`/workspaces/${wsId}/agents/${created.id}`)`.
  - **Open** on a row navigates to the same route (no more `setEditing`).
  - Remove the `editing` state and the `<EditAgentModal>` render.
- `EditAgentModal.tsx` is deleted. `AgentRuns` (currently defined inside it) is
  kept by moving it into the new page or a small `AgentRuns.tsx` component.
- Active section is encoded in the URL (`?section=triggers`) so sections are
  linkable and survive refresh; default `instructions`.
- Breadcrumb "Agents › {name}" links back to `/workspaces/:wsId/agents`.

## Page structure — `AgentDetailPage` / `AgentDetail`

`routes/AgentDetailPage.tsx` resolves `wsId`/`agentId` from params and `orgId`
from `useWorkspace()` (same derivation as `AgentsPage`), loads the agent via
`agentsApi.get`, and renders an `AgentDetail` component that owns the form state.

**Header**
- Breadcrumb, agent **name** + **status badge** (`DRAFT` / `ENABLED` / status),
  a one-line summary (provider · repo count · last saved).
- Right side: **Enabled** toggle, **Run now**, **Save changes**.

**Body (two-pane)**
- Left: sticky section-nav listing the seven sections, with **Run history**
  visually separated at the bottom (read-only history, not config).
- Right: content pane renders the active section.

Sections (unchanged set): Instructions & Inputs · Workspace & Model · Triggers ·
Behavior · Permissions · Notifications · Run history.

## Save & lock behavior

- Form edits accumulate in local state (as the modal does via `patch`). **Save
  changes** sends one `AgentUpdateInput` with all editable fields through
  `agentsApi.update` and replaces local state with the response.
- Button reflects a **dirty** state and disables when there are no unsaved
  changes. Navigating away while dirty triggers a confirm prompt.
- **Enabled** toggle → `agentsApi.enable` / `disable`. When `enabled`, the whole
  form is read-only and a banner reads "🔒 Enabled — disable to edit." Run now
  and API-token issue/revoke remain available while enabled.
- Triggers note: schedule/webhook save folds into the single Save (build the
  `triggers` array from the section's local state, as the modal's
  `saveSchedule`/`saveWebhook` already compute it).

## Section polish (all seven)

Same fields and data, restyled consistently:

- Each section: a heading + one-line description, then inputs in framed,
  labelled groups with consistent spacing.
- **Instructions & Inputs:** instructions textarea + a tidy hint box; available
  inputs render as chips.
- **Workspace & Model:** provider/model selects (`CodingModelSelect`), git
  connection + **Browse repos** picker, repositories list. Reuse existing logic.
- **Triggers:** Schedule / API / Webhook as three grouped cards.
- **Behavior:** max steps, timeout, output mode; safety-limits as a 2-col grid.
- **Permissions:** `ToolsPicker` (reused).
- **Notifications:** connection select, target, on-success/on-failure toggles.
- **Run history:** the runs table (`AgentRuns`), polished; read-only.

Reused sub-components unchanged: `ToolsPicker`, `CodingModelSelect`, the repo
browser, shared button/input styles in `routes/admin-styles.ts`.

## Out of scope

- No redesign of individual controls (no visual trigger builder, no new repo
  picker, no richer inputs editor).
- No API or data-model changes; existing `agentsApi` endpoints are sufficient.
- No changes to the agents list table beyond its create/open navigation.

## Testing & verification

- `npm run check` (typecheck + import boundaries).
- Manual verification via the preview workflow:
  1. Create: **+ Create agent** → name → lands on the page.
  2. Edit a section → **Save changes** → reload shows persistence.
  3. **Enabled** toggle → form locks with banner → disable → editable again.
  4. **Run now** → **Run history** lists the run.
  5. Section deep-link (`?section=triggers`) survives refresh.
- Capture a screenshot of the finished page.
