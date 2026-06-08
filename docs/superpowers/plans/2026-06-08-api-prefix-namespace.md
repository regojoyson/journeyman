# `/api` Route Namespacing + Webhook Ingress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve all frontend-facing API routes under `/api` (so the single nginx `/api/` proxy reaches them and they don't collide with SPA page routes), and expose the public inbound webhook receiver.

**Architecture:** Wrap the 6 root-registered workflow registrars in one Fastify `{ prefix: "/api" }` scope in `server.ts`; prefix the matching frontend `api()` paths in 5 `web/src/api/*` modules; add a dedicated `location /webhooks/in/` to nginx. Auth is a per-route `preHandler` (reads token from request headers, closured pool) and is unaffected by the prefix encapsulation.

**Tech Stack:** Fastify (route prefixing via `app.register(plugin, { prefix })`), nginx reverse proxy, React SPA, bash/sed.

**Reference spec:** [docs/superpowers/specs/2026-06-08-api-prefix-namespace-design.md](../specs/2026-06-08-api-prefix-namespace-design.md)

**Branch:** `feat/api-prefix-namespace`

**Testing note:** These are routing/config changes with no unit-test harness. Verification = TypeScript typecheck (`npm run check`), grep invariants, image rebuild, and runtime smoke checks (Task 5). Commit after each task.

---

### Task 1: Wrap the 6 workflow registrars under `/api` (backend)

**Files:**
- Modify: `packages/api-server/src/server.ts` (registration block, ~lines 49–61)

- [ ] **Step 1: Make the edit**

Replace this block:
```ts
  registerWorkflowRoutes(app, c);
  registerStepsRoutes(app);
  registerWorkflowGrantsRoutes(app, c);
  registerWorkflowInstanceRoutes(app, c);
  registerWebhookRoutes(app, c);
  if (c.pool) {
    registerWebhookManagementRoutes(app, c);
    registerWebhookPresetRoutes(app, c);
  }
  registerHumanTaskRoutes(app, c);
  registerFormRoutes(app, c);
  registerWorkflowTriggersRoute(app, c);
  return app;
```
with:
```ts
  registerStepsRoutes(app);
  registerWebhookRoutes(app, c);
  if (c.pool) {
    registerWebhookManagementRoutes(app, c);
    registerWebhookPresetRoutes(app, c);
  }
  // These registrars historically registered at root (/workflows, /workflow-instances,
  // …). Namespace them under /api so the single nginx `/api/` proxy reaches them and they
  // don't collide with the SPA's /workflows & /workflow-instances page routes. Auth is a
  // per-route preHandler (reads token from request headers; closured pool), so this
  // encapsulation does not change auth/role/ownership behavior.
  await app.register(async (s) => {
    registerWorkflowRoutes(s, c);
    registerWorkflowGrantsRoutes(s, c);
    registerWorkflowInstanceRoutes(s, c);
    registerHumanTaskRoutes(s, c);
    registerFormRoutes(s, c);
    registerWorkflowTriggersRoute(s, c);
  }, { prefix: "/api" });
  return app;
```
(`buildServer` is already `async` and awaits `app.register(cors, …)`, so `await app.register(...)` is valid. `cors`/`sensible`/the error handler are registered earlier, so the child context inherits them.)

- [ ] **Step 2: Typecheck the api-server package**

Run: `npm run typecheck -w @journeyman/api-server`
Expected: no errors.

- [ ] **Step 3: Verify the routes now mount under /api (prints the route table)**

Run:
```bash
node --import tsx -e "import('./packages/api-server/src/server.ts').then(async m => { const app = await m.buildServer({}); await app.ready().catch(()=>{}); console.log(app.printRoutes()); }).catch(e=>{console.error(e.message)})" 2>/dev/null | grep -E "workflows|workflow-instances|me/forms" | head
```
Expected: the workflow/instance/forms routes appear with an `/api/` prefix (e.g. `/api/workflows`, `/api/workflow-instances`). If `buildServer({})` throws on a missing pool, skip this step — Task 5's runtime curl is the authoritative check.

- [ ] **Step 4: Commit**

```bash
git add packages/api-server/src/server.ts
git commit -m "feat(api): namespace workflow/instance/forms/grants/triggers routes under /api"
```

---

### Task 2: Prefix the frontend API calls with `/api`

The frontend calls these routes without `/api`. They live only in `web/src/api/*` modules (never in page components, which use the same path strings for SPA navigation — do NOT touch components). Five files, each transformed by an unambiguous prefix substitution.

**Files:**
- Modify: `packages/web/src/api/flows.ts`
- Modify: `packages/web/src/api/runs.ts`
- Modify: `packages/web/src/api/flow-grants.ts`
- Modify: `packages/web/src/api/forms.ts`
- Modify: `packages/web/src/api/flow-versions.ts`

- [ ] **Step 1: Apply the path prefixes (macOS/BSD sed)**

```bash
cd "$(git rev-parse --show-toplevel)"
sed -i '' 's#/workflows#/api/workflows#g'                 packages/web/src/api/flows.ts
sed -i '' 's#/workflow-instances#/api/workflow-instances#g' packages/web/src/api/runs.ts
sed -i '' 's#/workflows#/api/workflows#g'                 packages/web/src/api/flow-grants.ts
sed -i '' -e 's#/me/forms#/api/me/forms#g' -e 's#/workflows#/api/workflows#g' packages/web/src/api/forms.ts
sed -i '' 's#/workflow_versions#/api/workflow_versions#g' packages/web/src/api/flow-versions.ts
```
(On Linux use `sed -i` without the `''`.)

