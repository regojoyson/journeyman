# Agent Field Help & Section Callouts — Design Spec

**Date:** 2026-06-20  
**Scope:** `packages/web/src/components/agents/`

---

## Goal

Help users understand how to configure an agent without leaving the page. Two layers of contextual help:

1. **Section callouts** — an alert-style box at the top of each section explaining what the section does and how to use it.
2. **Field tooltips** — a small `i` icon inline with non-obvious field labels; hover reveals a one-line explanation.

---

## Component Changes

### `SectionShell.tsx` — two additions only

**1. `InfoIcon` component** (used by `FieldLabel`)

A 15×15 circle with an italic `i`, renders via Tailwind `group`/`group-hover`. On hover: turns primary color. Tooltip appears above with a caret arrow. Pure CSS — no JS state.

```tsx
function InfoIcon({ text }: { text: string }) {
  return (
    <span className="relative group/tip cursor-help inline-flex items-center">
      <span className="inline-flex items-center justify-center w-[15px] h-[15px] rounded-full bg-muted text-muted-foreground text-[9px] font-bold italic font-serif group-hover/tip:bg-primary group-hover/tip:text-primary-foreground transition-colors">
        i
      </span>
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 text-xs rounded-md bg-card border border-border shadow-md whitespace-nowrap opacity-0 group-hover/tip:opacity-100 pointer-events-none transition-opacity z-50">
        {text}
        {/* caret */}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-border" />
        <span className="absolute top-[calc(100%-1px)] left-1/2 -translate-x-1/2 border-4 border-transparent border-t-card" />
      </span>
    </span>
  );
}
```

**2. `FieldLabel` — add optional `help` prop**

```tsx
export function FieldLabel({ children, help }: { children: ReactNode; help?: string }) {
  return (
    <label className="flex items-center gap-1.5 text-sm font-medium mb-1.5">
      {children}
      {help && <InfoIcon text={help} />}
    </label>
  );
}
```

**3. `SectionShell` — render `description` as alert box**

Replace the plain `<p>` with an alert-style box: tinted primary background, no border, lucide `Info` icon left, bold label, muted description text.

```tsx
import { Info } from "lucide-react";

export function SectionShell({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      {description && (
        <div className="mt-2 mb-4 flex gap-2.5 items-start rounded-lg bg-primary/10 px-3 py-2.5">
          <Info className="w-4 h-4 text-primary/70 shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        </div>
      )}
      <div className="space-y-4">{children}</div>
    </div>
  );
}
```

---

## Section Callout Content

Each section passes an updated `description` to `SectionShell`.

| Section | `description` value |
|---|---|
| **Instructions & Inputs** | `"Describe what this agent should do on each run. Be specific — the more context you give, the better the results."` |
| **Workspace & Model** | `"Choose the AI provider, model, and repositories the agent can access. Workspace tools (bash, file read/write) require at least one repo to be connected."` |
| **Triggers** | `"Define what starts a run. Triggers can be combined — schedule + API at the same time. Webhook triggers fire when an external system sends a matching event."` |
| **Behavior** | `"Max steps stops runaway loops, Timeout caps wall-clock time. Output mode controls what gets stored after each run. Safety limits here override org defaults for this agent only."` |
| **Permissions** | `"Restrict which tools the agent can call. A read-only agent can't accidentally push code. Workspace tools (bash, file read/write) require a repository to be configured in Workspace."` |
| **Notifications** | `"Send a message when a run finishes. Add a notification channel under Connections first, then pick when to fire — on success, failure, or both."` |

Run history and Delete sections get no callout — they're self-explanatory.

---

## Field Tooltip Content

`help="..."` added to the relevant `FieldLabel` in each section file.

### `WorkspaceSection.tsx`

| Field | `help` value |
|---|---|
| Provider | `"AI coding engine that runs this agent"` |
| Git connection | `"OAuth connection to your Git host, used to clone repos"` |

### `BehaviorSection.tsx`

| Field | `help` value |
|---|---|
| Max steps | `"Maximum reasoning steps the agent takes per run"` |
| Timeout (seconds) | `"Run is killed after this many seconds; leave blank for no limit"` |
| Output mode | `"How the agent's result is stored after a run"` |
| Max concurrent runs | `"Max simultaneous runs of this agent at once"` |
| Daily run cap | `"Hard limit on runs per calendar day"` |
| Budget: max tokens / day | `"Total input + output tokens allowed per day"` |
| Budget: max $ / day | `"Spend cap in USD per calendar day"` |

### `PermissionsSection.tsx`

| Field | `help` value |
|---|---|
| Allowed tools | `"File system, bash, and web tools the agent may call"` |

### `NotificationsSection.tsx`

| Field | `help` value |
|---|---|
| Notification connection | `"Slack or other channel used to send run notifications"` |
| Channel / target | `"Slack channel or user ID to receive messages"` |

---

## What Does NOT Change

- `AgentDetail.tsx` — no changes
- `SectionNav.tsx` — no changes
- Any section's logic or state — no changes
- `InstructionsSection.tsx` — no field tooltips (already has inline `{{variable}}` hint text)

---

## Files to Edit

1. `packages/web/src/components/agents/sections/SectionShell.tsx` — `InfoIcon`, updated `FieldLabel`, updated `SectionShell`
2. `packages/web/src/components/agents/sections/InstructionsSection.tsx` — update `description` string only
3. `packages/web/src/components/agents/sections/WorkspaceSection.tsx` — update `description` + add `help` to 2 fields
4. `packages/web/src/components/agents/sections/TriggersSection.tsx` — update `description` string only
5. `packages/web/src/components/agents/sections/BehaviorSection.tsx` — update `description` + add `help` to 7 fields
6. `packages/web/src/components/agents/sections/PermissionsSection.tsx` — update `description` + add `help` to 1 field
7. `packages/web/src/components/agents/sections/NotificationsSection.tsx` — update `description` + add `help` to 2 fields
