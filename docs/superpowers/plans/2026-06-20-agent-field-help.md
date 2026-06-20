# Agent Field Help & Section Callouts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an alert-style callout to every agent section and hover tooltips to non-obvious field labels — all without touching any logic, state, or API code.

**Architecture:** Every change lives in `packages/web/src/components/agents/sections/`. `SectionShell.tsx` gains three things: an `InfoIcon` sub-component, an updated `FieldLabel` with an optional `help` prop, and a description rendered as a tinted alert box instead of a plain paragraph. The four safety-limit labels in `BehaviorSection` use inline `<label>` wrappers rather than `FieldLabel`, so `InfoIcon` is exported separately and slotted in directly. Each section file only changes its `description` string and/or adds `help="…"` to the relevant `FieldLabel` calls.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, lucide-react (already installed at `^1.17.0`), Vitest + `renderToStaticMarkup` for tests.

---

### Task 1: Write failing tests for `SectionShell.tsx`

**Files:**
- Create: `packages/web/src/components/agents/sections/SectionShell.test.tsx`

- [ ] **Step 1: Create the test file**

```tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SectionShell, FieldLabel } from "./SectionShell.tsx";

describe("FieldLabel", () => {
  it("renders children without an info icon when help is not provided", () => {
    const html = renderToStaticMarkup(<FieldLabel>Max steps</FieldLabel>);
    expect(html).toContain("Max steps");
    expect(html).not.toContain("cursor-help");
  });

  it("renders the tooltip text in the DOM when help is provided", () => {
    const html = renderToStaticMarkup(
      <FieldLabel help="Maximum reasoning steps the agent takes per run">Max steps</FieldLabel>
    );
    expect(html).toContain("Max steps");
    expect(html).toContain("Maximum reasoning steps the agent takes per run");
    expect(html).toContain("cursor-help");
  });
});

describe("SectionShell", () => {
  it("renders title and children with no alert box when description is absent", () => {
    const html = renderToStaticMarkup(
      <SectionShell title="Behavior"><span>content</span></SectionShell>
    );
    expect(html).toContain("Behavior");
    expect(html).toContain("content");
    expect(html).not.toContain("bg-primary/10");
  });

  it("renders description inside an alert box when description is provided", () => {
    const html = renderToStaticMarkup(
      <SectionShell title="Behavior" description="Max steps stops runaway loops.">
        <span>content</span>
      </SectionShell>
    );
    expect(html).toContain("Behavior");
    expect(html).toContain("Max steps stops runaway loops.");
    expect(html).toContain("bg-primary/10");
  });
});
```

- [ ] **Step 2: Run the tests — confirm all 4 fail**

```bash
cd packages/web && npx vitest run src/components/agents/sections/SectionShell.test.tsx
```

Expected: 4 failures. `FieldLabel` does not yet accept `help`; `SectionShell` does not yet render `bg-primary/10`.

---

### Task 2: Implement `SectionShell.tsx`

**Files:**
- Modify: `packages/web/src/components/agents/sections/SectionShell.tsx`

- [ ] **Step 1: Replace the entire file**

```tsx
import type { ReactNode } from "react";
import { Info } from "lucide-react";

export function InfoIcon({ text }: { text: string }) {
  return (
    <span className="relative group/tip cursor-help inline-flex items-center">
      <span className="inline-flex items-center justify-center w-[15px] h-[15px] rounded-full bg-muted text-muted-foreground text-[9px] font-bold italic font-serif group-hover/tip:bg-primary group-hover/tip:text-primary-foreground transition-colors">
        i
      </span>
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 text-xs rounded-md bg-card border border-border shadow-md whitespace-nowrap opacity-0 group-hover/tip:opacity-100 pointer-events-none transition-opacity z-50">
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-border" />
        <span className="absolute top-[calc(100%-1px)] left-1/2 -translate-x-1/2 border-4 border-transparent border-t-card" />
      </span>
    </span>
  );
}

export function SectionShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
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

export function FieldLabel({ children, help }: { children: ReactNode; help?: string }) {
  return (
    <label className="flex items-center gap-1.5 text-sm font-medium mb-1.5">
      {children}
      {help && <InfoIcon text={help} />}
    </label>
  );
}
```

- [ ] **Step 2: Run the SectionShell tests — confirm all 4 pass**

```bash
cd packages/web && npx vitest run src/components/agents/sections/SectionShell.test.tsx
```

Expected: 4 tests pass.

---

### Task 3: Update `InstructionsSection.tsx` — description only

**Files:**
- Modify: `packages/web/src/components/agents/sections/InstructionsSection.tsx:23`

