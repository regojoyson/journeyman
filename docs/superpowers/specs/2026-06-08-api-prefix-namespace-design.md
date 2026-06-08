# `/api` Route Namespacing + Webhook Ingress — Design

**Date:** 2026-06-08
**Status:** Approved (design) — implementation plan pending

## Problem

The web UI (served by nginx) loads, but every workflow/instance call 404s with
`Unexpected token '<' … is not valid JSON` — the response is `index.html`.

Root cause: the backend API routes are **inconsistently namespaced**:

- Most routes are under `/api` (identity/auth, mcp, sandbox, secrets, steps, webhook
  management) — and the frontend calls them with `/api/...`.
- But **workflows / workflow-instances / grants / forms / triggers / human-tasks** are
  registered at **root** (`/workflows`, `/workflow-instances`, …), and the frontend calls
  them without `/api`.

nginx proxies only `/api/` to the api-server; everything else falls through to the SPA
fallback (`try_files … /index.html`). So the non-`/api` calls return HTML. And nginx
**can't** simply proxy `/workflows` to the backend, because `/workflows` and
`/workflow-instances` are also **SPA page routes** — they'd collide.

A second, related gap: the **inbound webhook receiver** `POST /webhooks/in/:tenantToken` is
at root and also isn't proxied, so the URL the app generates (`{host}/webhooks/in/<token>`,
[webhooks-management.ts:23](../../../packages/api-server/src/routes/webhooks-management.ts))
doesn't reach the backend through `:6080`.

## Decision

Namespace the frontend-facing root routes under `/api` (backend + frontend), and add a
dedicated nginx location for the public inbound webhook. The inbound webhook stays **outside**
`/api` (stable external URL).

## Security verification (encapsulation is safe)

Wrapping routes in a Fastify `{ prefix: "/api" }` register creates a new encapsulation
context. This does **not** affect auth, because auth is fully decoupled from app context:

- `requireAuth()` ([identity/src/middleware.ts](../../../packages/identity/src/middleware.ts))
  is a **per-route `preHandler`** attached to each route.
- It reads the token directly from `req.headers.cookie` / `authorization`, uses a **closured
  `pool`**, sets `req.runContext`, and returns 401/403 itself. No app decorators, hooks, or
  cookie plugin involved.
- Role checks (`opts.role === "admin"`) and in-handler ownership checks key off
  `req.runContext` + the row's org/user — never the URL path.
- Cookie scoping is unchanged: `jm_access` is `Path=/` (covers `/api/*`); `jm_refresh` is
  `Path=/api/auth/refresh` (already `/api`).

**Conclusion:** auth/role/ownership behavior is identical before and after; the prefix changes
only the URL. The wrap must be registered after `cors`/`sensible` (it is — those are at the
top of `buildServer`, and child contexts inherit parent plugins/handlers).

## Route classification (verified — each file is uniformly root or `/api`)

**Wrap under `/api` (6 registrars, all uniformly root):**
`registerWorkflowRoutes` (flows.ts), `registerWorkflowGrantsRoutes` (flow-grants.ts),
`registerWorkflowInstanceRoutes` (workflow-instances.ts), `registerHumanTaskRoutes`
(human-tasks.ts), `registerFormRoutes` (forms.ts), `registerWorkflowTriggersRoute`
(workflow-triggers.ts).

**Leave at root (intentionally NOT wrapped):**
- `health.ts` → `/healthz` (Docker healthcheck depends on it).
- `webhooks.ts` → `/webhooks/in/:tenantToken` (public external ingress; exposed via its own
  nginx location below).

**Already `/api` (no change):** `steps.ts`, `webhook-presets.ts`, `webhooks-management.ts`,
and the identity/secrets/mcp/sandbox/custom-steps/coding-models registrars.

## Changes

### Backend — `packages/api-server/src/server.ts`
Wrap the 6 registrars in a single prefixed scope:
```ts
await app.register(async (s) => {
  registerWorkflowRoutes(s, c);
  registerWorkflowGrantsRoutes(s, c);
  registerWorkflowInstanceRoutes(s, c);
  registerHumanTaskRoutes(s, c);
  registerFormRoutes(s, c);
  registerWorkflowTriggersRoute(s, c);
}, { prefix: "/api" });
```
`registerStepsRoutes`, `registerWebhookRoutes`, webhook management/preset, health, and the
identity-block registrations stay as-is.

### Frontend — `packages/web/src/api/{flows,runs,flow-grants,forms}.ts`
Prefix the matching calls with `/api` (~20 paths), including the `baseUrl`-built SSE
(`/workflow-instances/:id/events`) and export URLs. Sweep the whole `web` package for any
stray direct `fetch("/workflow…")` / `fetch("/me/forms")`.

### nginx — `nginx/web.conf`
Add a third location for the public inbound webhook:
```nginx
location /webhooks/in/ {
  set $upstream_api "http://api-server:4000";
  proxy_pass $upstream_api;        # no trailing slash → path forwarded unchanged
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```
Final routing: `/api/` → api-server; `/webhooks/in/` → api-server; `/` → SPA.

## Verification

- `npm run check` (typecheck) passes.
- Sanity: `grep` shows no remaining root-registered frontend route and no double `/api/api`.
- Rebuild `web` + `api-server`; then in the running stack:
  - `curl :6080/api/workflows` → 401 (auth required) **not** 404/HTML.
  - UI workflow list loads (no `Unexpected token '<'`).
  - A configured webhook URL `:6080/webhooks/in/<token>` reaches the receiver (404
    `unknown_webhook` for a bad token, not HTML).

## Out of scope

- Moving the inbound webhook under `/api` (kept root for a stable external URL).
- `trustProxy` / `X-Forwarded-Proto` for HTTPS-correct generated URLs (needed only for real
  TLS deployments, not local).
