# Webhook UI + New Run Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ProviderBadge` component, extend the runs list with a `Triggered by` column + provider/issueRef filters, improve `NewRunDialog` with a provider selector that builds `issueRef` automatically, and add a `Trigger` section to the run detail page.

**Architecture:** Build the shared `ProviderBadge` component first. Then extend types and filters. Then update the runs list. Then update the dialog. Then update the detail page. API changes (provider/issueRef filter params, `webhookEvent` in detail response) run in parallel with the frontend work since the frontend will gracefully handle missing data.

**Tech Stack:** React, TypeScript, `@tanstack/react-query`, Fastify, PostgreSQL. Depends on webhook-event-tracking plan being complete.

---

### Task 1: Create `ProviderBadge` component

**Files:**
- Create: `packages/runs-list/src/ProviderBadge.tsx`
- Modify: `packages/runs-list/src/index.ts`

- [ ] **Step 1: Create `ProviderBadge.tsx`**

```tsx
// packages/runs-list/src/ProviderBadge.tsx

const COLOURS: Record<string, { bg: string; color: string; border: string }> = {
  jira:    { bg: "rgba(37,99,235,0.18)",   color: "#93c5fd", border: "rgba(37,99,235,0.4)" },
  github:  { bg: "rgba(100,116,139,0.18)", color: "#cbd5e1", border: "rgba(100,116,139,0.4)" },
  monday:  { bg: "rgba(22,163,74,0.18)",   color: "#86efac", border: "rgba(22,163,74,0.4)" },
  linear:  { bg: "rgba(124,58,237,0.18)",  color: "#c4b5fd", border: "rgba(124,58,237,0.4)" },
  api:     { bg: "rgba(217,119,6,0.18)",   color: "#fcd34d", border: "rgba(217,119,6,0.4)" },
  manual:  { bg: "rgba(107,114,128,0.18)", color: "#d1d5db", border: "rgba(107,114,128,0.4)" },
};

const DEFAULT_COLOUR = { bg: "rgba(107,114,128,0.18)", color: "#d1d5db", border: "rgba(107,114,128,0.4)" };

interface ProviderBadgeProps {
  provider: string;
}

export function ProviderBadge({ provider }: ProviderBadgeProps) {
  const c = COLOURS[provider] ?? DEFAULT_COLOUR;
  return (
    <span style={{
      display: "inline-block",
      fontSize: 10,
      fontWeight: 600,
      padding: "2px 7px",
      borderRadius: 3,
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      background: c.bg,
      color: c.color,
      border: `1px solid ${c.border}`,
    }}>
      {provider}
    </span>
  );
}
```

- [ ] **Step 2: Export from `packages/runs-list/src/index.ts`**

```typescript
export { ProviderBadge } from "./ProviderBadge.tsx";
```

---

### Task 2: Extend `RunFilter` type

**Files:**
- Modify: `packages/runs-list/src/types.ts`

- [ ] **Step 1: Add `provider` and `issueRef` to `RunFilter`**

```typescript
// packages/runs-list/src/types.ts
import type { Run } from "@journeyman/core";

export interface RunFilter {
  status?: Run["status"];
  flowId?: string;
  provider?: string;
  issueRef?: string;
}

// RunsListProps stays unchanged
export interface RunsListProps {
  runs: Run[];
  isLoading?: boolean;
  filter: RunFilter;
  onFilterChange: (next: RunFilter) => void;
  onSelectRun: (runId: string) => void;
  onRerun?: (run: Run) => void;
  onNewRun?: () => void;
  flowNameByVersionId?: Record<string, string>;
  scope?: "mine" | "org" | "all";
  onScopeChange?: (scope: "mine" | "org" | "all") => void;
  showOrgChip?: boolean;
  showAllChip?: boolean;
}
```

---

### Task 3: Update `RunFilters` component

**Files:**
- Modify: `packages/runs-list/src/RunFilters.tsx`

- [ ] **Step 1: Add provider dropdown and issueRef input**

```tsx
// packages/runs-list/src/RunFilters.tsx
import type { RunFilter } from "./types.ts";
import type { Run } from "@journeyman/core";

const STATUSES: Run["status"][] = ["pending", "running", "completed", "failed", "cancelled", "paused"];
const PROVIDERS = ["jira", "github", "monday", "linear", "manual", "api"];

export interface RunFiltersProps {
  filter: RunFilter;
  onChange: (next: RunFilter) => void;
}

export function RunFilters({ filter, onChange }: RunFiltersProps) {
  return (
    <div className="je-runslist__filters">
      <select
        value={filter.status ?? ""}
        onChange={e => onChange({ ...filter, status: (e.target.value || undefined) as Run["status"] | undefined })}
      >
        <option value="">All statuses</option>
        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      <select
        value={filter.provider ?? ""}
        onChange={e => onChange({ ...filter, provider: e.target.value || undefined })}
      >
        <option value="">All providers</option>
        {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
      </select>

      <input
        type="text"
        value={filter.issueRef ?? ""}
        onChange={e => onChange({ ...filter, issueRef: e.target.value || undefined })}
        placeholder="Issue ref e.g. jira:PROJ-123"
        style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #2a2a3e", background: "#0f0f1e", color: "#fff", fontSize: 12 }}
      />
    </div>
  );
}
```

