# Ticket Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `"ticket"` connection category (Jira, Linear, Monday) with a lightweight test-connection call that verifies the credential and returns the authenticated user's display name.

**Architecture:** One-liner type extension in `@journeyman/core`, an inline `testTicketConnection()` helper added to the API connections route (mirrors existing `gitProviderFor()` pattern), and form updates in `ConnectionsPage.tsx` for provider-specific fields.

**Tech Stack:** TypeScript, React, Fastify, Node `fetch`

---

## File Map

| Action | File | What changes |
|--------|------|--------------|
| Modify | `packages/core/src/types/connection.types.ts` | Add `"ticket"` to `ConnectionCategory` union |
| Modify | `packages/api-server/src/routes/connections.ts` | Add `testTicketConnection()` helper; update test handler and repos guard |
| Modify | `packages/web/src/routes/ConnectionsPage.tsx` | Add ticket category label, ticket providers, Jira-specific form fields |

---

## Task 1: Extend `ConnectionCategory` in core

**Files:**
- Modify: `packages/core/src/types/connection.types.ts:1`

- [ ] **Step 1: Open the file and update the type**

  Replace line 1:
  ```ts
  // before
  export type ConnectionCategory = "git" | "notification";

  // after
  export type ConnectionCategory = "git" | "notification" | "ticket";
  ```

  Full file after change:
  ```ts
  export type ConnectionCategory = "git" | "notification" | "ticket";

  /**
   * A reusable, encrypted credential + config for an external service, classified
   * by category. Git connections power agent repositories; notification connections
   * power agent notifications (delivery lands in a later phase).
   */
  export interface Connection {
    id: string;
    workspaceId: string;
    orgId: string;
    category: ConnectionCategory;
    provider: string; // git: "github" | "gitlab" ; notification: "slack" | "console"
    label: string;
    /** git self-hosted instance URL / slack workspace; defaults applied per provider. */
    baseUrl?: string;
    /** Provider-specific config (e.g. slack method: "token" | "webhook"). The
     *  credential is encrypted at rest and never returned on this object. */
    config?: Record<string, unknown>;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
  }

  export type ConnectionCreateInput = Pick<Connection, "category" | "provider" | "label"> &
    Partial<Pick<Connection, "baseUrl" | "config">> & {
      /** Raw credential value; stored encrypted in the vault, referenced by secretRef. */
      credential: string;
    };

  export type ConnectionUpdateInput = Partial<Pick<Connection, "label" | "baseUrl" | "config">> & {
    /** When present, rotates the stored credential. */
    credential?: string;
  };
  ```

---

## Task 2: Add `testTicketConnection` helper and update route

**Files:**
- Modify: `packages/api-server/src/routes/connections.ts`

