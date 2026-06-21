# Design: opt-in egress allowlist for Docker sandboxes

**Date:** 2026-06-21
**Author:** Samuel Rego
**Status:** Approved (design) — pending implementation plan
**Related:** [competitive analysis](../../competitive-analysis/2026-06-19-agent-cage-vs-journeyman.md) (agent-cage vs Journeyman)

---

## 1. Problem

The Journeyman Docker sandbox has a **binary network model**, and the default is the open end. From [`docker-execution-environment.ts:52`](../../../packages/sandbox/src/backends/docker/docker-execution-environment.ts):

```ts
const network = config["network"] === "none" ? ("none") : (spec.network ?? ("full"));
```

- `"full"` (default) → container joins the default bridge with **unrestricted outbound internet**. An autonomous agent can exfiltrate source/secrets to any host.
- `"none"` → loopback only, which breaks `pip` / `npm` / `apt` / git — unusable for real coding.

There is no middle ground. This design adds that middle: **a domain allowlist** — full OS capability, but the agent can only reach an approved set of domains.

This is the "Option 1" enforcement model (domain allowlist via a forward proxy + a no-internet network). TLS-inspecting deep policy (HTTP method/path rules) is explicitly **out of scope** (see §7).

## 2. Goals / non-goals

**Goals**
- A third network mode, `"allowlist"`, configurable when creating/editing a Docker sandbox.
- Sensible presets so a fresh allowlist sandbox "just works" for normal coding.
- Enforcement that cannot be trivially bypassed (no raw-IP escape).
- The agent's own model-provider calls always work.

**Non-goals (this iteration)**
- TLS interception / HTTP method or path filtering (Option 2).
- Structured, run-keyed egress audit persisted to the run store.
- Org-level shared/reusable allowlists.
- Runner container hardening (non-root, dropped capabilities, seccomp) — a separate effort.

## 3. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Enforcement model | Domain allowlist via forward proxy + internal (no-internet) network. No TLS inspection. |
| Default for new sandboxes | **Full** stays the default. Allowlist is opt-in. Existing sandboxes untouched. |
| Default presets when Allowlist is chosen | All four ON: package registries, git host, OS package mirrors, common dev CDNs. |
| Model endpoint | **Always allowed**, auto-appended at run time, not user-removable. |
| Custom domains | Users may add arbitrary additional domains. |
| Scope | Per-sandbox config only. |

## 4. Config model

The existing `Network` dropdown gains a third option. Stored in the sandbox's `config` JSONB:

```jsonc
{
  "network": "allowlist",                 // "full" | "none" | "allowlist"
  "egress": {
    "presets": {
      "registries": true,
      "gitHost": true,
      "osMirrors": true,
      "devCdns": true
    },
    "allow": ["internal.mycorp.com"]        // user's custom additions (domain patterns)
  }
}
```

- `egress` is only meaningful when `network === "allowlist"`; ignored otherwise.
- Preset → concrete domain-list expansion lives in code (`egress-presets.ts`), so updating what "registries" means doesn't require editing existing sandboxes.
- The model-provider domain(s) are appended to the resolved list at provision time, regardless of presets/custom entries. **These are not hardcoded** — see §4.1.

### 4.1 Model endpoint auto-resolution (multi-provider)

The agent's own LLM API must always be reachable, but the host depends on the run's configured provider/model — Anthropic, OpenAI, Google, or an OpenAI-compatible gateway (OpenRouter, MiniMax, Azure, self-hosted). The host is resolved, not fixed:

- If the resolved `CodingModelConfig.baseUrl` is set (OpenAI-compatible / OpenCode custom), use **its hostname** (e.g. `baseUrl: "https://openrouter.ai/api/v1"` → allow `openrouter.ai`).
- Otherwise look up a **known default host** for the built-in provider package:

  | npm package | default host |
  |---|---|
  | `@ai-sdk/anthropic` | `api.anthropic.com` |
  | `@ai-sdk/openai` | `api.openai.com` |
  | `@ai-sdk/google` | `generativelanguage.googleapis.com` |

  This map lives in `egress-presets.ts` (`MODEL_DEFAULT_HOSTS`).

**Availability:** the model + `baseUrl` is resolved at step-handler time ([`worker-harness.ts:328`](../../../packages/orchestrator/src/workers/worker-harness.ts)) — *before* sandbox provision ([`ensure-workspace.ts:135`](../../../packages/orchestrator/src/sandbox/ensure-workspace.ts)), which today calls `provision(runId, {})`. The resolved host(s) are threaded into the provision spec so the proxy ACL includes them from the start.