---

### Task 4: Update `RunsList` component

**Files:**
- Modify: `packages/runs-list/src/RunsList.tsx`

- [ ] **Step 1: Read the current `RunsList.tsx` to understand the table structure**

```bash
cat packages/runs-list/src/RunsList.tsx
```

- [ ] **Step 2: Add `Triggered by` column and ignored row expansion**

Find where the run rows are rendered. Add a `triggeredBy` cell that shows `ProviderBadge` + raw issueRef portion, and de-emphasise ignored rows. Add inline expansion for ignored rows.

The key additions are:

```tsx
import { ProviderBadge } from "./ProviderBadge.tsx";

// Helper to extract raw portion from issueRef (e.g. "jira:PROJ-123" → "PROJ-123")
function rawIssueId(issueRef: string | null | undefined): string {
  if (!issueRef) return "";
  const colon = issueRef.indexOf(":");
  return colon === -1 ? issueRef : issueRef.slice(colon + 1);
}

// In the row render, add state for expanded ignored rows:
const [expandedIgnored, setExpandedIgnored] = React.useState<Set<string>>(new Set());

// In the table header, add after "Workflow":
<th>Triggered by</th>

// In each run row, add the cell:
<td>
  {run.triggerSource === "webhook" && (run as any).webhookEvent ? (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <ProviderBadge provider={(run as any).webhookEvent.provider} />
      <span style={{ fontSize: 12, color: "#ccc" }}>
        {rawIssueId((run as any).webhookEvent.issueRef)}
      </span>
    </span>
  ) : (
    <ProviderBadge provider={run.triggerSource} />
  )}
</td>

// For ignored rows, wrap the row with reduced opacity and click to expand:
// (ignored runs come from the API with status "ignored" and webhookEvent populated but no run id)
const isIgnored = (run as any).status === "ignored";
<tr
  style={isIgnored ? { opacity: 0.45, cursor: "pointer" } : undefined}
  onClick={isIgnored ? () => setExpandedIgnored(prev => {
    const next = new Set(prev);
    next.has(run.id) ? next.delete(run.id) : next.add(run.id);
    return next;
  }) : undefined}
>
  {/* ... cells ... */}
</tr>
{isIgnored && expandedIgnored.has(run.id) && (
  <tr>
    <td colSpan={99} style={{ background: "#1a1a2e", padding: "8px 16px", color: "#fbbf24", fontSize: 12 }}>
      ⚠ Webhook ignored — no matching flow found
      {(run as any).webhookEvent?.deliveryId && (
        <span style={{ marginLeft: 12, color: "#888" }}>
          Delivery: {(run as any).webhookEvent.deliveryId}
        </span>
      )}
      {(run as any).webhookEvent?.receivedAt && (
        <span style={{ marginLeft: 12, color: "#888" }}>
          Received: {new Date((run as any).webhookEvent.receivedAt).toUTCString()}
        </span>
      )}
    </td>
  </tr>
)}
```

---

### Task 5: Update `web/src/api/runs.ts` to pass new filters

**Files:**
- Modify: `packages/web/src/api/runs.ts`

- [ ] **Step 1: Add `provider` and `issueRef` to list params, and `webhookEvent` to detail response type**

```typescript
// In listRuns:
export async function listRuns(filter: {
  status?: Run["status"];
  flowId?: string;
  provider?: string;
  issueRef?: string;
  scope?: RunListScope;
} = {}): Promise<Run[]> {
  const params = new URLSearchParams();
  if (filter.status)   params.set("status",    filter.status);
  if (filter.flowId)   params.set("flow_id",   filter.flowId);
  if (filter.provider) params.set("provider",  filter.provider);
  if (filter.issueRef) params.set("issue_ref", filter.issueRef);
  if (filter.scope)    params.set("scope",     filter.scope);
  // ... rest of function unchanged
}

// Add WebhookEventSummary type:
export type WebhookEventSummary = {
  id: string;
  provider: string;
  eventType: string | null;
  issueRef: string | null;
  deliveryId: string | null;
  receivedAt: string;
  rawPayload: unknown;
};

// Update getRun return type to include webhookEvent:
// Find the existing getRun function and add webhookEvent to its return type:
export async function getRun(id: string): Promise<{
  run: Run & { effectiveRole?: string | null };
  events: RunEvent[];
  executions: NodeExecution[];
  webhookEvent: WebhookEventSummary | null;
}> {
  return await api(`/runs/${encodeURIComponent(id)}`);
}
```

