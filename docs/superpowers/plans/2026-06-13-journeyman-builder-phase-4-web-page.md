# Journeyman Builder — Phase 4: The Web Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working Builder page in `@journeyman/web`: a split view with chat on the left (streams the assistant's replies and the proposed plan) and a live plan-preview pane on the right (summary, steps, gaps), plus an **Apply** button that creates the draft workflow.

**Architecture:** A new `api/builder.ts` client module (session CRUD + apply via the `api()` helper, and a **fetch+ReadableStream** SSE consumer because the chat endpoint is a POST). Pure, testable helpers (`parseSseBuffer`, a chat-state reducer, an apply-gate). A `BuilderPage` route component wiring them with `useState`/`useEffect` + a React Query mutation for apply, styled with the repo's Tailwind classes.

**Tech Stack:** Vite + React 19, react-router v7, TanStack Query v5, Tailwind v4, Vitest. Cookie auth (`credentials: "include"`).

**Constraints (from the user):** **No `git commit` steps.** **Final step is `npm run check`.** Each task ends by running its tests; the page is verified by typecheck + the browser preview.

**Reference:** Spec `docs/superpowers/specs/2026-06-13-journeyman-builder-design.md` ("The page"). Consumes Phase 1 session routes, Phase 3a apply route, Phase 3b SSE chat route.

**Verified web patterns:**
- Routes in `packages/web/src/App.tsx` under `<AppShell />`; named-export page components; dev server `npm run dev -w @journeyman/web` on **:5173**, proxying `/api` → :4000.
- `api()` wrapper in `src/api/client.ts` (cookie auth, JSON, `ApiError`); per-resource modules in `src/api/`.
- SSE today uses `EventSource` (GET only). **Our chat route is POST → use `fetch` + `res.body.getReader()` + manual SSE frame parsing.**
- Styling: Tailwind classes inline + shared strings in `src/routes/admin-styles.ts` (`btnPrimary`, `card`, `inputCls`).
- Tests: **no jsdom/testing-library** — TDD pure `.test.ts`; verify UI via preview.
- Auth/org: `useAuth()` → `{ activeOrgId, ... }`.

**Out of scope (→ Phase 4b):** inline-editable step cards, the ⇄ inputs/outputs popover, per-step gap-fix flows, the sessions sidebar/history. Phase 4 shows a read-only preview + Apply.

---

## File Structure (Phase 4)

**Create:**
- `packages/web/src/api/sse-parse.ts` — `parseSseBuffer` (pure SSE frame parser)
- `packages/web/src/api/sse-parse.test.ts`
- `packages/web/src/api/builder.ts` — session CRUD, apply, `streamBuilderChat`
- `packages/web/src/routes/builder-state.ts` — pure chat-state reducer + `canApply`
- `packages/web/src/routes/builder-state.test.ts`
- `packages/web/src/routes/BuilderPage.tsx` — the page

**Modify:**
- `packages/web/src/App.tsx` — add the `/builder` route
- `packages/web/src/components/Sidebar.tsx` — add a nav link

---

## Task 1: SSE-over-fetch parser + API module

**Files:**
- Create: `packages/web/src/api/sse-parse.ts`, `…/sse-parse.test.ts`, `packages/web/src/api/builder.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/api/sse-parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSseBuffer } from "./sse-parse.ts";

describe("parseSseBuffer", () => {
  it("parses complete frames and returns the incomplete tail as rest", () => {
    const buf = "event: assistant\ndata: {\"message\":\"hi\"}\n\nevent: plan\ndata: {\"summary\":\"x\"}\n\nevent: don";
    const { events, rest } = parseSseBuffer(buf);
    expect(events).toEqual([
      { event: "assistant", data: '{"message":"hi"}' },
      { event: "plan", data: '{"summary":"x"}' },
    ]);
    expect(rest).toBe("event: don");
  });

  it("ignores comment/ping frames (no data line)", () => {
    const { events, rest } = parseSseBuffer(": ping\n\n");
    expect(events).toEqual([]);
    expect(rest).toBe("");
  });

  it("defaults the event name to 'message' when only data is present", () => {
    const { events } = parseSseBuffer("data: hello\n\n");
    expect(events).toEqual([{ event: "message", data: "hello" }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/web/src/api/sse-parse.test.ts`
Expected: FAIL — cannot resolve `./sse-parse.ts`.

- [ ] **Step 3: Create `packages/web/src/api/sse-parse.ts`**

