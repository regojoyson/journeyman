# Add-member dialog & Danger Zone restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Members tab's always-visible inline add form (which fetches all org users on mount) with an "Add member" button that opens a searchable, lazy-loaded dialog, and restyle the Settings Danger Zone delete into a clear outlined→filled red treatment.

**Architecture:** Frontend-only change in `packages/web`. A new `AddMemberDialog` component fetches org users on open and filters them via a pure, unit-tested helper. The members panel keeps its existing table styling and only loses the upfront org-user fetch + inline form, gaining a button + dialog. Two new danger button variants are added to the shared `admin-styles.ts`.

**Tech Stack:** React + react-router v6 + Tailwind (shadcn token classes); Vitest for the pure helper.

**Plan-specific constraints (from the requester):**
- Work directly on the `master` branch.
- **No commits** — leave all changes in the working tree.
- **No per-task commit/typecheck steps.** One typecheck + test pass at the very end (Task 6). The only mid-plan test run is the TDD cycle for the pure helper (Task 1).

**Styling note:** Use the shared helpers in `packages/web/src/routes/admin-styles.ts` and shadcn token classes (`text-foreground`, `text-muted-foreground`, `bg-card`, `text-destructive`, `bg-destructive`, `border`, `bg-accent`). Match the existing modal idiom (`fixed inset-0 … bg-black/60`, inner `card`) used by the former `OrgWorkspacesPage` delete modal. The members table keeps its current classes — do not restyle it.

---

## File structure

- Create: `packages/web/src/components/add-member-utils.ts` — pure `filterAddableUsers()` helper.
- Create: `packages/web/src/components/add-member-utils.test.ts` — Vitest unit tests.
- Modify: `packages/web/src/routes/admin-styles.ts` — add `btnDangerOutline` + `btnDangerSolid`.
- Create: `packages/web/src/components/AddMemberDialog.tsx` — searchable, lazy-loaded add dialog.
- Modify: `packages/web/src/components/WorkspaceMembersPanel.tsx` — drop upfront fetch + inline form; add button + dialog.
- Modify: `packages/web/src/routes/workspace-detail/SettingsTab.tsx` — restyle Danger Zone.

---

## Task 1: Pure helper `filterAddableUsers` (TDD)

**Files:**
- Create: `packages/web/src/components/add-member-utils.ts`
- Test: `packages/web/src/components/add-member-utils.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/add-member-utils.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filterAddableUsers } from "./add-member-utils.ts";

const users = [
  { id: "u1", username: "dana", displayName: "Dana Kim", status: "active" },
  { id: "u2", username: "raj", displayName: null, status: "active" },
  { id: "u3", username: "dario", displayName: "Dario Penn", status: "active" },
];

describe("filterAddableUsers", () => {
  it("excludes ids in the excluded set", () => {
    const r = filterAddableUsers(users, new Set(["u1"]), "");
    expect(r.map((u) => u.id)).toEqual(["u2", "u3"]);
  });
  it("filters by username case-insensitively", () => {
    const r = filterAddableUsers(users, new Set(), "DA");
    expect(r.map((u) => u.id)).toEqual(["u1", "u3"]);
  });
  it("filters by displayName", () => {
    const r = filterAddableUsers(users, new Set(), "penn");
    expect(r.map((u) => u.id)).toEqual(["u3"]);
  });
  it("returns all non-excluded when query is blank/whitespace", () => {
    expect(filterAddableUsers(users, new Set(), "  ")).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/web -- add-member-utils`
Expected: FAIL — cannot resolve `./add-member-utils.ts` / `filterAddableUsers` is not a function.

- [ ] **Step 3: Write minimal implementation**

Create `packages/web/src/components/add-member-utils.ts`:

```ts
import type { OrgUser } from "../api/workspaces.ts";

/** Org users not in `excludedIds`, optionally narrowed by a case-insensitive
 *  substring match on username or display name. */
export function filterAddableUsers(
  users: OrgUser[],
  excludedIds: Set<string>,
  query: string,
): OrgUser[] {
  const q = query.trim().toLowerCase();
  return users.filter((u) => {
    if (excludedIds.has(u.id)) return false;
    if (!q) return true;
    return `${u.username} ${u.displayName ?? ""}`.toLowerCase().includes(q);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/web -- add-member-utils`