---

### Task 6: Update `RunsListPage.tsx` — improve `NewRunDialog`

**Files:**
- Modify: `packages/web/src/routes/RunsListPage.tsx`

- [ ] **Step 1: Replace `ticketId` state with provider + rawId in `NewRunDialog`**

Import `buildIssueRef` and update the dialog state and UI:

```tsx
import { buildIssueRef, type IssueRefProvider } from "@journeyman/core";

// Replace:
//   const [ticketId, setTicketId] = useState("");
// With:
  const [provider, setProvider] = useState<IssueRefProvider>("jira");
  const [rawId, setRawId] = useState("");

// The built ref for display:
  const issueRef = rawId.trim() ? buildIssueRef(provider, rawId.trim()) : "";
```

- [ ] **Step 2: Replace the Ticket ID input with provider selector + raw ID field**

Replace the existing `<label>` block that renders the ticketId input with:

```tsx
{/* Issue Ref */}
<label style={{ display: "block", marginBottom: 14 }}>
  <span style={{ fontSize: 12, color: "#aaa", display: "block", marginBottom: 5 }}>Issue Ref</span>
  <div style={{ display: "flex", gap: 8 }}>
    <select
      value={provider}
      onChange={e => setProvider(e.target.value as IssueRefProvider)}
      style={{ background: "#0f0f1e", border: "1px solid #2a2a3e", color: "#fff", padding: "8px 10px", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
    >
      <option value="jira">Jira</option>
      <option value="github">GitHub</option>
      <option value="monday">Monday</option>
      <option value="linear">Linear</option>
    </select>
    <input
      type="text"
      value={rawId}
      onChange={e => setRawId(e.target.value)}
      placeholder={
        provider === "jira"    ? "PROJ-123" :
        provider === "github"  ? "owner/repo#42" :
        provider === "monday"  ? "12345678" :
        "ENG-99"
      }
      style={{ flex: 1, background: "#0f0f1e", border: "1px solid #2a2a3e", color: "#fff", padding: "8px 10px", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
    />
  </div>
  {issueRef && (
    <span style={{ fontSize: 11, color: "#6c5ce7", display: "block", marginTop: 4 }}>
      → {issueRef}
    </span>
  )}
</label>
```

- [ ] **Step 3: Update `mutationFn` to use `issueRef` instead of `ticketId`**

```typescript
    mutationFn: () => {
      const inputs: Record<string, unknown> = {};
      if (issueRef) inputs.issueRef = issueRef;   // was: if (ticketId.trim()) inputs.ticketId = ticketId.trim()
      // ... rest unchanged
    },
```

- [ ] **Step 4: Pass `provider` and `issueRef` to `listRuns` in the runs query**

```typescript
  const q = useQuery({
    queryKey: ["runs", filter, scope],
    queryFn: () => listRuns({
      status: filter.status,
      flowId: filter.flowId,
      provider: filter.provider,
      issueRef: filter.issueRef,
      scope,
    }),
    refetchInterval: 4000,
  });
```

---

### Task 7: Update `RunDetailPage.tsx` — add `Trigger` section

**Files:**
- Modify: `packages/web/src/routes/RunDetailPage.tsx`

- [ ] **Step 1: Read the current RunDetailPage to find the correct insertion point**

```bash
grep -n "RunViewer\|return\|<div" packages/web/src/routes/RunDetailPage.tsx | head -30
```

- [ ] **Step 2: Add the `Trigger` section above `RunViewer`**

In the return of `RunDetailPage`, add before `<RunViewer ...>`:

```tsx
{detailQ.data?.webhookEvent && (
  <div style={{
    margin: "0 0 12px",
    padding: "12px 16px",
    background: "#1a1a2e",
    border: "1px solid #2a2a3e",
    borderRadius: 8,
    fontSize: 13,
    color: "#ccc",
  }}>
    <div style={{ fontWeight: 700, marginBottom: 10, color: "#fff", fontSize: 14 }}>Trigger</div>
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <tbody>
        {[
          ["Provider",   detailQ.data.webhookEvent.provider],
          ["Event",      detailQ.data.webhookEvent.eventType ?? "—"],
          ["Issue ref",  detailQ.data.webhookEvent.issueRef ?? "—"],
          ["Delivery",   detailQ.data.webhookEvent.deliveryId ?? "—"],
          ["Received",   new Date(detailQ.data.webhookEvent.receivedAt).toUTCString()],
        ].map(([label, value]) => (
          <tr key={label}>
            <td style={{ color: "#888", paddingRight: 16, paddingBottom: 4, whiteSpace: "nowrap" }}>{label}</td>
            <td style={{ paddingBottom: 4 }}>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <details style={{ marginTop: 10 }}>
      <summary style={{ cursor: "pointer", color: "#6c5ce7", fontSize: 12 }}>Raw payload</summary>
      <pre style={{
        marginTop: 8, padding: 10, background: "#0f0f1e", borderRadius: 4,
        fontSize: 11, color: "#a0aec0", overflowX: "auto",
      }}>
        {JSON.stringify(detailQ.data.webhookEvent.rawPayload, null, 2)}
      </pre>
    </details>
  </div>
)}
```

