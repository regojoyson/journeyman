# Agent Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cramped `EditAgentModal` with a dedicated two-pane agent settings page that handles both creating and editing an agent, with every section polished.

**Architecture:** A new route `/workspaces/:wsId/agents/:agentId` renders `AgentDetailPage`, which loads the agent and hands it to an `AgentDetail` component. `AgentDetail` owns the working copy of the agent, a left section-nav, and a header with a single **Save changes** button + **Enabled** toggle. Each of the seven sections is a focused presentational component fed `a` (working copy), `patch`, and `locked`. Pure form logic (build update payload, dirty check) lives in a tested helper module.

**Tech Stack:** React 18, react-router-dom, TypeScript, Tailwind (shadcn-style tokens), Vitest + `renderToStaticMarkup`.

---

## File Structure

**Create:**
- `packages/web/src/components/agents/agent-form.ts` — pure helpers: `buildUpdateInput`, `isAgentDirty`, `agentSummary`, `statusLabel`.
- `packages/web/src/components/agents/agent-form.test.ts` — unit tests for the helpers.
- `packages/web/src/components/agents/sections/SectionShell.tsx` — `SectionShell`, `FieldLabel` presentational primitives.
- `packages/web/src/components/agents/sections/SectionNav.tsx` — left section navigation.
- `packages/web/src/components/agents/sections/SectionNav.test.tsx` — render test.
- `packages/web/src/components/agents/sections/RunHistorySection.tsx` — runs table (moved from the modal).
- `packages/web/src/components/agents/sections/InstructionsSection.tsx`
- `packages/web/src/components/agents/sections/WorkspaceSection.tsx`
- `packages/web/src/components/agents/sections/TriggersSection.tsx`
- `packages/web/src/components/agents/sections/BehaviorSection.tsx`
- `packages/web/src/components/agents/sections/PermissionsSection.tsx`
- `packages/web/src/components/agents/sections/NotificationsSection.tsx`
- `packages/web/src/components/agents/AgentDetail.tsx` — page shell (header, nav, active section, save/lock state).
- `packages/web/src/components/agents/AgentDetail.test.tsx` — render test.
- `packages/web/src/routes/AgentDetailPage.tsx` — route component (params → load → render).

**Modify:**
- `packages/web/src/components/agents/AgentsList.tsx` — create/open now navigate to the page; remove modal wiring.
- `packages/web/src/App.tsx` — register the new route.

**Delete:**
- `packages/web/src/components/agents/EditAgentModal.tsx` — replaced.

**Section component contract** (every section file uses this prop shape):

```typescript
import type { Agent, AgentUpdateInput } from "@journeyman/core";

export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
  wsId: string;
}
```

---

### Task 1: Pure form helpers

**Files:**
- Create: `packages/web/src/components/agents/agent-form.ts`
- Test: `packages/web/src/components/agents/agent-form.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/web/src/components/agents/agent-form.test.ts
import { describe, it, expect } from "vitest";
import type { Agent } from "@journeyman/core";
import { buildUpdateInput, isAgentDirty, agentSummary, statusLabel } from "./agent-form.ts";

const base: Agent = {
  id: "a1",
  workspaceId: "w1",
  orgId: "o1",
  name: "triager",
  instructions: "do the thing",
  inputs: [],
  provider: "claude",
  model: "claude-opus-4-8",
  connectorMcpIds: [],
  tools: [],
  skillIds: [],
  repoSelections: [{ repo: "acme/api", allowWrites: false }],
  permissions: { allowedTools: [] },
  notifications: { on: [] },
  outputMode: "text",
  behavior: {},
  triggers: [{ type: "schedule", cron: "0 2 * * *", timezone: "UTC" }],
  status: "draft",
  enabled: false,
  createdBy: "u1",
  createdAt: "2026-06-19T00:00:00Z",
  updatedAt: "2026-06-19T00:00:00Z",
};

describe("buildUpdateInput", () => {
  it("includes only the editable fields", () => {
    const out = buildUpdateInput(base);
    expect(out).toEqual({
      instructions: "do the thing",
      inputs: [],
      provider: "claude",
      model: "claude-opus-4-8",
      repoSelections: [{ repo: "acme/api", allowWrites: false }],
      triggers: [{ type: "schedule", cron: "0 2 * * *", timezone: "UTC" }],
      behavior: {},
      outputMode: "text",
      limits: undefined,
      permissions: { allowedTools: [] },
      tools: [],
      notifications: { on: [] },
    });
    expect(out).not.toHaveProperty("id");
    expect(out).not.toHaveProperty("status");
  });
});

describe("isAgentDirty", () => {
  it("is false for an unchanged copy", () => {
    expect(isAgentDirty(base, base)).toBe(false);
  });
  it("is true when an editable field changes", () => {
    expect(isAgentDirty(base, { ...base, instructions: "changed" })).toBe(true);
  });
  it("ignores non-editable fields like updatedAt", () => {
    expect(isAgentDirty(base, { ...base, updatedAt: "2099-01-01T00:00:00Z" })).toBe(false);
  });
});

describe("agentSummary", () => {
  it("summarises provider and repo count", () => {
    expect(agentSummary(base)).toBe("claude · 1 repository");
    expect(agentSummary({ ...base, repoSelections: [] })).toBe("claude · 0 repositories");
  });
});

describe("statusLabel", () => {
  it("shows ENABLED when enabled regardless of status", () => {
    expect(statusLabel({ ...base, enabled: true })).toBe("ENABLED");
  });
  it("shows the uppercased status when disabled", () => {
    expect(statusLabel(base)).toBe("DRAFT");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run src/components/agents/agent-form.test.ts`