- [ ] **Step 1: Update the `SectionShell` description**

Line 23 — change:
```tsx
    <SectionShell title="Instructions & Inputs" description="What this agent should do each run.">
```
To:
```tsx
    <SectionShell title="Instructions & Inputs" description="Describe what this agent should do on each run. Be specific — the more context you give, the better the results.">
```

- [ ] **Step 2: Run the existing InstructionsSection test — confirm it still passes**

```bash
cd packages/web && npx vitest run src/components/agents/sections/InstructionsSection.test.tsx
```

Expected: 1 test passes (it checks detected inputs, not the description string).

---

### Task 4: Update `TriggersSection.tsx` — description only

**Files:**
- Modify: `packages/web/src/components/agents/sections/TriggersSection.tsx:80-83`

- [ ] **Step 1: Update the `SectionShell` description**

Lines 80–83 — change:
```tsx
    <SectionShell
      title="Triggers"
      description="How runs are started — on a schedule, via the API, or from an inbound webhook."
    >
```
To:
```tsx
    <SectionShell
      title="Triggers"
      description="Define what starts a run. Triggers can be combined — schedule + API at the same time. Webhook triggers fire when an external system sends a matching event."
    >
```

- [ ] **Step 2: Run the existing TriggersSection test**

```bash
cd packages/web && npx vitest run src/components/agents/sections/TriggersSection.test.tsx
```

Expected: all pass.

---

### Task 5: Update `WorkspaceSection.tsx` — description + 2 field tooltips

**Files:**
- Modify: `packages/web/src/components/agents/sections/WorkspaceSection.tsx`

- [ ] **Step 1: Update the `SectionShell` description (line 77)**

Change:
```tsx
    <SectionShell title="Workspace & Model" description="Where the agent runs and which model it uses.">
```
To:
```tsx
    <SectionShell title="Workspace & Model" description="Choose the AI provider, model, and repositories the agent can access. Workspace tools (bash, file read/write) require at least one repo to be connected.">
```

- [ ] **Step 2: Add `help` prop to Provider `FieldLabel` (line 79)**

Change:
```tsx
        <FieldLabel>Provider</FieldLabel>
```
To:
```tsx
        <FieldLabel help="AI coding engine that runs this agent">Provider</FieldLabel>
```

- [ ] **Step 3: Add `help` prop to Git connection `FieldLabel` (line 98)**

Change:
```tsx
        <FieldLabel>Git connection</FieldLabel>
```
To:
```tsx
        <FieldLabel help="OAuth connection to your Git host, used to clone repos">Git connection</FieldLabel>
```

---

### Task 6: Update `BehaviorSection.tsx` — description + 7 field tooltips

The first three fields (`Max steps`, `Timeout`, `Output mode`) use `FieldLabel` — add `help` directly. The four safety-limit fields use a plain `<label>` wrapping `<input>` — import `InfoIcon` separately and slot it inline, preserving the native label/input association.

**Files:**
- Modify: `packages/web/src/components/agents/sections/BehaviorSection.tsx`

- [ ] **Step 1: Update the import line (line 2) to also import `InfoIcon`**

Change:
```tsx
import { inputCls } from "../../../routes/admin-styles.ts";
import { SectionShell, FieldLabel } from "./SectionShell.tsx";
```
To:
```tsx
import { inputCls } from "../../../routes/admin-styles.ts";
import { SectionShell, FieldLabel, InfoIcon } from "./SectionShell.tsx";
```

- [ ] **Step 2: Update the `SectionShell` description (line 15)**

Change:
```tsx
    <SectionShell title="Behavior" description="Execution limits, output mode, and safety overrides.">
```
To:
```tsx
    <SectionShell title="Behavior" description="Max steps stops runaway loops, Timeout caps wall-clock time. Output mode controls what gets stored after each run. Safety limits here override org defaults for this agent only.">
```

- [ ] **Step 3: Add `help` to Max steps `FieldLabel` (line 17)**

Change:
```tsx
        <FieldLabel>Max steps</FieldLabel>
```
To:
```tsx
        <FieldLabel help="Maximum reasoning steps the agent takes per run">Max steps</FieldLabel>
```

- [ ] **Step 4: Add `help` to Timeout `FieldLabel` (line 26)**

Change:
```tsx
        <FieldLabel>Timeout (seconds)</FieldLabel>
```
To:
```tsx
        <FieldLabel help="Run is killed after this many seconds; leave blank for no limit">Timeout (seconds)</FieldLabel>
```

- [ ] **Step 5: Add `help` to Output mode `FieldLabel` (line 35)**