```ts
export interface SseEvent { event: string; data: string; }

function parseFrame(frame: string): SseEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
    // ignore "id:" and comment lines (": ...")
  }
  if (dataLines.length === 0) return null; // comment/ping frame
  return { event, data: dataLines.join("\n") };
}

/** Split an SSE byte-buffer into complete events; return the trailing partial frame as `rest`. */
export function parseSseBuffer(buf: string): { events: SseEvent[]; rest: string } {
  const parts = buf.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: SseEvent[] = [];
  for (const p of parts) {
    const ev = parseFrame(p);
    if (ev) events.push(ev);
  }
  return { events, rest };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/web/src/api/sse-parse.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create `packages/web/src/api/builder.ts`**

```ts
import type { BuildPlan } from "@journeyman/core";
import { api, ApiError } from "./client.ts";
import { parseSseBuffer, type SseEvent } from "./sse-parse.ts";

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

export interface BuilderSession {
  id: string;
  name: string;
  status: "active" | "applied" | "archived";
  messages: { role: "user" | "assistant"; content: string }[];
  buildPlan: BuildPlan | null;
  appliedFlowId: string | null;
}

export async function createBuilderSession(orgId: string, name: string): Promise<BuilderSession> {
  return api<BuilderSession>(`/api/orgs/${orgId}/users/me/builder/sessions`, {
    method: "POST", body: JSON.stringify({ name }),
  });
}

export async function getBuilderSession(orgId: string, id: string): Promise<BuilderSession> {
  return api<BuilderSession>(`/api/orgs/${orgId}/users/me/builder/sessions/${id}`);
}

export async function applyBuilderPlan(orgId: string, id: string): Promise<{ workflowId: string; versionId: string }> {
  return api<{ workflowId: string; versionId: string }>(
    `/api/orgs/${orgId}/users/me/builder/sessions/${id}/apply`,
    { method: "POST", body: "{}" },
  );
}

/**
 * Stream a chat turn. The endpoint is a POST SSE, so we read the response body
 * as a stream (EventSource can't POST). Calls `onEvent` per parsed SSE event.
 */
export async function streamBuilderChat(args: {
  orgId: string;
  sessionId: string;
  message: string;
  onEvent: (ev: SseEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const res = await fetch(
    `${baseUrl}/api/orgs/${args.orgId}/users/me/builder/sessions/${args.sessionId}/messages`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: args.message }),
      signal: args.signal,
    },
  );
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseBuffer(buf);
    buf = rest;
    for (const ev of events) args.onEvent(ev);
  }
}
```

---

## Task 2: Pure chat-state reducer + apply-gate

**Files:**
- Create: `packages/web/src/routes/builder-state.ts`, `…/builder-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/routes/builder-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { reduceChatEvent, canApply, type BuilderChatState } from "./builder-state.ts";
import type { SseEvent } from "../api/sse-parse.ts";

const empty: BuilderChatState = { messages: [], plan: null, error: null, streaming: true };

describe("reduceChatEvent", () => {
  it("appends an assistant message", () => {
    const ev: SseEvent = { event: "assistant", data: JSON.stringify({ message: "Which repo?" }) };
    const next = reduceChatEvent(empty, ev);
    expect(next.messages.at(-1)).toEqual({ role: "assistant", content: "Which repo?" });
  });
  it("sets the plan on a plan event", () => {
    const plan = { summary: "s", gaps: [], newCustomSteps: [], stepBindings: [], workflow: { schemaVersion: 2, nodes: [], edges: [] }, defaults: { sandboxId: null, model: null } };
    const next = reduceChatEvent(empty, { event: "plan", data: JSON.stringify(plan) });
    expect(next.plan?.summary).toBe("s");
  });
  it("stops streaming on done", () => {
    expect(reduceChatEvent(empty, { event: "done", data: "{}" }).streaming).toBe(false);
  });
  it("captures an error", () => {
    const next = reduceChatEvent(empty, { event: "error", data: JSON.stringify({ message: "boom" }) });
    expect(next.error).toBe("boom");
    expect(next.streaming).toBe(false);
  });
});