**Multiple models per flow:** steps may use different providers, but the worker sees only the current step (the full flow lives in Conductor) and the proxy is started once on the first step that needs a workspace. So the allowlist is **append-on-demand**, not pre-resolved across steps — see §5.1 and dry-run finding F2.

**Resolved allow-list** (computed at provision, not stored):
```
resolvedAllow = MODEL_ENDPOINTS
              ∪ presets.registries ? REGISTRY_DOMAINS : ∅
              ∪ presets.gitHost    ? GIT_HOST_DOMAINS : ∅
              ∪ presets.osMirrors  ? OS_MIRROR_DOMAINS : ∅
              ∪ presets.devCdns    ? DEV_CDN_DOMAINS : ∅
              ∪ egress.allow
```

### Preset domain groups (initial contents — refined in the plan)

| Preset | Example domains |
|---|---|
| `registries` | `pypi.org`, `files.pythonhosted.org`, `registry.npmjs.org` |
| `gitHost` | `github.com`, `api.github.com`, `codeload.github.com`, `gitlab.com` |
| `osMirrors` | `deb.debian.org`, `archive.ubuntu.com`, `security.ubuntu.com` |
| `devCdns` | `objects.githubusercontent.com`, `raw.githubusercontent.com`, `crates.io`, `static.crates.io`, `proxy.golang.org` |
| model (always) | resolved from the coding-provider/model config (e.g. `api.anthropic.com`) |

## 5. Runtime enforcement

The mechanism makes a raw-IP bypass **structurally impossible** — the run container simply has no route to the internet except through the proxy.

At `provision(runId, spec)` when the resolved network mode is `allowlist`:

1. **Create a private internal network** `jm-net-<runId>` with no gateway to the internet (Docker `Internal: true`).
2. **Generate the proxy ACL** from `resolvedAllow` (squid `dstdomain` allow rules + `deny all` fallback).
3. **Start a squid proxy sidecar** labelled with `journeyman.runId`, attached to **both** the internal network **and** a normal internet-connected bridge. Mount/inject the generated ACL.
4. **Start the run container** attached to the **internal network only**, and inject into the runner env:
   - `HTTP_PROXY=http://<proxy-host>:3128`
   - `HTTPS_PROXY=http://<proxy-host>:3128`
   - `NO_PROXY=localhost,127.0.0.1`
5. The run container's only egress path is the proxy; the proxy only forwards allowlisted domains.

At `destroy(env)`: remove the proxy container and the network, in addition to the existing run-container + volume teardown. All teardown remains idempotent.

**Proxy image:** a small squid image must be present on the daemon. Reuse the existing "ensure image present" pattern (cf. `ensure-kit.ts`) so it is pulled once and cached.

**Bypass note:** because the run network is `Internal: true`, even direct-IP connections have no route out. DNS lockdown is therefore not required for correctness in this model (the proxy resolves names for forwarded requests); it may be added later as defense-in-depth.

**Proxy log:** the proxy's allow/deny access lines are forwarded into the step logs via the existing `onLog` path — a lightweight audit for free. A structured, run-keyed audit store is a follow-up (§7).

### 5.1 Runtime prerequisites discovered in the dry run

Two runtime facts make or break this mechanism (dry-run findings F1, F2):

1. **The runner must opt into the proxy.** Node's global `fetch` (undici) — used by both the Claude SDK and ai-sdk model calls — does **not** honor `HTTP_PROXY` by default, and there is currently no proxy setup anywhere in `agent-runtime`. So [`runner/cli.ts`](../../../packages/agent-runtime/src/runner/cli.ts) must set `NODE_USE_ENV_PROXY=1` (and/or `setGlobalDispatcher(new ProxyAgent(...))`) globally — alongside the existing `IS_SANDBOX=1` setup — so undici and the spawned Claude engine subprocess route through the proxy. Without this, every allowlist run fails to reach its model. **Hard prerequisite.**

2. **The allowlist is append-on-demand, not pre-resolved.** Provision happens once (first step needing a workspace) and the proxy ACL is fixed then, but later steps may use a different model host that isn't knowable up front (F2). So the docker env exposes `ensureHostAllowed(env, host)`: the orchestrator calls it before each step's `runCustomPrompt` with that step's resolved model host; if the host is new, the backend appends it to the ACL and hot-reloads squid (`squid -k reconfigure`, no restart). The first-step model host is still resolved at provision so the box is usable immediately.