Expected: PASS (4 tests).

---

## Task 2: Danger button variants in `admin-styles.ts`

**Files:**
- Modify: `packages/web/src/routes/admin-styles.ts`

- [ ] **Step 1: Add the two variants**

Append after the existing `btnDanger` export (keep `btnDanger` — the members table "Remove" link still uses it):

```ts
export const btnDangerOutline =
  "rounded-md border border-destructive text-destructive hover:bg-destructive/10 " +
  "disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium transition";

export const btnDangerSolid =
  "rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 " +
  "disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium transition";
```

---

## Task 3: `AddMemberDialog` component

**Files:**
- Create: `packages/web/src/components/AddMemberDialog.tsx`

- [ ] **Step 1: Create the dialog**

Create `packages/web/src/components/AddMemberDialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { WorkspaceRole } from "@journeyman/core";
import { listOrgUsers, workspaceAdminApi, type OrgUser } from "../api/workspaces.ts";
import { filterAddableUsers } from "./add-member-utils.ts";
import { btnGhost, btnPrimary, card, inputCls, selectCls } from "../routes/admin-styles.ts";

const ROLES: WorkspaceRole[] = ["maintainer", "contributor", "observer"];

function initials(u: OrgUser): string {
  const s = (u.displayName || u.username).trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AddMemberDialog({
  orgId,
  wsId,
  existingMemberIds,
  onAdded,
  onClose,
}: {
  orgId: string;
  wsId: string;
  existingMemberIds: string[];
  onAdded: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("contributor");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listOrgUsers(orgId)
      .then((u) => { if (active) setOrgUsers(u); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "Failed to load users."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [orgId]);

  const excluded = new Set<string>([...existingMemberIds, ...addedIds]);
  const addable = filterAddableUsers(orgUsers, excluded, query);

  async function add() {
    if (!selectedUserId) return;
    setBusy(true);
    setError(null);
    try {
      await workspaceAdminApi.addMember(wsId, { userId: selectedUserId, role });
      setAddedIds((prev) => [...prev, selectedUserId]);
      setSelectedUserId("");
      await onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add member.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div className={`${card} w-full max-w-md p-0 overflow-hidden`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="text-base font-medium text-foreground">Add member</h3>
          <button onClick={onClose} className={btnGhost} aria-label="Close">✕</button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <input
            className={inputCls}
            placeholder="Search org users…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />

          <div className="border rounded-md max-h-52 overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
            ) : error && orgUsers.length === 0 ? (
              <div className="p-6 text-center text-sm text-destructive">{error}</div>
            ) : addable.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {orgUsers.length === 0
                  ? "No org users found."
                  : query.trim()
                    ? "No users match."
                    : "All org users are already members."}
              </div>
            ) : (
              addable.map((u) => {
                const selected = u.id === selectedUserId;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setSelectedUserId(u.id)}
                    className={
                      "w-full flex items-center gap-3 px-3 py-2.5 text-left border-b last:border-b-0 transition " +
                      (selected ? "bg-accent" : "hover:bg-accent/50")
                    }
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                      {initials(u)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-foreground truncate">{u.username}</span>
                      {u.displayName && (
                        <span className="block text-xs text-muted-foreground truncate">{u.displayName}</span>
                      )}
                    </span>
                    {selected && <span className="text-primary" aria-hidden>✓</span>}
                  </button>
                );
              })
            )}
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as WorkspaceRole)} className={`${selectCls} w-full`}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {error && orgUsers.length > 0 && <div className="text-sm text-destructive">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t">
          <button onClick={onClose} disabled={busy} className={btnGhost}>Cancel</button>
          <button onClick={add} disabled={busy || !selectedUserId} className={btnPrimary}>
            {busy ? "Adding…" : "Add to workspace"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## Task 4: Rewire `WorkspaceMembersPanel`

**Files:**
- Modify: `packages/web/src/components/WorkspaceMembersPanel.tsx`

Replace the entire file contents (drops the org-user fetch, the `addUserId`/`addRole`/`orgUsers` state, the `add()` handler, and the "Add a member" section; adds `addOpen` state, a header button, and the dialog). The members table markup is unchanged from the current version.

- [ ] **Step 1: Replace the file**

Overwrite `packages/web/src/components/WorkspaceMembersPanel.tsx` with:

```tsx
import { useCallback, useEffect, useState } from "react";
import type { WorkspaceRole } from "@journeyman/core";
import { workspaceAdminApi, type WorkspaceMember } from "../api/workspaces.ts";
import { AddMemberDialog } from "./AddMemberDialog.tsx";
import { btnDanger, btnPrimary, card, selectCls } from "../routes/admin-styles.ts";

