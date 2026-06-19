# Competitive Analysis: PNNL agent-cage vs. Journeyman Sandbox

**Date:** 2026-06-19
**Author:** Samuel Rego
**Subject:** [pnnl/agent-cage](https://github.com/pnnl/agent-cage) vs. the Journeyman `@journeyman/sandbox` execution-environment system, plus the broader agent-sandbox field.

---

## 1. Executive summary

agent-cage and Journeyman are **not competitors on the same axis**. They solve different halves of the "run an autonomous agent safely" problem:

- **Journeyman** is strong on **compute isolation and orchestration** — pluggable backends, per-run containers, image build lifecycle, multi-tenant scope, durable execution.
- **agent-cage** is strong on exactly one thing Journeyman lacks: **network egress governance** — give the agent full OS capability but allowlist what it can reach on the internet, with a per-request audit log.

**Recommendation (which one to go with):** Do **not** adopt agent-cage wholesale — it is a self-declared "research preview & prototype," single-container, with no multi-tenancy, no durable execution, and no managed image lifecycle. Instead, **build a native egress-governance layer into the Journeyman Docker backend**, borrowing agent-cage's proven proxy + allowlist + audit pattern. This closes our single real security gap while keeping everything we already do better. See §7.

---

## 2. The two axes that matter

Every agent-sandbox product sits somewhere on two independent axes:

| Axis | Question it answers | Journeyman | agent-cage |
|---|---|---|---|
| **Compute isolation** | *Where* does the agent run; how isolated is the process/filesystem/kernel? | Strong (containers, volumes, resource limits, pluggable backends) | Basic (one Docker container; explicitly says harden it yourself) |
| **Egress governance** | *What* can the agent reach on the network, and is it audited? | **Missing** (binary on/off) | **Strong** (allowlist, method filter, TLS inspect, audit log) |

The whole point of this analysis: **we own the first axis, agent-cage owns the second, and the second is our gap.**

---

## 3. What agent-cage actually is

A Docker-Compose stack that puts a **policy-enforcing network layer in front of a single full-capability Ubuntu agent container**.

**Components**
- Sandboxed Ubuntu agent container — terminal, filesystem, root, browser; full OS capability by design.
- **mitmproxy** policy engine — intercepts and inspects *all* agent traffic (TLS interception via injected CA).
- **CoreDNS** — DNS-level domain control.
- Control dashboard (HTML) + REST API — operators watch traffic and adjust policy live.
- Audit logging layer — every network event recorded for compliance.

**Design philosophy:** separate *capability* from *access control*. The agent may do anything locally (`pip install`, run code, browse) but the network is governed like enterprise IT — proxy policy, TLS inspection, audit logs.

**Stack:** Python CLI (`agentcage`), HTML dashboard, shell infra, Docker Compose. Integrations: Claude Code, Cline, LangGraph, SSH, MCP servers. Policy presets: `default`, `coding-agent`.

**Maturity (their own words):** *"Research preview & prototype… It is strictly the responsibility of the building party to conduct a full security audit and harden the architecture before any production use."* Recommended hardening they have **not** done: gVisor, Linux capability drops, DNS lockdown, Kata Containers.

---

## 4. The gap, proven from our code

Our network model is governed by one line — [`docker-execution-environment.ts:52`](../../packages/sandbox/src/backends/docker/docker-execution-environment.ts):

```ts
const network = config["network"] === "none" ? ("none") : (spec.network ?? ("full"));
```

…and [`docker-client.ts:83`](../../packages/sandbox/src/backends/docker/docker-client.ts):

```ts
...(o.network === "none" ? { NetworkMode: "none" } : {}),
```

This means our network is **binary, and the default is the open end**:

| Setting | Docker behavior | Consequence |
|---|---|---|
| `"full"` (**default**) | No `NetworkMode` set → joins the default bridge with **unrestricted outbound internet** | Agent can exfiltrate source/secrets to *any* host. No record of what it contacted. |
| `"none"` | `NetworkMode: "none"` → loopback only | Breaks `pip` / `npm` / `apt` / git clone — unusable for real coding. |

A full grep of `packages/sandbox`, `packages/agent-runtime`, and `packages/core` for `HTTP_PROXY` / proxy / CoreDNS / allowlist returns **nothing**. There is no egress filtering anywhere. The default posture is "open to the entire internet," and the only safety lever is the blunt "total blackout" that makes the box useless. This is the exact missing middle agent-cage was built to fill, and it intersects directly with the known [no in-sandbox git auth] limitation.

---

## 5. Head-to-head

| Dimension | Journeyman sandbox | agent-cage |
|---|---|---|
| **Primary strength** | Compute isolation + orchestration | Network egress governance |
| **Backends** | local, docker, windows (+ planned ecs/ec2/k8s/cloud) | single Docker container |
| **Per-run isolation** | per-run container + named volume | one shared container |
| **Resource limits** | CPU (NanoCpus), memory | none documented |
| **Network model** | binary: unrestricted (default) or off | allowlist/denylist, HTTP-method filter, TLS inspection |
| **Egress audit** | none | full per-request log |
| **Image lifecycle** | build loop, fingerprinting, lease-based concurrency, registry pull/push | none (compose build) |
| **Multi-tenancy** | org/system scope, workspace-aware, many concurrent runs | single-operator |
| **Durable execution** | Conductor, retries, pause/resume | none |
| **Coding-agent integration** | native runner (`journeyman-runner`), structured stdin/stdout | generic via proxy (Claude Code, Cline, LangGraph, SSH) |
| **Maturity** | production-pattern | self-declared research prototype |

---

## 6. Why Journeyman is better

1. **It's a platform, not a demo.** agent-cage is one container plus a dashboard. Journeyman is a multi-backend, multi-tenant orchestration system with durable execution, retries, and human-in-the-loop pause/resume.
2. **Real per-run isolation.** Each run gets its own container and named volume (`jm-run-<runId>`) with CPU/memory limits and a reaper that cleans orphans. agent-cage shares one long-lived container across activity.
3. **Managed image lifecycle.** Build loop with content fingerprinting, lease-based concurrency to prevent duplicate builds, crash recovery via lease expiry, registry pull/push. agent-cage has none of this.
4. **Pluggable by design.** `IExecutionEnvironment` lets us add ecs/k8s/firecracker backends without touching callers. agent-cage is hardwired to local Docker Compose.
5. **Native coding-agent protocol.** The runner is shipped into the box and speaks structured JSON; we get typed results, not screen-scraped terminal output.
6. **Multi-tenant from the ground up.** Org/system scope, visibility rules, workspace awareness. agent-cage is single-operator.

**The one thing agent-cage does better:** governed egress with audit. That's it — but it's a real gap for us.

---

## 7. What we can implement better than agent-cage

agent-cage's idea is right; its execution is a prototype. We can do it better because we already have the orchestration spine. Proposed **native egress-governance layer** for the Docker backend:

1. **Egress policy as first-class config.** Extend `ExecutionEnvironmentSpec.network` from `"none" | "full"` to also accept a **policy object**: `{ mode: "allowlist", allow: ["pypi.org", "registry.npmjs.org", "github.com", ...], denyByDefault: true }`. Per-sandbox, per-org defaults, validated by the backend like every other config.
2. **Proxy sidecar per run, not a shared one.** Provision a small egress-proxy container on a private Docker network alongside the run container; the run container gets **no default route** except through the proxy. Inject `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` into the runner env. This fits cleanly into `runIdle` and the existing per-run lifecycle — and beats agent-cage's single shared proxy because policy is **isolated per run/tenant**.
3. **DNS lockdown by default.** Point the run container at a controlled resolver that only answers allowlisted names — closes the IP-literal bypass that a pure-proxy approach leaves open.
4. **Egress audit log wired into our run store.** Every blocked/allowed request recorded against the `runId`, queryable through the existing run/instance admin routes — not a separate dashboard. This makes audit a property of a *run*, which agent-cage can't do because it has no run model.
5. **Hardening agent-cage skipped.** Because we control image builds, we can ship the things their README only *recommends*: drop Linux capabilities, non-root runner user, `seccomp` profile, and a path to gVisor/Kata or Firecracker microVMs as a future backend.
6. **Secrets stay out of the box's reachable network.** Combined with allowlisting, scoped git credentials can be injected per-exec (we already do per-exec env) without exposing them to arbitrary egress — directly improving the [no in-sandbox git auth] situation.

Net: we get agent-cage's capability, but **per-run, multi-tenant, audited against the run model, and properly hardened** — none of which their prototype provides.

---

## 8. Field positioning (for context)

| Product | Isolation | Egress governance | Notes |
|---|---|---|---|
| **E2B** | Firecracker microVM (own kernel, HW isolation, GPU passthrough) | none built-in | Market leader for ephemeral code-exec; ~150ms cold start. |
| **Daytona** | Docker + gVisor | none built-in | Persistent sandboxes, ~90ms create; gVisor blocks GPU. |
| **agent-infra/sandbox** | single container, `seccomp=unconfined` | none | All-in-one (browser/shell/VSCode/Jupyter); weak isolation docs. |
| **agent-cage** | single container | **strong** (allowlist + audit) | The egress specialist; prototype maturity. |
| **Journeyman** | per-run container + volume + limits, pluggable backends | **none (gap)** | Orchestration + multi-tenancy leader in this set. |

The whole field competes on **compute isolation** (microVM vs container vs gVisor). Almost nobody ships **egress governance** — agent-cage is the outlier. If we add a native egress layer, we'd combine orchestration leadership *and* a security capability the big players (E2B, Daytona) don't have out of the box.

---

## 9. Recommendation — which one to go with

**Go with: build the native egress-governance layer (§7). Do not adopt or wrap agent-cage in production.**

Reasoning:
- **Adopting agent-cage wholesale** fails: it's a single-container prototype with no multi-tenancy, no durable execution, no image lifecycle. It would be a downgrade everywhere except egress.
- **Wrapping agent-cage as a backend** is possible but means inheriting unmaintained prototype code on our critical path, and bolting a single-operator dashboard onto a multi-tenant system. Reasonable only as a throwaway spike to study their mitmproxy policy format.
- **Building it natively** is the right call: the idea is proven, the effort is bounded (proxy sidecar + DNS + policy config + audit hook all slot into existing seams), and the result is strictly better than agent-cage because it's per-run, multi-tenant, audited against our run model, and hardened.

**Suggested sequencing:**
1. **Spike** — stand up agent-cage locally for an afternoon, study its `coding-agent` policy preset and mitmproxy rules. Borrow the allowlist shape; throw the rest away.
2. **MVP** — per-run egress-proxy sidecar + `HTTP_PROXY` injection + allowlist config on the Docker backend; default allowlist = package registries + configured git host.
3. **Harden** — DNS lockdown, non-root runner, capability drops, `seccomp`.
4. **Audit** — egress log against `runId`, surfaced through existing admin routes.
5. **Future** — Firecracker/gVisor backend for kernel-level isolation to match E2B/Daytona on the compute axis.

If you want, the next step is to turn §7 + §9 into a proper design spec and implementation plan.

---

## Sources

- [pnnl/agent-cage](https://github.com/pnnl/agent-cage)
- [agent-infra/sandbox](https://github.com/agent-infra/sandbox)
- [Daytona vs E2B in 2026 — Northflank](https://northflank.com/blog/daytona-vs-e2b-ai-code-execution-sandboxes)
- [AI Agent Code Execution Sandbox: E2B, Daytona, Firecracker — Spheron](https://www.spheron.network/blog/ai-agent-code-execution-sandbox-e2b-daytona-firecracker/)
- Journeyman source: `packages/sandbox/src/backends/docker/`, `packages/core/src/types/execution-environment.types.ts`