Change:
```tsx
        <FieldLabel>Output mode</FieldLabel>
```
To:
```tsx
        <FieldLabel help="How the agent's result is stored after a run">Output mode</FieldLabel>
```

- [ ] **Step 6: Add `InfoIcon` to Max concurrent runs label (line ~56)**

Change:
```tsx
          <label className="text-xs text-muted-foreground">
            Max concurrent runs
            <input
```
To:
```tsx
          <label className="text-xs text-muted-foreground">
            <span className="flex items-center gap-1 mb-1">Max concurrent runs <InfoIcon text="Max simultaneous runs of this agent at once" /></span>
            <input
```

- [ ] **Step 7: Add `InfoIcon` to Daily run cap label (line ~64)**

Change:
```tsx
          <label className="text-xs text-muted-foreground">
            Daily run cap
            <input
```
To:
```tsx
          <label className="text-xs text-muted-foreground">
            <span className="flex items-center gap-1 mb-1">Daily run cap <InfoIcon text="Hard limit on runs per calendar day" /></span>
            <input
```

- [ ] **Step 8: Add `InfoIcon` to Budget: max tokens / day label (line ~72)**

Change:
```tsx
          <label className="text-xs text-muted-foreground">
            Budget: max tokens / day
            <input
```
To:
```tsx
          <label className="text-xs text-muted-foreground">
            <span className="flex items-center gap-1 mb-1">Budget: max tokens / day <InfoIcon text="Total input + output tokens allowed per day" /></span>
            <input
```

- [ ] **Step 9: Add `InfoIcon` to Budget: max $ / day label (line ~84)**

Change:
```tsx
          <label className="text-xs text-muted-foreground">
            Budget: max $ / day
            <input
```
To:
```tsx
          <label className="text-xs text-muted-foreground">
            <span className="flex items-center gap-1 mb-1">Budget: max $ / day <InfoIcon text="Spend cap in USD per calendar day" /></span>
            <input
```

---

### Task 7: Update `PermissionsSection.tsx` — description + 1 field tooltip

**Files:**
- Modify: `packages/web/src/components/agents/sections/PermissionsSection.tsx`

- [ ] **Step 1: Update the `SectionShell` description (line 13)**

Change:
```tsx
    <SectionShell title="Permissions" description="Which tools the agent is allowed to use.">
```
To:
```tsx
    <SectionShell title="Permissions" description="Restrict which tools the agent can call. A read-only agent can't accidentally push code. Workspace tools (bash, file read/write) require a repository to be configured in Workspace.">
```

- [ ] **Step 2: Add `help` to Allowed tools `FieldLabel` (line 15)**

Change:
```tsx
        <FieldLabel>Allowed tools</FieldLabel>
```
To:
```tsx
        <FieldLabel help="File system, bash, and web tools the agent may call">Allowed tools</FieldLabel>
```

---

### Task 8: Update `NotificationsSection.tsx` — description + 2 field tooltips

**Files:**
- Modify: `packages/web/src/components/agents/sections/NotificationsSection.tsx`

- [ ] **Step 1: Update the `SectionShell` description (line 31)**

Change:
```tsx
    <SectionShell title="Notifications" description="Deliver a message when a run finishes.">
```
To:
```tsx
    <SectionShell title="Notifications" description="Send a message when a run finishes. Add a notification channel under Connections first, then pick when to fire — on success, failure, or both.">
```

- [ ] **Step 2: Add `help` to Notification connection `FieldLabel` (line 33)**

Change:
```tsx
        <FieldLabel>Notification connection</FieldLabel>
```
To:
```tsx
        <FieldLabel help="Slack or other channel used to send run notifications">Notification connection</FieldLabel>
```

- [ ] **Step 3: Add `help` to Channel / target `FieldLabel` (line 52)**

Change:
```tsx
        <FieldLabel>Channel / target</FieldLabel>
```
To:
```tsx
        <FieldLabel help="Slack channel or user ID to receive messages">Channel / target</FieldLabel>
```

---

### Task 9: Run all tests then typecheck

- [ ] **Step 1: Run the full web test suite**

```bash
cd packages/web && npx vitest run
```

Expected: all tests pass, including the 4 new `SectionShell` tests and the unchanged `InstructionsSection` / `TriggersSection` / `SectionNav` tests.

- [ ] **Step 2: Run typecheck from the repo root**

```bash
npm run typecheck
```

Expected: no errors. The only new type surface is `help?: string` on `FieldLabel` and the exported `InfoIcon({ text: string })` — both are straightforward.