Expected: FAIL — `agent-form.ts` does not exist / exports undefined.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/web/src/components/agents/agent-form.ts
import type { Agent, AgentUpdateInput } from "@journeyman/core";

/** The editable subset of an Agent — exactly what the page can change & save. */
export function buildUpdateInput(a: Agent): AgentUpdateInput {
  return {
    instructions: a.instructions,
    inputs: a.inputs,
    provider: a.provider,
    model: a.model,
    repoSelections: a.repoSelections,
    triggers: a.triggers,
    behavior: a.behavior,
    outputMode: a.outputMode,
    limits: a.limits,
    permissions: a.permissions,
    tools: a.tools,
    notifications: a.notifications,
  };
}

/** True when the working copy differs from the original in any editable field. */
export function isAgentDirty(original: Agent, current: Agent): boolean {
  return JSON.stringify(buildUpdateInput(original)) !== JSON.stringify(buildUpdateInput(current));
}

/** One-line header summary, e.g. "claude · 2 repositories". */
export function agentSummary(a: Agent): string {
  const n = a.repoSelections.length;
  return `${a.provider} · ${n} ${n === 1 ? "repository" : "repositories"}`;
}

/** Badge text: ENABLED when locked, else the uppercased status. */
export function statusLabel(a: Agent): string {
  return a.enabled ? "ENABLED" : a.status.toUpperCase();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npx vitest run src/components/agents/agent-form.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/agents/agent-form.ts packages/web/src/components/agents/agent-form.test.ts
git commit -m "feat(web): agent form helpers (build update input, dirty check)"
```

---

### Task 2: Section primitives (SectionShell, FieldLabel)

**Files:**
- Create: `packages/web/src/components/agents/sections/SectionShell.tsx`

- [ ] **Step 1: Write the component**

```tsx
// packages/web/src/components/agents/sections/SectionShell.tsx
import type { ReactNode } from "react";

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
      {description && <p className="mt-1 mb-4 text-sm text-muted-foreground">{description}</p>}
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="block text-sm font-medium mb-1.5">{children}</label>;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd packages/web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep SectionShell || echo "no SectionShell type errors"`
Expected: `no SectionShell type errors`

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/agents/sections/SectionShell.tsx
git commit -m "feat(web): SectionShell + FieldLabel primitives for agent sections"
```

---

### Task 3: SectionNav

**Files:**
- Create: `packages/web/src/components/agents/sections/SectionNav.tsx`
- Test: `packages/web/src/components/agents/sections/SectionNav.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web/src/components/agents/sections/SectionNav.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SectionNav, SECTIONS } from "./SectionNav.tsx";

describe("SectionNav", () => {
  it("renders every section label", () => {
    const html = renderToStaticMarkup(<SectionNav active="instructions" onSelect={() => {}} />);
    for (const s of SECTIONS) expect(html).toContain(s.label);
  });
  it("exposes the seven sections in order ending with run history", () => {
    expect(SECTIONS.map((s) => s.id)).toEqual([
      "instructions", "workspace", "triggers", "behavior", "permissions", "notifications", "runs",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run src/components/agents/sections/SectionNav.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
// packages/web/src/components/agents/sections/SectionNav.tsx
export type SectionId =
  | "instructions" | "workspace" | "triggers" | "behavior" | "permissions" | "notifications" | "runs";

export const SECTIONS: Array<{ id: SectionId; label: string; icon: string }> = [
  { id: "instructions", label: "Instructions & Inputs", icon: "📝" },
  { id: "workspace", label: "Workspace & Model", icon: "⚙️" },
  { id: "triggers", label: "Triggers", icon: "⏱" },
  { id: "behavior", label: "Behavior", icon: "🎛" },
  { id: "permissions", label: "Permissions", icon: "🔐" },
  { id: "notifications", label: "Notifications", icon: "🔔" },
  { id: "runs", label: "Run history", icon: "📊" },
];

export function SectionNav({ active, onSelect }: { active: SectionId; onSelect: (id: SectionId) => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {SECTIONS.map((s) => {
        const isRuns = s.id === "runs";
        const isActive = active === s.id;
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={[
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-left transition",
              isRuns ? "mt-2 pt-3 border-t" : "",
              isActive
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            ].join(" ")}
          >
            <span className="w-4 text-center opacity-80">{s.icon}</span>
            {s.label}
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npx vitest run src/components/agents/sections/SectionNav.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/agents/sections/SectionNav.tsx packages/web/src/components/agents/sections/SectionNav.test.tsx
git commit -m "feat(web): agent SectionNav with run-history separated"
```

---

### Task 4: RunHistorySection (move AgentRuns out of the modal)

**Files:**
- Create: `packages/web/src/components/agents/sections/RunHistorySection.tsx`

- [ ] **Step 1: Write the component** (ported verbatim from `EditAgentModal`'s `AgentRuns`, wrapped in `SectionShell`)

```tsx
// packages/web/src/components/agents/sections/RunHistorySection.tsx
import { useEffect, useState } from "react";
import { agentsApi, type AgentRunSummary } from "../../../api/agents.ts";
import { SectionShell } from "./SectionShell.tsx";

export function RunHistorySection({ wsId, agentId }: { wsId: string; agentId: string }) {
  const [runs, setRuns] = useState<AgentRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    agentsApi
      .runs(wsId, agentId)
      .then(setRuns)
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, [wsId, agentId]);

  return (
    <SectionShell title="Run history" description="Past executions of this agent.">
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : runs.length === 0 ? (
        <div className="text-sm text-muted-foreground">No runs yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1">Run</th>
              <th className="py-1">Status</th>
              <th className="py-1">Started</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="py-1">
                  <a className="text-primary underline" href={`/workspaces/${wsId}/workflow-instances/${r.id}`}>
                    {r.id.slice(0, 8)}
                  </a>
                </td>
                <td className="py-1">{r.status}</td>
                <td className="py-1 text-muted-foreground">{r.started_at ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionShell>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/agents/sections/RunHistorySection.tsx
git commit -m "feat(web): RunHistorySection (moved from agent modal)"
```

---

### Task 5: InstructionsSection

**Files:**
- Create: `packages/web/src/components/agents/sections/InstructionsSection.tsx`

- [ ] **Step 1: Write the component**

```tsx
// packages/web/src/components/agents/sections/InstructionsSection.tsx
import type { Agent, AgentUpdateInput } from "@journeyman/core";
import { inputCls, codePill } from "../../../routes/admin-styles.ts";
import { SectionShell, FieldLabel } from "./SectionShell.tsx";

export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
}

export function InstructionsSection({ a, patch, locked }: SectionProps) {
  return (
    <SectionShell title="Instructions & Inputs" description="What this agent should do each run.">
      <div>
        <FieldLabel>Instructions</FieldLabel>
        <textarea
          className={`${inputCls} min-h-[160px]`}
          disabled={locked}
          value={a.instructions}
          onChange={(e) => patch({ instructions: e.target.value })}
        />
      </div>
      <div className="text-xs text-muted-foreground bg-muted rounded-md p-3">
        Insert an input with <code className={codePill}>{"{{name}}"}</code>. Available:{" "}
        {a.inputs.map((i) => `{{${i.name}}}`).join(" · ") || "—"}, <code className={codePill}>{"{{payload}}"}</code>,{" "}
        <code className={codePill}>{"{{trigger.type}}"}</code>.
      </div>
    </SectionShell>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/agents/sections/InstructionsSection.tsx
git commit -m "feat(web): polished InstructionsSection"
```

---

### Task 6: WorkspaceSection (provider, model, git connection, repos)

**Files:**
- Create: `packages/web/src/components/agents/sections/WorkspaceSection.tsx`

- [ ] **Step 1: Write the component** (ports the modal's `workspace` tab + repo-browse logic)

```tsx
// packages/web/src/components/agents/sections/WorkspaceSection.tsx
import { useEffect, useState } from "react";
import type { Agent, AgentUpdateInput, Connection, RepoSummary } from "@journeyman/core";
import { connectionsApi } from "../../../api/connections.ts";
import { CodingModelSelect } from "../../CodingModelSelect.tsx";
import { inputCls, btnGhost } from "../../../routes/admin-styles.ts";
import { SectionShell, FieldLabel } from "./SectionShell.tsx";

export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
  wsId: string;
}

export function WorkspaceSection({ a, patch, locked, wsId }: SectionProps) {
  const [gitConnections, setGitConnections] = useState<Connection[]>([]);
  const [repoConnectionId, setRepoConnectionId] = useState<string>(a.repoSelections[0]?.connectionId ?? "");
  const [browsedRepos, setBrowsedRepos] = useState<RepoSummary[] | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);

  useEffect(() => {
    connectionsApi.list(wsId, "git").then(setGitConnections).catch(() => setGitConnections([]));
  }, [wsId]);

  const addRepo = (fullName: string) => {
    if (a.repoSelections.some((r) => r.repo === fullName)) return;
    patch({
      repoSelections: [
        ...a.repoSelections,
        { repo: fullName, allowWrites: false, connectionId: repoConnectionId || undefined },
      ],
    });
  };

  const browse = async () => {
    setBrowseError(null);
    if (!repoConnectionId) {
      setBrowseError("Pick a git connection first");
      return;
    }
    try {
      const res = await connectionsApi.repos(wsId, repoConnectionId);
      if (res.error) setBrowseError(res.error);
      setBrowsedRepos(res.repos);
    } catch (e: any) {
      setBrowseError(e?.message ?? String(e));
    }
  };

  return (
    <SectionShell title="Workspace & Model" description="Where the agent runs and which model it uses.">
      <div>
        <FieldLabel>Provider</FieldLabel>
        <select
          className={inputCls}
          disabled={locked}
          value={a.provider}
          onChange={(e) => patch({ provider: e.target.value, model: undefined })}
        >
          <option value="claude">Claude</option>
          <option value="opencode">OpenCode</option>
          <option value="aisdk">AI-SDK</option>
        </select>
      </div>

      <div>
        <FieldLabel>Model</FieldLabel>
        <CodingModelSelect provider={a.provider} value={a.model} onChange={(m) => patch({ model: m })} disabled={locked} />
      </div>

      <div>
        <FieldLabel>Git connection</FieldLabel>
        <div className="flex gap-2">
          <select
            className={inputCls}
            disabled={locked}
            value={repoConnectionId}
            onChange={(e) => setRepoConnectionId(e.target.value)}
          >
            <option value="">— none (paste repos below) —</option>
            {gitConnections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.provider} · {c.label}
              </option>
            ))}
          </select>
          {!locked && (
            <button className={btnGhost} disabled={!repoConnectionId} onClick={browse}>
              Browse repos
            </button>
          )}
        </div>
        {browseError && <div className="mt-1 text-xs text-destructive">{browseError}</div>}
        {browsedRepos && (
          <div className="mt-2 max-h-40 overflow-y-auto border rounded-md p-2 space-y-1">
            {browsedRepos.map((r) => (
              <button
                key={r.fullName}
                className="block text-left text-sm hover:underline"
                disabled={locked}
                onClick={() => addRepo(r.fullName)}
              >
                + {r.fullName}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <FieldLabel>Repositories (one owner/repo or URL per line)</FieldLabel>
        <textarea
          className={`${inputCls} min-h-[100px]`}
          disabled={locked}
          value={a.repoSelections.map((r) => r.repo).join("\n")}
          onChange={(e) =>
            patch({
              repoSelections: e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((repo) => ({ repo, allowWrites: false, connectionId: repoConnectionId || undefined })),
            })
          }
        />
      </div>
    </SectionShell>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/agents/sections/WorkspaceSection.tsx
git commit -m "feat(web): polished WorkspaceSection (provider/model/repos)"
```

---

### Task 7: TriggersSection (schedule, API token, webhook)

**Files:**
- Create: `packages/web/src/components/agents/sections/TriggersSection.tsx`

Note: schedule/webhook edits **patch `a.triggers` directly** on each change so the global Save persists them. API-token issue/revoke act immediately via their own endpoints (unchanged from the modal).

- [ ] **Step 1: Write the component**

```tsx
// packages/web/src/components/agents/sections/TriggersSection.tsx
import { useEffect, useState } from "react";
import type { Agent, AgentUpdateInput } from "@journeyman/core";
import { agentsApi } from "../../../api/agents.ts";
import { inputCls, btnGhost, codePill } from "../../../routes/admin-styles.ts";
import { SectionShell } from "./SectionShell.tsx";

export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
  wsId: string;
}

export function TriggersSection({ a, patch, locked, wsId }: SectionProps) {
  const schedule = a.triggers.find((t) => t.type === "schedule") as
    | { type: "schedule"; cron: string; timezone: string }
    | undefined;
  const webhook = a.triggers.find((t) => t.type === "webhook") as
    | { type: "webhook"; webhookId: string; inputsMapping?: Record<string, string> }
    | undefined;

  const setSchedule = (next: { cron: string; timezone: string } | null) => {
    const others = a.triggers.filter((t) => t.type !== "schedule");
    patch({ triggers: next ? [...others, { type: "schedule", ...next }] : others });
  };
  const setWebhook = (next: { webhookId: string; inputsMapping: Record<string, string> } | null) => {
    const others = a.triggers.filter((t) => t.type !== "webhook");
    patch({ triggers: next ? [...others, { type: "webhook", ...next }] : others });
  };

  const [mappingText, setMappingText] = useState<string>(
    Object.entries(webhook?.inputsMapping ?? {})
      .map(([k, v]) => `${k} = ${v}`)
      .join("\n"),
  );
  const parseMapping = (text: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const [name, ...rest] = line.split("=");
      if (name?.trim() && rest.length) out[name.trim()] = rest.join("=").trim();
    }
    return out;
  };

  // API tokens (immediate, independent of Save)
  const [apiTokens, setApiTokens] = useState<Array<{ id: string; created_at: string }>>([]);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  useEffect(() => {
    agentsApi.listApiTokens(wsId, a.id).then(setApiTokens).catch(() => setApiTokens([]));
  }, [wsId, a.id]);
  const issueToken = async () => {
    const r = await agentsApi.issueApiToken(wsId, a.id);
    setRevealedToken(r.token);
    setApiTokens(await agentsApi.listApiTokens(wsId, a.id));
  };
  const revokeToken = async (tokenId: string) => {
    await agentsApi.revokeApiToken(wsId, a.id, tokenId);
    setApiTokens(await agentsApi.listApiTokens(wsId, a.id));
  };

  return (
    <SectionShell title="Triggers" description="How runs are started — on a schedule, via the API, or from a webhook.">
      {/* Schedule */}
      <div className="border rounded-lg p-4 space-y-2">
        <div className="font-medium text-sm">⏱ Schedule</div>
        <label className="flex gap-2 items-center text-sm">
          <input
            type="checkbox"
            disabled={locked}
            checked={Boolean(schedule)}
            onChange={(e) => setSchedule(e.target.checked ? { cron: "0 2 * * *", timezone: "UTC" } : null)}
          />{" "}
          Run on a schedule
        </label>
        {schedule && (
          <div className="flex gap-2">
            <input
              className={inputCls}
              disabled={locked}
              placeholder="cron (e.g. 0 2 * * *)"
              value={schedule.cron}
              onChange={(e) => setSchedule({ cron: e.target.value, timezone: schedule.timezone })}
            />
            <input
              className={inputCls}
              disabled={locked}
              placeholder="IANA timezone"
              value={schedule.timezone}
              onChange={(e) => setSchedule({ cron: schedule.cron, timezone: e.target.value })}
            />
          </div>
        )}
      </div>

      {/* API */}
      <div className="border rounded-lg p-4 space-y-2">
        <div className="font-medium text-sm">&lt;/&gt; API</div>
        <div className="text-xs text-muted-foreground">
          Fire via <code className={codePill}>POST /api/agents/{a.id}/fire</code> with{" "}
          <code className={codePill}>Authorization: Bearer &lt;token&gt;</code>.
        </div>
        {revealedToken && (
          <div className="text-xs bg-muted rounded p-2 break-all">
            🔑 Copy now (shown once): <code className={codePill}>{revealedToken}</code>
          </div>
        )}
        <button className={btnGhost} onClick={issueToken}>Issue token</button>
        <ul className="text-xs text-muted-foreground space-y-1">
          {apiTokens.map((t) => (
            <li key={t.id} className="flex gap-2 items-center">
              <span>token …{t.id.slice(0, 8)} · created {t.created_at}</span>
              <button className="text-destructive underline" onClick={() => revokeToken(t.id)}>revoke</button>
            </li>
          ))}
        </ul>
      </div>

      {/* Webhook */}
      <div className="border rounded-lg p-4 space-y-2">
        <div className="font-medium text-sm">🪝 Webhook</div>
        <div className="text-xs text-muted-foreground">
          Create a webhook on the Webhooks page, then paste its ID here. Inbound events fire this agent.
        </div>
        <label className="flex gap-2 items-center text-sm">
          <input
            type="checkbox"
            disabled={locked}
            checked={Boolean(webhook)}
            onChange={(e) =>
              setWebhook(e.target.checked ? { webhookId: "", inputsMapping: parseMapping(mappingText) } : null)
            }
          />{" "}
          Fire from a webhook
        </label>
        {webhook && (
          <>
            <input
              className={inputCls}
              disabled={locked}
              placeholder="webhook id"
              value={webhook.webhookId}
              onChange={(e) => setWebhook({ webhookId: e.target.value, inputsMapping: parseMapping(mappingText) })}
            />
            <label className="text-xs text-muted-foreground">
              Map payload → inputs (one <code className={codePill}>name = $.json.path</code> per line)
            </label>
            <textarea
              className={inputCls}
              disabled={locked}
              placeholder="ticketKey = $.issue.key"
              value={mappingText}
              onChange={(e) => {
                setMappingText(e.target.value);
                setWebhook({ webhookId: webhook.webhookId, inputsMapping: parseMapping(e.target.value) });
              }}
            />
          </>
        )}
      </div>
    </SectionShell>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/agents/sections/TriggersSection.tsx
git commit -m "feat(web): polished TriggersSection (schedule/api/webhook)"
```

---

### Task 8: BehaviorSection (max steps, timeout, output mode, safety limits)

**Files:**
- Create: `packages/web/src/components/agents/sections/BehaviorSection.tsx`

- [ ] **Step 1: Write the component** (ports the modal's `behavior` tab)

```tsx
// packages/web/src/components/agents/sections/BehaviorSection.tsx
import type { Agent, AgentUpdateInput } from "@journeyman/core";
import { inputCls } from "../../../routes/admin-styles.ts";
import { SectionShell, FieldLabel } from "./SectionShell.tsx";

export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
}

const numOrUndef = (v: string) => (v ? Number(v) : undefined);

export function BehaviorSection({ a, patch, locked }: SectionProps) {
  return (
    <SectionShell title="Behavior" description="Execution limits, output mode, and safety overrides.">
      <div>
        <FieldLabel>Max steps</FieldLabel>
        <input
          type="number"
          className={inputCls}
          disabled={locked}
          value={a.behavior.maxTurns ?? ""}
          onChange={(e) => patch({ behavior: { ...a.behavior, maxTurns: numOrUndef(e.target.value) } })}
        />
      </div>
      <div>
        <FieldLabel>Timeout (seconds)</FieldLabel>
        <input
          type="number"
          className={inputCls}
          disabled={locked}
          value={a.behavior.timeoutSeconds ?? ""}
          onChange={(e) => patch({ behavior: { ...a.behavior, timeoutSeconds: numOrUndef(e.target.value) } })}
        />
      </div>
      <div>
        <FieldLabel>Output mode</FieldLabel>
        <select
          className={inputCls}
          disabled={locked}
          value={a.outputMode}
          onChange={(e) => patch({ outputMode: e.target.value as Agent["outputMode"] })}
        >
          <option value="text">Text</option>
          <option value="structured">Structured</option>
          <option value="none">None</option>
        </select>
      </div>

      <div className="pt-4 border-t">
        <p className="text-sm font-medium">Safety limits (override org defaults)</p>
        <p className="text-xs text-muted-foreground mb-3">
          Leave blank to inherit the org default. Empty everywhere = no limit.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-muted-foreground">
            Max concurrent runs
            <input
              type="number"
              className={inputCls}
              disabled={locked}
              value={a.limits?.maxConcurrentRuns ?? ""}
              onChange={(e) => patch({ limits: { ...a.limits, maxConcurrentRuns: numOrUndef(e.target.value) } })}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Daily run cap
            <input
              type="number"
              className={inputCls}
              disabled={locked}
              value={a.limits?.dailyRunCap ?? ""}
              onChange={(e) => patch({ limits: { ...a.limits, dailyRunCap: numOrUndef(e.target.value) } })}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Budget: max tokens / day
            <input
              type="number"
              className={inputCls}
              disabled={locked}
              value={a.limits?.budget?.maxTokens ?? ""}
              onChange={(e) =>
                patch({ limits: { ...a.limits, budget: { ...a.limits?.budget, maxTokens: numOrUndef(e.target.value) } } })
              }
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Budget: max $ / day
            <input
              type="number"
              step="0.01"
              className={inputCls}
              disabled={locked}
              value={a.limits?.budget?.maxCostUsd ?? ""}
              onChange={(e) =>
                patch({ limits: { ...a.limits, budget: { ...a.limits?.budget, maxCostUsd: numOrUndef(e.target.value) } } })
              }
            />
          </label>
        </div>
      </div>
    </SectionShell>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/agents/sections/BehaviorSection.tsx
git commit -m "feat(web): polished BehaviorSection (limits + output mode)"
```

---

### Task 9: PermissionsSection

**Files:**
- Create: `packages/web/src/components/agents/sections/PermissionsSection.tsx`

- [ ] **Step 1: Write the component**

```tsx
// packages/web/src/components/agents/sections/PermissionsSection.tsx
import type { Agent, AgentUpdateInput, CanonicalTool } from "@journeyman/core";
import { ToolsPicker } from "../../custom-steps/ToolsPicker.tsx";
import { SectionShell, FieldLabel } from "./SectionShell.tsx";

export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
}

export function PermissionsSection({ a, patch }: SectionProps) {
  return (
    <SectionShell title="Permissions" description="Which tools the agent is allowed to use.">
      <div>
        <FieldLabel>Allowed tools</FieldLabel>
        <ToolsPicker
          value={a.permissions.allowedTools}
          onChange={(t: CanonicalTool[]) => patch({ permissions: { allowedTools: t }, tools: t })}
        />
      </div>
    </SectionShell>
  );
}
```

Note: `ToolsPicker` has no `disabled` prop today; the modal also rendered it without one, so `locked` is intentionally unused here (kept in the prop type for consistency). The lock banner + disabled Save still prevent persisting changes.

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/agents/sections/PermissionsSection.tsx
git commit -m "feat(web): polished PermissionsSection (tools picker)"
```

---

### Task 10: NotificationsSection

**Files:**
- Create: `packages/web/src/components/agents/sections/NotificationsSection.tsx`

- [ ] **Step 1: Write the component** (ports the modal's `notifications` tab)

```tsx
// packages/web/src/components/agents/sections/NotificationsSection.tsx
import { useEffect, useState } from "react";
import type { Agent, AgentUpdateInput, Connection } from "@journeyman/core";
import { connectionsApi } from "../../../api/connections.ts";
import { inputCls } from "../../../routes/admin-styles.ts";
import { SectionShell, FieldLabel } from "./SectionShell.tsx";

export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
  wsId: string;
}

export function NotificationsSection({ a, patch, locked, wsId }: SectionProps) {
  const [notifyConnections, setNotifyConnections] = useState<Connection[]>([]);
  useEffect(() => {
    connectionsApi.list(wsId, "notification").then(setNotifyConnections).catch(() => setNotifyConnections([]));
  }, [wsId]);

  const toggleOn = (key: "success" | "failure", checked: boolean) =>
    patch({
      notifications: {
        ...a.notifications,
        on: checked
          ? [...new Set([...a.notifications.on, key])]
          : a.notifications.on.filter((x) => x !== key),
      },
    });

  return (
    <SectionShell title="Notifications" description="Deliver a message when a run finishes.">
      <div>
        <FieldLabel>Notification connection</FieldLabel>
        <select
          className={inputCls}
          disabled={locked}
          value={a.notifications.connectionId ?? ""}
          onChange={(e) => patch({ notifications: { ...a.notifications, connectionId: e.target.value || undefined } })}
        >
          <option value="">— none —</option>
          {notifyConnections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} ({c.provider})
            </option>
          ))}
        </select>
        {notifyConnections.length === 0 && (
          <span className="text-xs text-muted-foreground">No notification connections yet — add one under Connections.</span>
        )}
      </div>

      <div>
        <FieldLabel>Channel / target</FieldLabel>
        <input
          className={inputCls}
          disabled={locked}
          placeholder="#alerts or a user id (ignored for incoming webhooks)"
          value={a.notifications.target ?? ""}
          onChange={(e) => patch({ notifications: { ...a.notifications, target: e.target.value || undefined } })}
        />
      </div>

      <label className="flex gap-2 items-center text-sm">
        <input
          type="checkbox"
          disabled={locked}
          checked={a.notifications.on.includes("success")}
          onChange={(e) => toggleOn("success", e.target.checked)}
        />{" "}
        Notify on success
      </label>
      <label className="flex gap-2 items-center text-sm">
        <input
          type="checkbox"
          disabled={locked}
          checked={a.notifications.on.includes("failure")}
          onChange={(e) => toggleOn("failure", e.target.checked)}
        />{" "}
        Notify on failure
      </label>
    </SectionShell>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/agents/sections/NotificationsSection.tsx
git commit -m "feat(web): polished NotificationsSection"
```

---

### Task 11: AgentDetail shell (header, nav, save/lock, section routing)

**Files:**
- Create: `packages/web/src/components/agents/AgentDetail.tsx`
- Test: `packages/web/src/components/agents/AgentDetail.test.tsx`

- [ ] **Step 1: Write the failing render test**

```tsx
// packages/web/src/components/agents/AgentDetail.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Agent } from "@journeyman/core";
import { AgentDetail } from "./AgentDetail.tsx";

const agent: Agent = {
  id: "a1", workspaceId: "w1", orgId: "o1", name: "nightly-triager",
  instructions: "x", inputs: [], provider: "claude", model: "claude-opus-4-8",
  connectorMcpIds: [], tools: [], skillIds: [], repoSelections: [],
  permissions: { allowedTools: [] }, notifications: { on: [] }, outputMode: "text",
  behavior: {}, triggers: [], status: "draft", enabled: false,
  createdBy: "u1", createdAt: "2026-06-19T00:00:00Z", updatedAt: "2026-06-19T00:00:00Z",
};

function render(a: Agent) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AgentDetail wsId="w1" orgId="o1" initial={a} />
    </MemoryRouter>,
  );
}