const ROLES: WorkspaceRole[] = ["maintainer", "contributor", "observer"];

export function WorkspaceMembersPanel({ orgId, wsId }: { orgId: string; wsId: string }) {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMembers(await workspaceAdminApi.listMembers(wsId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load members.");
    } finally {
      setLoading(false);
    }
  }, [wsId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function setRole(userId: string, role: WorkspaceRole) {
    setError(null);
    try {
      await workspaceAdminApi.setMemberRole(wsId, userId, role);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update role.");
    }
  }

  async function remove(userId: string, username: string) {
    if (!confirm(`Remove ${username} from this workspace?`)) return;
    setError(null);
    try {
      await workspaceAdminApi.removeMember(wsId, userId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove member.");
    }
  }

  return (
    <section className={`${card} overflow-hidden`}>
      <div className="px-6 py-4 border-b flex items-center justify-between">
        <h2 className="text-base font-medium text-foreground">
          Members <span className="text-muted-foreground font-normal">({members.length})</span>
        </h2>
        <button onClick={() => setAddOpen(true)} className={btnPrimary}>+ Add member</button>
      </div>

      {error && <div className="px-6 py-3 text-sm text-destructive border-b">{error}</div>}

      {loading ? (
        <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : members.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground">No members yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-medium px-6 py-3">Username</th>
              <th className="text-left font-medium px-6 py-3">Role</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody className="border-t">
            {members.map((m) => (
              <tr key={m.userId} className="border-b last:border-b-0 hover:bg-accent/40">
                <td className="px-6 py-3">
                  <div className="text-foreground font-medium">{m.username}</div>
                  {m.displayName && <div className="text-xs text-muted-foreground">{m.displayName}</div>}
                </td>
                <td className="px-6 py-3">
                  <select value={m.role} onChange={(e) => setRole(m.userId, e.target.value as WorkspaceRole)} className={selectCls}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-6 py-3">
                  <div className="flex justify-end">
                    <button onClick={() => remove(m.userId, m.username)} className={btnDanger}>Remove</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {addOpen && (
        <AddMemberDialog
          orgId={orgId}
          wsId={wsId}
          existingMemberIds={members.map((m) => m.userId)}
          onAdded={refresh}
          onClose={() => setAddOpen(false)}
        />
      )}
    </section>
  );
}
```

> Note: this version uses shadcn token classes (`text-foreground`, `text-muted-foreground`, `border`, `bg-accent`) instead of the previous `slate-*`/`surface-hover` classes, aligning the panel with the theme migration the rest of `admin-styles.ts` already follows. Visual result is equivalent in the current theme.

---

## Task 5: Restyle the Danger Zone in `SettingsTab`

**Files:**
- Modify: `packages/web/src/routes/workspace-detail/SettingsTab.tsx`

- [ ] **Step 1: Update the imports**

Change the `admin-styles` import line from:

```tsx
import { btnDanger, btnGhost, btnPrimary, card, codePill, inputCls } from "../admin-styles.ts";
```

to:

```tsx
import { btnDangerOutline, btnDangerSolid, btnGhost, btnPrimary, card, codePill, inputCls } from "../admin-styles.ts";
```

- [ ] **Step 2: Replace the Danger Zone `<section>`**

Replace the entire Danger Zone `<section>` (the one currently `className={`${card} p-6 border border-red-900/50`}`) with:

```tsx
      <section className={`${card} p-0 overflow-hidden border-destructive/50`}>
        {!confirming ? (
          <div className="flex items-center justify-between gap-4 p-6">
            <div>
              <h2 className="text-sm font-medium text-destructive">Delete this workspace</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Permanently removes all flows, agents, secrets, connections, MCPs, skills, custom steps,
                and webhooks. This cannot be undone.
              </p>
            </div>
            <button
              onClick={() => { setConfirming(true); setConfirmName(""); setError(null); }}
              disabled={isDefault}
              title={isDefault ? "The default workspace can't be deleted." : undefined}
              className={`shrink-0 ${btnDangerOutline}${isDefault ? " opacity-50 cursor-not-allowed" : ""}`}
            >
              Delete workspace
            </button>
          </div>
        ) : (
          <div className="p-6">
            <h2 className="text-sm font-medium text-destructive mb-1">Delete this workspace</h2>
            <p className="text-sm text-muted-foreground mb-3">
              Type <span className={codePill}>{workspace.name}</span> to confirm.
            </p>
            <input
              className={inputCls}
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={workspace.name}
              autoFocus
            />
            {error && <div className="mt-3 text-sm text-destructive">{error}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} disabled={busy} className={btnGhost}>Cancel</button>
              <button
                onClick={confirmDelete}
                disabled={busy || confirmName !== workspace.name}
                className={`${btnDangerSolid}${busy || confirmName !== workspace.name ? " opacity-50 cursor-not-allowed" : ""}`}
              >
                {busy ? "Deleting…" : "Delete workspace"}
              </button>
            </div>
          </div>
        )}
      </section>
```

This keeps the existing `confirming` / `confirmName` / `busy` state and the `confirmDelete()` function unchanged — only the markup/classes change.

---

## Task 6: Final verification — typecheck + tests

- [ ] **Step 1: Typecheck the web package**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS (no type errors). The only pre-existing errors, if any, come from the separate header/sidebar-redesign WIP in the working tree — confirm none reference the files touched here (`AddMemberDialog.tsx`, `add-member-utils.ts`, `WorkspaceMembersPanel.tsx`, `SettingsTab.tsx`, `admin-styles.ts`).

- [ ] **Step 2: Run the web unit tests**

Run: `npm test -w @journeyman/web -- add-member-utils`
Expected: PASS (4 tests from Task 1).

- [ ] **Step 3: Leave changes uncommitted**

Per the requester's instruction, do **not** commit. Run `git status` and confirm the expected created/modified files are present in the working tree.

> After this lands, the API server need not restart (no backend change), but the user should hard-reload the browser so Vite serves the new bundle.

---

## Self-review notes (against the spec)

- **Lazy load org users** → Task 4 removes the mount-time `listOrgUsers`; Task 3 fetches on dialog open. ✓
- **"Add member" button opens dialog** → Task 4 header button + `addOpen`; Task 3 dialog. ✓
- **Searchable single-select picker + role + add** → Task 3 (`filterAddableUsers`, `selectedUserId`, role select, `add()`). ✓
- **Dialog stays open after add; added user drops off** → Task 3 `addedIds` + clear `selectedUserId`. ✓
- **Empty/loading/error states** → Task 3 (loading, error-with-empty, "all members"/"no match"/"no users"). ✓
- **Danger Zone restyle: outlined → filled red, type-name confirm, default disabled** → Tasks 2 + 5. ✓
- **No backend changes** → no API/identity tasks. ✓
- **Type consistency:** `filterAddableUsers(users: OrgUser[], excludedIds: Set<string>, query: string)` defined in Task 1 and called identically in Task 3; `AddMemberDialog` prop names match between Task 3 (definition) and Task 4 (usage); `btnDangerOutline`/`btnDangerSolid` defined in Task 2, imported in Task 5. ✓