Note: `/workflows` is a strict prefix and never appears inside `/workflow-instances` or `/workflow_versions`, so the substitutions don't overlap. The `${baseUrl}/workflow-instances/:id/events` (SSE) and `/export` URLs in `runs.ts` are covered by the `runs.ts` substitution.

- [ ] **Step 2: Verify no un-prefixed paths remain and no double prefix**

Run:
```bash
echo "-- remaining un-prefixed (expect NONE):"
grep -rnE "[\"\`]/(workflows|workflow-instances|workflow_versions|me/forms)([\"\`/?]|\\\$)" packages/web/src/api || echo "  none"
echo "-- double /api/api (expect NONE):"
grep -rn "/api/api" packages/web/src || echo "  none"
echo "-- sweep the whole web package for any stray direct fetch to these (expect NONE):"
grep -rnE "fetch\([\"\`]/(workflows|workflow-instances|workflow_versions|me/forms)" packages/web/src || echo "  none"
```
Expected: all three print `none`.

- [ ] **Step 3: Typecheck the web package**

Run: `npm run typecheck -w @journeyman/web`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/api/flows.ts packages/web/src/api/runs.ts \
        packages/web/src/api/flow-grants.ts packages/web/src/api/forms.ts \
        packages/web/src/api/flow-versions.ts
git commit -m "feat(web): call workflow/instance/forms APIs under /api"
```

---

### Task 3: Expose the inbound webhook via nginx

**Files:**
- Modify: `nginx/web.conf`

- [ ] **Step 1: Add the `/webhooks/in/` location**

Insert this block immediately after the closing `}` of the existing `location /api/ { … }` block (and before `location / { … }` is fine too — nginx matches the longest prefix):
```nginx
  # Public inbound webhook receiver (token-in-path + signature verified by the backend).
  # Kept OUTSIDE /api so the external URL is stable; matched more specifically than `location /`.
  location /webhooks/in/ {
    set $upstream_api "http://api-server:4000";
    proxy_pass $upstream_api;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
```

- [ ] **Step 2: Sanity-check the file has all three routes**

Run: `grep -nE "location (/api/|/webhooks/in/|/) " nginx/web.conf`
Expected: three `location` lines — `/api/`, `/webhooks/in/`, and `/`.

- [ ] **Step 3: Commit**

```bash
git add nginx/web.conf
git commit -m "feat(deploy): proxy inbound webhooks (/webhooks/in/) to the api-server"
```

---

### Task 4: Full typecheck

**Files:** none (verification)

- [ ] **Step 1: Run the repo check**

Run: `npm run typecheck`
Expected: passes for `@journeyman/api-server` and `@journeyman/web` (a pre-existing unrelated error in `packages/agent-runtime/src/providers/claude/tool-mapping.test.ts` may appear — it exists on `master` and is out of scope for this change; confirm it's the only failure and that api-server/web are clean).

---

### Task 5: Rebuild images and runtime smoke test

**Files:** none (verification). Run in the deployed environment.

- [ ] **Step 1: Rebuild the changed images and restart**

Run: `npm run compose:up`
Expected: `web` and `api-server` images rebuild; stack comes up.

- [ ] **Step 2: API route reachable under /api (auth required, not 404/HTML)**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:6080/api/workflows`
Expected: `401` (auth required) — **not** `404` and not HTML. (Before this change it returned the SPA `index.html`.)

- [ ] **Step 3: Inbound webhook reaches the backend (not SPA HTML)**

Run: `curl -s http://localhost:6080/webhooks/in/does-not-exist`
Expected: JSON `{"error":"unknown_webhook"}` (HTTP 404 from the handler) — **not** `<!doctype html>`.

- [ ] **Step 4: UI loads the workflow list without the JSON parse error**

- Open `http://localhost:6080`, complete the setup wizard / log in.
- Go to **Workflows** and **Workflow Instances**.
- Expected: lists load; **no** `Unexpected token '<' … is not valid JSON` in the console; `GET /api/workflows` and `GET /api/workflow-instances` return `200`.

---

## Self-Review

**Spec coverage:**
- `/api` wrap of the 6 registrars → Task 1. ✅
- Frontend path changes (incl. the `flow-versions.ts` file the spec's prose missed, and SSE/export URLs) → Task 2. ✅
- `/webhooks/in/` nginx location → Task 3. ✅
- Security: no code change needed (auth is per-route preHandler) — verified in spec; Task 5 Step 2 confirms `/api/workflows` returns 401 (auth still enforced). ✅
- Excluded routes (`/healthz`, `/webhooks/in`, already-`/api` files) left untouched → Task 1 only wraps the 6. ✅
- Verify (typecheck + smoke) → Tasks 4–5. ✅

**Placeholder scan:** No TBD/TODO; every step has exact commands/edits and expected output. ✅

**Type/identifier consistency:** Registrar names (`registerWorkflowRoutes`, `registerWorkflowGrantsRoutes`, `registerWorkflowInstanceRoutes`, `registerHumanTaskRoutes`, `registerFormRoutes`, `registerWorkflowTriggersRoute`) match `server.ts` and their files; all take `(app, c)`. Frontend files (flows, runs, flow-grants, forms, flow-versions) match `packages/web/src/api/`. ✅