- [ ] **Step 1: Add the `testTicketConnection` helper function**

  Insert this function directly before `export function registerConnectionRoutes(...)` (after the existing `gitProviderFor` function):

  ```ts
  async function testTicketConnection(
    provider: string,
    token: string,
    baseUrl?: string,
    config?: Record<string, unknown>,
  ): Promise<{ ok: boolean; note?: string; error?: string }> {
    if (provider === "jira") {
      const email = config?.email as string | undefined;
      if (!email || !baseUrl) return { ok: false, error: "Jira requires host and email" };
      const encoded = Buffer.from(`${email}:${token}`).toString("base64");
      const r = await fetch(`https://${baseUrl}/rest/api/3/myself`, {
        headers: { Authorization: `Basic ${encoded}`, Accept: "application/json" },
      });
      if (!r.ok) return { ok: false, error: `Jira returned ${r.status}` };
      const data = await r.json() as { displayName?: string };
      return { ok: true, note: `Connected as ${data.displayName ?? "unknown"}` };
    }
    if (provider === "linear") {
      const r = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "{ viewer { name } }" }),
      });
      if (!r.ok) return { ok: false, error: `Linear returned ${r.status}` };
      const data = await r.json() as { data?: { viewer?: { name?: string } } };
      return { ok: true, note: `Connected as ${data.data?.viewer?.name ?? "unknown"}` };
    }
    if (provider === "monday") {
      const r = await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "{ me { name } }" }),
      });
      if (!r.ok) return { ok: false, error: `Monday returned ${r.status}` };
      const data = await r.json() as { data?: { me?: { name?: string } } };
      return { ok: true, note: `Connected as ${data.data?.me?.name ?? "unknown"}` };
    }
    return { ok: false, error: `unknown ticket provider: ${provider}` };
  }
  ```

- [ ] **Step 2: Update the test route handler (line 126–140)**

  The current handler uses `if (conn.category !== "git")` as a catch-all for non-git categories. Replace the entire `app.post("/workspaces/:wsId/connections/:id/test", ...)` handler with:

  ```ts
  app.post("/workspaces/:wsId/connections/:id/test", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const conn = await loadConn(id, wsId);
    if (!conn) { reply.code(404); return { error: "not_found" }; }
    if (conn.category === "notification") {
      return { ok: true, note: "Notification delivery is verified in a later phase." };
    }
    const sealed = await getConnectionSealed(pool, id);
    if (!sealed) { reply.code(404); return { error: "not_found" }; }
    if (conn.category === "ticket") {
      return testTicketConnection(conn.provider, open(sealed), conn.baseUrl, conn.config);
    }
    // git
    const git = gitProviderFor(conn.provider, open(sealed), conn.baseUrl);
    if (!git.listRepos) return { ok: false, error: "provider does not support repo listing" };
    const res = await git.listRepos({ limit: 100 });
    if (res.error) return { ok: false, error: res.error };
    return { ok: true, repoCount: res.repos.length };
  });
  ```

- [ ] **Step 3: Fix the repos guard (line 145)**

  The `/repos` handler currently guards with `conn.category !== "git"`. That's still correct — ticket connections don't have a repos endpoint. No change needed here; verify the guard reads:

  ```ts
  if (!conn || conn.category !== "git") { reply.code(404); return { error: "not_found" }; }
  ```

---

## Task 3: Update `ConnectionsPage.tsx`

**Files:**
- Modify: `packages/web/src/routes/ConnectionsPage.tsx`

- [ ] **Step 1: Add `"ticket"` to `CATEGORY_LABELS` (line 12–15)**

  ```ts
  const CATEGORY_LABELS: Record<ConnectionCategory, string> = {
    git: "🌿 Git",
    notification: "🔔 Notification",
    ticket: "🎫 Ticket",
  };
  ```

- [ ] **Step 2: Replace the `AddConnectionModal` function entirely**

  The current modal (lines 125–201) needs: a new `email` state field, updated `onSelectCategory`, a `handleCreate` that injects `config.email` for Jira, a ticket option in the Type dropdown, ticket providers in the Provider dropdown, Jira-specific Host + Email fields, and a smarter `disabled` check.

  Replace the entire `AddConnectionModal` function with:

  ```tsx
  function AddConnectionModal({
    onCancel,
    onCreate,
  }: {
    onCancel: () => void;
    onCreate: (body: CreateConnectionInput) => void;
  }) {
    const [category, setCategory] = useState<ConnectionCategory>("git");
    const [provider, setProvider] = useState("github");
    const [label, setLabel] = useState("");
    const [baseUrl, setBaseUrl] = useState("");
    const [credential, setCredential] = useState("");
    const [email, setEmail] = useState("");

    const onSelectCategory = (next: ConnectionCategory) => {
      setCategory(next);
      if (next === "git") setProvider("github");
      else if (next === "notification") setProvider("slack");
      else setProvider("jira");
      setBaseUrl("");
      setEmail("");
    };

    const handleCreate = () => {
      const config: Record<string, unknown> = {};
      if (category === "ticket" && provider === "jira") config.email = email;
      onCreate({
        category,
        provider,
        label: label.trim(),
        baseUrl: baseUrl || undefined,
        credential,
        config: Object.keys(config).length > 0 ? config : undefined,
      });
    };

    const credentialLabel = category === "git" ? "Access token (PAT)" : "API token";

    const isDisabled =
      !label.trim() ||
      !credential ||
      (category === "ticket" && provider === "jira" && (!baseUrl.trim() || !email.trim()));

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6" onClick={onCancel}>
        <div className={`${card} w-full max-w-md max-h-[90vh] overflow-y-auto p-6 space-y-4`} onClick={(e) => e.stopPropagation()}>
          <h2 className="text-lg font-semibold">New connection</h2>

          <div>
            <label className="text-sm font-medium">Type</label>
            <select className={`${selectCls} block mt-1 w-full`} value={category} onChange={(e) => onSelectCategory(e.target.value as ConnectionCategory)}>
              <option value="git">🌿 Git account</option>
              <option value="notification">🔔 Notification channel</option>
              <option value="ticket">🎫 Ticket tracker</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium">Provider</label>
            <select className={`${selectCls} block mt-1 w-full`} value={provider} onChange={(e) => setProvider(e.target.value)}>
              {category === "git" ? (
                GIT_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)
              ) : category === "ticket" ? (
                <>
                  <option value="jira">Jira</option>
                  <option value="linear">Linear</option>
                  <option value="monday">Monday.com</option>
                </>
              ) : (
                <>
                  <option value="slack">Slack</option>
                  <option value="console">Console</option>
                </>
              )}
            </select>
          </div>

          {category === "git" && provider === "gitlab" && (
            <div>
              <label className="text-sm font-medium">Instance URL</label>
              <input className={inputCls} placeholder="https://gitlab.acme.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </div>
          )}

          {category === "ticket" && provider === "jira" && (
            <>
              <div>
                <label className="text-sm font-medium">Host</label>
                <input className={inputCls} placeholder="acme.atlassian.net" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium">Email</label>
                <input className={inputCls} type="email" placeholder="you@acme.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </>
          )}

          <div>
            <label className="text-sm font-medium">Label</label>
            <input className={inputCls} placeholder="e.g. acme (work)" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>

          <div>
            <label className="text-sm font-medium">{credentialLabel}</label>
            <input className={inputCls} type="password" value={credential} onChange={(e) => setCredential(e.target.value)} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button className={btnGhost} onClick={onCancel}>Cancel</button>
            <button
              className={btnPrimary}
              disabled={isDisabled}
              onClick={handleCreate}
            >
              Connect
            </button>
          </div>
        </div>
      </div>
    );
  }
  ```

---

## Task 4: Typecheck

- [ ] **Step 1: Run typecheck across the monorepo**

  ```bash
  npm run typecheck
  ```

  Expected: no errors. The `Record<ConnectionCategory, string>` in `CATEGORY_LABELS` will fail if `"ticket"` was not added in Task 3 Step 1 — that's a good compile-time guard confirming the wiring is complete.