## 6. Surfaces touched

### Core
- [`packages/core/src/types/execution-environment.types.ts`](../../../packages/core/src/types/execution-environment.types.ts)
  - Extend `network` to `"none" | "full" | "allowlist"`.
  - Add an `EgressPolicy` type (`presets`, `allow`).

### Backend (`@journeyman/sandbox`)
- [`backends/docker/docker-backend.ts`](../../../packages/sandbox/src/backends/docker/docker-backend.ts) — `validateConfig`: when `network === "allowlist"`, validate the `egress` shape (presets booleans, `allow` is a string[] of valid domain patterns).
- [`backends/docker/docker-execution-environment.ts`](../../../packages/sandbox/src/backends/docker/docker-execution-environment.ts) — `provision` (network + proxy orchestration, env injection) and `destroy` (teardown).
- [`backends/docker/docker-client.ts`](../../../packages/sandbox/src/backends/docker/docker-client.ts) — new `IDockerClient` methods: `createNetwork` / `removeNetwork`, `runProxy` (or extend `runIdle` with a network + extra-attach option), and container-to-network attach. Faked in unit tests.
- **New** `backends/docker/egress-presets.ts` — preset → domain-list map + `resolveAllow(policy, modelEndpoints)`.
- **New** `backends/docker/squid-conf.ts` — pure function: `resolvedAllow → squid.conf` string. Must also emit ports parsed from allowed `baseUrl`s into `Safe_ports`/`SSL_ports` (F4), tuned `read_timeout`/`request_timeout` for long streaming (F9), and an `apt.conf.d` proxy snippet path for the OS-mirror preset (F6). Provide an `appendDomain`-style regeneration used by `ensureHostAllowed` + `squid -k reconfigure` (§5.1).
- Ensure-proxy-image step (pattern from `ensure-kit.ts`).

### Runner (`@journeyman/agent-runtime`) — F1
- [`runner/cli.ts`](../../../packages/agent-runtime/src/runner/cli.ts) — set `NODE_USE_ENV_PROXY=1` (and/or a global undici `ProxyAgent`) so model/tool HTTP routes through the injected proxy.

### Orchestrator (`@journeyman/orchestrator`)
- [`workers/worker-harness.ts`](../../../packages/orchestrator/src/workers/worker-harness.ts) — resolve the current step's model endpoint host (from the already-resolved `modelConfig` / provider) and (a) pass the first host into the provision spec, (b) call `ensureHostAllowed(env, host)` before each step's `runCustomPrompt` (§5.1, F2).
- [`sandbox/ensure-workspace.ts`](../../../packages/orchestrator/src/sandbox/ensure-workspace.ts) — pass the resolved model host into `provision`; persist proxy container id + network name via `markActive` (F3).
- A `modelEndpointHost(provider, modelConfig)` helper (pure) implementing the baseUrl-or-default-host rule.

### Instance store + teardown — F3
- Migration: add `proxy_container_id TEXT`, `network_name TEXT` to `jm_sandbox_instances`.
- Extend `ProvisionedEnv` and `SandboxInstanceRecord` to carry them; `markActive`/`connect` persist + restore them; docker `destroy()` removes proxy + network in addition to container + volume. Both teardown paths (end-of-run reaper in `composition.ts`, orphan reaper) converge on `destroySandboxInstance`, so the extended record flows through both.

### Frontend (`@journeyman/web`)
- [`packages/web/src/components/sandboxes/types/DockerConfigForm.tsx`](../../../packages/web/src/components/sandboxes/types/DockerConfigForm.tsx) — the only UI file:
  - `DockerState` gains `network: "full" | "none" | "allowlist"` and an `egress` sub-state.
  - Network dropdown gains the third option.
  - When `allowlist`: render the four preset checkboxes (default checked), the always-on model note, and an "Additional allowed domains" textarea.
  - `readConfig` deserializes `config.egress`; `buildConfig` serializes it. `validate` checks domain syntax.

No change required to the create/update route or DB layer — `config` is already pass-through JSONB.

## 7. Out of scope / future work

- **Deep policy (Option 2):** TLS interception for HTTP method/path/payload rules. The `egress` config shape is intentionally extensible to carry per-host rules later.
- **Structured audit:** per-request log keyed to `runId`, surfaced through the instance admin routes.
- **Org-level shared allowlists:** reusable named lists referenced by sandboxes.
- **Runner hardening:** non-root user, dropped Linux capabilities, seccomp profile.
- **DNS lockdown:** defense-in-depth resolver restriction (not needed for correctness given the internal network).