describe("canApply", () => {
  const base = { summary: "s", newCustomSteps: [], stepBindings: [], workflow: { schemaVersion: 2, nodes: [], edges: [] }, defaults: { sandboxId: null, model: null } };
  it("is false with no plan", () => { expect(canApply(null)).toBe(false); });
  it("is false when a required gap remains", () => {
    expect(canApply({ ...base, gaps: [{ id: "g", kind: "webhook", nodeIds: [], reason: "", required: true, fixHint: null }] } as never)).toBe(false);
  });
  it("is true with a plan and no required gaps", () => {
    expect(canApply({ ...base, gaps: [] } as never)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/web/src/routes/builder-state.test.ts`
Expected: FAIL — cannot resolve `./builder-state.ts`.

- [ ] **Step 3: Create `packages/web/src/routes/builder-state.ts`**

```ts
import type { BuildPlan } from "@journeyman/core";
import type { SseEvent } from "../api/sse-parse.ts";

export interface ChatMsg { role: "user" | "assistant"; content: string; }

export interface BuilderChatState {
  messages: ChatMsg[];
  plan: BuildPlan | null;
  error: string | null;
  streaming: boolean;
}

/** Fold one SSE event into the chat state. Pure. */
export function reduceChatEvent(state: BuilderChatState, ev: SseEvent): BuilderChatState {
  switch (ev.event) {
    case "assistant": {
      const { message } = safeJson(ev.data) as { message?: string };
      return { ...state, messages: [...state.messages, { role: "assistant", content: message ?? "" }] };
    }
    case "plan":
      return { ...state, plan: safeJson(ev.data) as BuildPlan };
    case "error":
      return { ...state, error: (safeJson(ev.data) as { message?: string }).message ?? "error", streaming: false };
    case "done":
      return { ...state, streaming: false };
    default:
      return state;
  }
}

/** Apply is allowed only with a plan and no remaining required gaps. */
export function canApply(plan: BuildPlan | null): boolean {
  if (!plan) return false;
  return !plan.gaps.some((g) => g.required);
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/web/src/routes/builder-state.test.ts`
Expected: PASS (7 tests).

---

## Task 3: The Builder page + route + nav

**Files:**
- Create: `packages/web/src/routes/BuilderPage.tsx`
- Modify: `packages/web/src/App.tsx`, `packages/web/src/components/Sidebar.tsx`

- [ ] **Step 1: Create `packages/web/src/routes/BuilderPage.tsx`**

```tsx
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext.tsx";
import {
  createBuilderSession, applyBuilderPlan, streamBuilderChat, type BuilderSession,
} from "../api/builder.ts";
import {
  reduceChatEvent, canApply, type BuilderChatState, type ChatMsg,
} from "./builder-state.ts";
import { btnPrimary, card, inputCls } from "./admin-styles.ts";

export function BuilderPage() {
  const { activeOrgId } = useAuth();
  const sessionRef = useRef<BuilderSession | null>(null);
  const [input, setInput] = useState("");
  const [state, setState] = useState<BuilderChatState>({ messages: [], plan: null, error: null, streaming: false });
  const [sending, setSending] = useState(false);
  const [appliedFlowId, setAppliedFlowId] = useState<string | null>(null);

  const applyM = useMutation({
    mutationFn: async () => {
      if (!activeOrgId || !sessionRef.current) throw new Error("no session");
      return applyBuilderPlan(activeOrgId, sessionRef.current.id);
    },
    onSuccess: (r) => setAppliedFlowId(r.workflowId),
  });

  async function send() {
    const message = input.trim();
    if (!message || !activeOrgId || sending) return;
    setInput("");
    setState((s) => ({ ...s, messages: [...s.messages, { role: "user", content: message } as ChatMsg], error: null, streaming: true }));
    setSending(true);
    try {
      if (!sessionRef.current) {
        sessionRef.current = await createBuilderSession(activeOrgId, message.slice(0, 60));
      }
      await streamBuilderChat({
        orgId: activeOrgId, sessionId: sessionRef.current.id, message,
        onEvent: (ev) => setState((s) => reduceChatEvent(s, ev)),
      });
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message, streaming: false }));
    } finally {
      setSending(false);
    }
  }

  const plan = state.plan;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] gap-4 p-4">
      {/* Chat */}
      <div className="flex w-2/5 flex-col">
        <h1 className="mb-3 text-lg font-medium text-slate-100">Builder</h1>
        <div className="flex-1 space-y-3 overflow-y-auto pr-2">
          {state.messages.map((m, i) => (
            <div key={i} className={m.role === "user"
              ? "ml-auto max-w-[85%] rounded-md bg-indigo-500/20 px-3 py-2 text-sm text-slate-100"
              : "mr-auto max-w-[85%] rounded-md bg-slate-800/70 px-3 py-2 text-sm text-slate-200"}>
              {m.content}
            </div>
          ))}
          {state.error && <div className="text-sm text-rose-300">Error: {state.error}</div>}
          {state.streaming && <div className="text-xs text-slate-500">…thinking</div>}
        </div>
        <div className="mt-3 flex gap-2">
          <input className={inputCls} placeholder="Describe the workflow you want…"
            value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void send(); }} disabled={sending} />
          <button className={btnPrimary} onClick={() => void send()} disabled={sending || !input.trim()}>Send</button>
        </div>
      </div>

      {/* Plan preview */}
      <div className={`w-3/5 overflow-y-auto p-4 ${card}`}>
        {!plan ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Describe a goal on the left and the plan will appear here.
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="font-medium text-slate-100">Plan preview</p>
              <p className="text-sm text-slate-300">{plan.summary}</p>
            </div>

            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Steps</p>
              <ol className="space-y-1">
                {plan.stepBindings.map((b) => (
                  <li key={b.nodeId} className="flex items-center gap-2 text-sm text-slate-200">
                    <span className="rounded bg-slate-800 px-1.5 text-xs text-slate-400">{b.stepKind}</span>
                    {b.nodeId}
                  </li>
                ))}
              </ol>
            </div>

            {plan.gaps.length > 0 && (
              <div className="rounded-md border border-amber-900/40 bg-amber-950/30 p-3">
                <p className="mb-1 text-sm font-medium text-amber-300">Gaps</p>
                <ul className="space-y-1 text-sm text-amber-200/90">
                  {plan.gaps.map((g) => (
                    <li key={g.id}>{g.required ? "⚠️ " : "• "}{g.reason}</li>
                  ))}
                </ul>
              </div>
            )}

            {appliedFlowId ? (
              <a className={btnPrimary} href={`/workflows/${appliedFlowId}/edit`}>Open the draft flow →</a>
            ) : (
              <button className={btnPrimary} disabled={!canApply(plan) || applyM.isPending}
                onClick={() => applyM.mutate()}>
                {applyM.isPending ? "Applying…" : "Apply"}
              </button>
            )}
            {applyM.isError && <p className="text-sm text-rose-300">{(applyM.error as Error).message}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
```

> If `useAuth` exposes the active org under a different name than `activeOrgId`, adjust the destructure (the exploration confirmed `useAuth()` returns `activeOrgId`). If `admin-styles.ts` lacks `inputCls`, use the local input class string already used by other forms.

- [ ] **Step 2: Add the route in `packages/web/src/App.tsx`**

Add the import at the top:
```tsx
import { BuilderPage } from "./routes/BuilderPage.tsx";
```
Add inside the `<Route element={<AppShell />}>` block:
```tsx
<Route path="/builder" element={<BuilderPage />} />
```

- [ ] **Step 3: Add a sidebar link in `packages/web/src/components/Sidebar.tsx`**

Mirror the existing nav-link entries (match their exact markup/classes); add a link to `/builder` labelled "Builder". If the sidebar maps over a links array, add `{ to: "/builder", label: "Builder" }` to it; otherwise copy an existing `<NavLink>`/`<Link>` and change `to`/label.

- [ ] **Step 4: Typecheck the web package**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS. Fix any field-name mismatches the typecheck reports (e.g. the `useAuth` org field, sidebar link shape) and re-run.

---

## Final: Typecheck the whole repo + verify in the browser (no commit)

- [ ] **Step 1: Full type + import-boundary check**

Run: `npm run check`
Expected: PASS — all workspaces typecheck; boundaries clean. **Do not commit.**

- [ ] **Step 2: Verify the page renders in the browser**

Start the web dev server and load `/builder`:
- `preview_start` the web dev server (`npm run dev -w @journeyman/web`, port 5173), navigate to `/builder`.
- `preview_snapshot` / `preview_screenshot` to confirm the split layout renders (chat input on the left, the "Describe a goal…" empty-state on the right) without console errors.

Honest limit: a *full* end-to-end run (streaming a real plan) needs the api-server running with a DB + the `BUILDER_LLM_*` key, and a logged-in session (cookie). Without the backend, the page renders but chat calls will fail/redirect to login. Verify what's observable (the shell renders, no crash); document the full-stack run for manual QA:
```
npm run infra:up && npm run migrate
BUILDER_LLM_PROVIDER=@ai-sdk/anthropic BUILDER_LLM_MODEL=… BUILDER_LLM_API_KEY=… npm run start:api-server
npm run dev:web   # log in, open /builder, send a goal
```

---

## Self-review checklist (run before handoff)

- **Spec coverage (Phase 4):** split-view chat + plan preview ✓; streaming consumption of `assistant`/`plan`/`done`/`error` events ✓ (POST-SSE via fetch); gaps shown + Apply gated on required gaps ✓; apply → draft flow link ✓. Editable cards / ⇄ popover / sessions history are Phase 4b.
- **No placeholders:** complete code in every step; commands + expected results on every run step.
- **Type consistency:** `BuilderChatState`/`SseEvent`/`BuildPlan` shared across the parser, reducer, api, and page; `canApply` mirrors the backend's `requiredGapsRemaining`.
- **POST-SSE correctness:** uses `fetch` + `res.body.getReader()` (EventSource can't POST); `parseSseBuffer` keeps the partial trailing frame as `rest` across chunks — unit-tested.
- **Verification honesty:** pure pieces are unit-tested; the page is typecheck- + preview-verified; full streaming needs the backend + key (documented).
- **No commit steps anywhere; final step is `npm run check` (+ a browser-preview check).** ✓