describe("AgentDetail", () => {
  it("shows the agent name and status badge", () => {
    const html = render(agent);
    expect(html).toContain("nightly-triager");
    expect(html).toContain("DRAFT");
  });
  it("renders the instructions section by default", () => {
    expect(render(agent)).toContain("Instructions & Inputs");
  });
  it("shows the lock banner when enabled", () => {
    const html = render({ ...agent, enabled: true });
    expect(html).toContain("ENABLED");
    expect(html).toContain("disable to edit");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run src/components/agents/AgentDetail.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
// packages/web/src/components/agents/AgentDetail.tsx
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Agent, AgentUpdateInput } from "@journeyman/core";
import { agentsApi } from "../../api/agents.ts";
import { btnPrimary, btnGhost, card } from "../../routes/admin-styles.ts";
import { buildUpdateInput, isAgentDirty, agentSummary, statusLabel } from "./agent-form.ts";
import { SectionNav, SECTIONS, type SectionId } from "./sections/SectionNav.tsx";
import { InstructionsSection } from "./sections/InstructionsSection.tsx";
import { WorkspaceSection } from "./sections/WorkspaceSection.tsx";
import { TriggersSection } from "./sections/TriggersSection.tsx";
import { BehaviorSection } from "./sections/BehaviorSection.tsx";
import { PermissionsSection } from "./sections/PermissionsSection.tsx";
import { NotificationsSection } from "./sections/NotificationsSection.tsx";
import { RunHistorySection } from "./sections/RunHistorySection.tsx";

export function AgentDetail({ wsId, orgId, initial }: { wsId: string; orgId: string; initial: Agent }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawSection = params.get("section") ?? "instructions";
  const section = (SECTIONS.some((s) => s.id === rawSection) ? rawSection : "instructions") as SectionId;

  const [original, setOriginal] = useState<Agent>(initial);
  const [a, setA] = useState<Agent>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const locked = a.enabled;
  const dirty = isAgentDirty(original, a);
  const backTo = `/workspaces/${wsId}/agents`;

  const patch = (p: AgentUpdateInput) => setA((prev) => ({ ...prev, ...p } as Agent));
  const selectSection = (id: SectionId) => setParams({ section: id }, { replace: true });

  const guarded = (id: SectionId) => {
    if (dirty && !confirm("You have unsaved changes. Discard them?")) return;
    selectSection(id);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await agentsApi.update(wsId, a.id, buildUpdateInput(a));
      setOriginal(updated);
      setA(updated);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleEnable = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = a.enabled ? await agentsApi.disable(wsId, a.id) : await agentsApi.enable(wsId, a.id);
      setOriginal(updated);
      setA(updated);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setBusy(true);
    setError(null);
    try {
      await agentsApi.runNow(wsId, a.id, {});
      selectSection("runs");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-8 space-y-6">
        <header>
          <Link to={backTo} className="text-xs text-muted-foreground hover:text-foreground">← Agents</Link>
          <div className="mt-2 flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold">{a.name}</h1>
                <span className="text-[11px] font-semibold tracking-wide rounded-full bg-muted text-muted-foreground px-2 py-0.5">
                  {statusLabel(a)}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{agentSummary(a)}</p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={a.enabled} disabled={busy} onChange={toggleEnable} />
                Enabled
              </label>
              <button className={btnGhost} disabled={busy} onClick={runNow}>Run now</button>
              <button className={btnPrimary} disabled={busy || locked || !dirty} onClick={save}>
                {dirty ? "Save changes" : "Saved"}
              </button>
            </div>
          </div>
        </header>

        {locked && (
          <div className="rounded-md bg-muted text-muted-foreground text-sm px-4 py-2">
            🔒 Enabled — disable to edit.
          </div>
        )}
        {error && <div className="text-sm text-destructive">{error}</div>}

        <div className={`${card} overflow-hidden`}>
          <div className="flex">
            <aside className="w-56 shrink-0 border-r p-3">
              <SectionNav active={section} onSelect={guarded} />
            </aside>
            <div className="flex-1 p-6">
              {section === "instructions" && <InstructionsSection a={a} patch={patch} locked={locked} />}
              {section === "workspace" && <WorkspaceSection a={a} patch={patch} locked={locked} wsId={wsId} />}
              {section === "triggers" && <TriggersSection a={a} patch={patch} locked={locked} wsId={wsId} />}
              {section === "behavior" && <BehaviorSection a={a} patch={patch} locked={locked} />}
              {section === "permissions" && <PermissionsSection a={a} patch={patch} locked={locked} />}
              {section === "notifications" && <NotificationsSection a={a} patch={patch} locked={locked} wsId={wsId} />}
              {section === "runs" && <RunHistorySection wsId={wsId} agentId={a.id} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

Note: `orgId` is part of the public prop shape (consumed by callers/tests and reserved for future org-scoped controls); it is intentionally not referenced in the body yet. If the repo's lint fails on unused props, prefix with `_orgId` in the destructure.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npx vitest run src/components/agents/AgentDetail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/agents/AgentDetail.tsx packages/web/src/components/agents/AgentDetail.test.tsx
git commit -m "feat(web): AgentDetail two-pane settings shell"
```

---

### Task 12: AgentDetailPage route component

**Files:**
- Create: `packages/web/src/routes/AgentDetailPage.tsx`

- [ ] **Step 1: Write the component**

```tsx
// packages/web/src/routes/AgentDetailPage.tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { Agent } from "@journeyman/core";
import { agentsApi } from "../api/agents.ts";
import { useWorkspace } from "../WorkspaceContext.tsx";
import { AgentDetail } from "../components/agents/AgentDetail.tsx";

export function AgentDetailPage() {
  const { wsId = "", agentId = "" } = useParams<{ wsId: string; agentId: string }>();
  const { workspaces, activeWorkspace } = useWorkspace();
  const orgId = workspaces.find((w) => w.id === wsId)?.orgId ?? activeWorkspace?.orgId ?? "";

  const [agent, setAgent] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!wsId || !agentId) return;
    agentsApi.get(wsId, agentId).then(setAgent).catch((e) => setError(e?.message ?? String(e)));
  }, [wsId, agentId]);

  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (!agent) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;

  return <AgentDetail wsId={wsId} orgId={orgId} initial={agent} />;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/routes/AgentDetailPage.tsx
git commit -m "feat(web): AgentDetailPage route component"
```

---

### Task 13: Wire route, update AgentsList navigation, delete the modal

**Files:**
- Modify: `packages/web/src/App.tsx` (import + route near the other `/workspaces/:wsId/...` routes)
- Modify: `packages/web/src/components/agents/AgentsList.tsx`
- Delete: `packages/web/src/components/agents/EditAgentModal.tsx`

- [ ] **Step 1: Add the import to `App.tsx`**

Add next to the existing `import { AgentsPage } from "./routes/AgentsPage.tsx";` (around line 12):

```tsx
import { AgentDetailPage } from "./routes/AgentDetailPage.tsx";
```

- [ ] **Step 2: Register the route in `App.tsx`**

Immediately after the existing line:

```tsx
        <Route path="/workspaces/:wsId/agents" element={<AgentsPage />} />
```

add:

```tsx
        <Route path="/workspaces/:wsId/agents/:agentId" element={<AgentDetailPage />} />
```

- [ ] **Step 3: Rewrite `AgentsList.tsx` to navigate instead of opening the modal**

Replace the entire file with:

```tsx
// packages/web/src/components/agents/AgentsList.tsx
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { agentsApi } from "../../api/agents.ts";
import type { Agent } from "@journeyman/core";
import { btnPrimary, btnGhost, btnDanger, card } from "../../routes/admin-styles.ts";

export function AgentsList({ orgId: _orgId, wsId }: { orgId: string; wsId: string }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await agentsApi.list(wsId));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [wsId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createDraft = async () => {
    try {
      const a = await agentsApi.create(wsId, { name: newName.trim() });
      setCreating(false);
      setNewName("");
      navigate(`/workspaces/${wsId}/agents/${a.id}`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  return (
    <div className={`${card} overflow-hidden`}>
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="font-semibold">Agents</h2>
        <button className={btnPrimary} onClick={() => setCreating(true)}>+ Create agent</button>
      </div>
      {error && <div className="px-4 py-2 text-sm text-destructive">{error}</div>}
      {creating && (
        <div className="p-4 flex gap-2 border-b">
          <input
            autoFocus
            className="flex-1 rounded-md border px-3 py-2 text-sm bg-transparent"
            placeholder="Agent name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) void createDraft();
            }}
          />
          <button className={btnPrimary} disabled={!newName.trim()} onClick={createDraft}>Create</button>
          <button className={btnGhost} onClick={() => setCreating(false)}>Cancel</button>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Triggers</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td className="px-4 py-3" colSpan={4}>Loading…</td>
            </tr>
          )}
          {!loading && items.length === 0 && (
            <tr>
              <td className="px-4 py-3 text-muted-foreground" colSpan={4}>No agents yet</td>
            </tr>
          )}
          {items.map((a) => (
            <tr key={a.id} className="border-t">
              <td className="px-4 py-2 font-medium">{a.name}</td>
              <td className="px-4 py-2">{a.enabled ? "enabled" : a.status}</td>
              <td className="px-4 py-2 text-muted-foreground">
                {a.triggers.map((t) => t.type).join(", ") || "manual"}
              </td>
              <td className="px-4 py-2 text-right">
                <button className={btnGhost} onClick={() => navigate(`/workspaces/${wsId}/agents/${a.id}`)}>Open</button>
                <button
                  className={btnDanger}
                  onClick={async () => {
                    await agentsApi.remove(wsId, a.id);
                    await refresh();
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Delete the modal**

```bash
git rm packages/web/src/components/agents/EditAgentModal.tsx
```

- [ ] **Step 5: Verify no remaining references to the modal**

Run: `cd /Users/admin/data/workspace/claude-skils/journeyman && grep -rn "EditAgentModal" packages/web/src || echo "no references"`
Expected: `no references`

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/components/agents/AgentsList.tsx
git commit -m "feat(web): route agent create/open to the new settings page; remove modal"
```

---

### Task 14: Full verification

- [ ] **Step 1: Type-check + import boundaries**

Run: `cd /Users/admin/data/workspace/claude-skils/journeyman && npm run check`
Expected: passes (no type errors, no boundary violations).

- [ ] **Step 2: Run the web test suite**

Run: `cd packages/web && npx vitest run`
Expected: all tests pass, including the new `agent-form`, `SectionNav`, and `AgentDetail` tests.

- [ ] **Step 3: Manual verification via the preview workflow**

Start the dev server (`preview_start`), then verify in the browser:
1. Workspace → Agents → **+ Create agent** → type a name → lands on `/workspaces/:wsId/agents/:agentId` with the two-pane page.
2. Edit Instructions → **Save changes** → reload → text persists; button reads "Saved" until next edit.
3. Toggle **Enabled** → form locks with the 🔒 banner and Save disables → toggle off → editable again.
4. Switch sections via the left nav; switching with unsaved edits prompts a discard confirm; deep-link `?section=triggers` survives refresh.
5. **Run now** → jumps to Run history and lists the run.

Capture a screenshot of the finished page to share as proof.

- [ ] **Step 4: Final commit (if verification required tweaks)**

```bash
git add -A
git commit -m "fix(web): agent settings page verification fixes"
```

---

## Self-Review Notes

- **Spec coverage:** routing (Task 12–13), create flow keeps name prompt (Task 13), two-pane layout + header + nav (Task 3, 11), single Save + dirty state (Task 1, 11), enable-locks (Task 11), all 7 sections polished (Tasks 4–10), section deep-link (Task 11), modal deletion (Task 13), verification (Task 14). All spec sections map to tasks.
- **Type consistency:** `SectionProps` shape is consistent across section files; `buildUpdateInput`/`isAgentDirty`/`agentSummary`/`statusLabel` names match between Task 1 and Task 11; `SECTIONS`/`SectionId` match between Task 3 and Task 11.
- **Known intentional unused props:** `locked` in `PermissionsSection` and `orgId` in `AgentDetail` (documented inline) — these mirror the modal's behavior and reserve a stable interface.