## 8. Testing strategy

- **Unit (pure):** `egress-presets.resolveAllow` (preset combinations + model endpoint always present + custom merge + dedupe); `modelEndpointHost` (baseUrl hostname parsing for OpenRouter/MiniMax/Azure/self-hosted; known-default lookup for built-in OpenAI/Anthropic/Google; union across multiple models); `squid-conf` generation (allow rules + deny-all fallback + escaping).
- **Unit (faked client):** `provision` in allowlist mode creates network + proxy + run container with the right env and attachments; `destroy` removes all three; idempotency.
- **Backend validation:** `validateConfig` accepts valid egress shapes and rejects malformed ones (bad preset types, non-string allow entries, invalid domains).
- **Frontend:** `readConfig`/`buildConfig` round-trip for each network mode; switching to allowlist reveals presets defaulted on; custom-domain parsing.
- **Integration (gated, existing docker integration suite):** an allowlist run can reach an allowed domain and is refused for a non-allowlisted one.

## 9. Risks

- **Tools that ignore `HTTP_PROXY`.** Mitigated by the internal network — such tools simply fail to reach the internet rather than escaping policy. Document which ecosystems need explicit proxy config (git, apt).
- **Proxy image availability** on locked-down/offline daemons. Reuse the kit-ensure pattern and surface a clear error if the proxy image can't be obtained.
- **Per-run sidecar overhead** (one extra container + network per allowlist run). Acceptable for the isolation guarantee; revisit a shared-proxy model only if it becomes a measured problem.

## 10. Dry-run findings (verified against code)

| # | Severity | Finding | Resolution |
|---|---|---|---|
| F1 | 🔴 Critical | Node `fetch`/undici (Claude SDK + ai-sdk) ignores `HTTP_PROXY`; no proxy setup exists in `agent-runtime`. Model calls would never reach the proxy → every allowlist run dies. | Set `NODE_USE_ENV_PROXY=1` / global `ProxyAgent` in `runner/cli.ts` (§5.1). Hard prerequisite. |
| F2 | 🔴 Critical | "Union of all model hosts" is unknowable: worker sees one step at a time; proxy ACL frozen at first provision. Later step on a different provider gets blocked. | Append-on-demand `ensureHostAllowed(env, host)` + `squid -k reconfigure` before each step (§5.1). |
| F3 | 🟠 High | Proxy container + network have no place in `jm_sandbox_instances`; normal teardown and orphan reaper leak them. | Add `proxy_container_id`/`network_name` columns; thread through `ProvisionedEnv`/record/`destroy` (§6). |
| F4 | 🟠 High | squid default `Safe_ports`/`SSL_ports` deny `CONNECT` to non-standard model ports (e.g. `:1234`, `:8443`). | Parse port from each allowed `baseUrl` into the generated config. |
| F5 | 🟡 Med | Self-hosted models at `localhost`/`127.0.0.1`/`host.docker.internal`/LAN IP unreachable from proxy netns; `dstdomain` doesn't match IPs. | Handle IP literals via `dst` ACL + `--add-host`; document limitation. |
| F6 | 🟡 Med | `apt` honoring of `http_proxy` env is unreliable across bases. | Write `/etc/apt/apt.conf.d/` proxy snippet when allowlist is on. |
| F7 | 🟡 Med | git-over-SSH bypasses the proxy and has no route. | Document as unsupported under allowlist (token-HTTPS clone works). |
| F8 | 🟡 Med | Partial provision (proxy fails after net/container created) leaks. | `try/catch` rollback in `provision`. |
| F9 | 🟡 Med | squid `read_timeout`/`request_timeout` can cut long SSE generations. | Tune timeouts up for agent workloads. |
| F10 | 🟢 Low | One network per run can exhaust the default address pool at high concurrency. | Configurable address pool; document ceiling. |
| F11 | 🟢 Low | Proxy image must be present on offline daemons. | Reuse `ensure-kit.ts` pattern; clear error if unobtainable. |
| F12 | 🟢 Low | `web-fetch`/`web-search` tools become governed by the allowlist (correct, but surprising). | Document the behavior. |
| F13 | 🟢 Low | `NO_PROXY` must cover the OpenCode loopback server. | `NO_PROXY=localhost,127.0.0.1` (already specified). |