---

### Task 8: Update `api-server/src/routes/runs.ts` for new filters and `webhookEvent` in detail

**Files:**
- Modify: `packages/api-server/src/routes/runs.ts`

- [ ] **Step 1: Add `provider` and `issue_ref` query params to `GET /runs`**

```typescript
  app.get("/runs", { preHandler: requireAuth() }, async (req, reply) => {
    const q = req.query as {
      flow_id?: string; status?: string; limit?: string;
      scope?: string; provider?: string; issue_ref?: string;
    };
    // ... existing actor/scope checks ...

    const runs = await c.runs.list({
      flowId: q.flow_id,
      status: q.status as RunStatus | undefined,
      limit: q.limit ? Number(q.limit) : undefined,
      actor,
      scope,
      provider: q.provider,
      issueRef: q.issue_ref,
    });
    // ... rest unchanged
  });
```

- [ ] **Step 2: Add `provider` and `issueRef` to `IRunStore.list` options and `PostgresRunStore.list`**

In `packages/core/src/interfaces/run-store.interface.ts`, find the list options type and add:

```typescript
    provider?: string;
    issueRef?: string;
```

In `packages/orchestrator/src/stores/postgres/postgres-run-store.ts`, update the `list` method to join and filter:

```typescript
  async list(opts: { ...; provider?: string; issueRef?: string } = {}): Promise<Run[]> {
    const conds: string[] = [];
    const params: any[] = [];
    let i = 1;
    const nextIdx = () => i++;

    if (opts.flowId)   { conds.push(`r.flow_id = $${nextIdx()}`);   params.push(opts.flowId); }
    if (opts.status)   { conds.push(`r.status = $${nextIdx()}`);    params.push(opts.status); }
    if (opts.provider) { conds.push(`w.provider = $${nextIdx()}`);  params.push(opts.provider); }
    if (opts.issueRef) { conds.push(`w.issue_ref = $${nextIdx()}`); params.push(opts.issueRef); }

    // Add LEFT JOIN to jm_webhook_events when provider/issueRef filter is used
    const needsWebhookJoin = !!(opts.provider || opts.issueRef);
    const webhookJoin = needsWebhookJoin
      ? "LEFT JOIN jm_webhook_events w ON r.webhook_event_id = w.id"
      : "";

    // ... rest of existing grant join and WHERE/LIMIT logic unchanged ...
    const sql = `
      SELECT DISTINCT r.* FROM jm_runs r
      ${webhookJoin}
      ${joinClause}
      ${whereSql}
      ORDER BY r.started_at DESC NULLS LAST
      ${limitSql}
    `;
    // ...
  }
```

- [ ] **Step 3: Include `webhookEvent` in `GET /runs/:id` response**

In the `GET /runs/:id` handler (already partially done in webhook-tracking plan Task 8 Step 1), verify the `webhookEvent` object is included in the return. If the webhook-tracking plan has already added it, no change is needed here. Otherwise add:

```typescript
    const webhookEvent = run.webhookEventId
      ? await c.webhookEvents.getById(run.webhookEventId)
      : null;

    return {
      run: { ...run, effectiveRole },
      events: allEvents,
      executions,
      webhookEvent: webhookEvent ? {
        id: webhookEvent.id,
        provider: webhookEvent.provider,
        eventType: webhookEvent.eventType,
        issueRef: webhookEvent.issueRef,
        deliveryId: webhookEvent.deliveryId,
        receivedAt: webhookEvent.receivedAt.toISOString(),
        rawPayload: webhookEvent.rawPayload,
      } : null,
    };
```

---

### Task 9: Typecheck

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 2: Verify `ProviderBadge` is exported**

```bash
grep "ProviderBadge" packages/runs-list/src/index.ts
```

Expected: one line with the export.

- [ ] **Step 3: Verify `buildIssueRef` is imported in `RunsListPage`**

```bash
grep "buildIssueRef" packages/web/src/routes/RunsListPage.tsx
```

Expected: one import line.
