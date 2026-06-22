# Python in the Sandbox Environments — Design

**Date:** 2026-06-22
**Status:** Approved (design) — ready for implementation planning

## Problem

When a coding agent (Claude or OpenCode provider) is given a task, the model often
reaches for Python via its Bash tool — writing and running a quick `.py` script is a
common reflex. The sandbox environments the agent runs in are **Node-only**: none of
the images we build install Python. The agent's `python …` / `python3 …` command fails
with "command not found" (exit 127), the model sees the error, and then flails —
retrying with a different approach, or trying to `apt-get install` Python mid-task.

This wastes turns and tokens, and sometimes produces worse results than if Python had
just been present.

### Root cause (two parts)

1. **Python isn't installed** in any image we build.
2. **Even if it were**, the package managers install a `python3` binary but **no bare
   `python`**. Models frequently type `python script.py`. So a naive "install Python"
   only half-fixes the symptom — `python` would still be "not found."

## Goal

Python 3 (with `pip` and a working bare `python` command) is available **wherever an
agent runs code in an image we control**. Where we do **not** control the environment
(a developer's host running the local backend directly, or the Windows agent box), we
**detect and report** missing Python at readiness time and **document** the requirement
— rather than letting it fail silently mid-task.

### Non-goals (YAGNI)

- No just-in-time / on-demand tool installation during a run.
- No codebase-language auto-detection or per-language environment provisioning
  (that is a separate, prospective effort — see
  `docs/requirements/codebase-type-aware-workspace.md`).
- No change to the `runner-bundle` image (it is `FROM scratch` plumbing, see below).

## Background: the sandbox execution environments

There are three backends where an agent's Bash commands execute:

| Backend | Where the agent runs | Image we control? |
|---|---|---|
| **Docker** | Inside a container — default `runner-base` image, or a user-supplied custom image wrapped by `dockerfile-wrap.ts` | **Yes** |
| **Local** | In-process on whatever host runs the worker. In the deployed stack the worker is itself a container (`journeyman/worker:dev`); on a dev machine it is the developer's host. | **Container: yes. Dev host: no.** |
| **Windows** | On a Windows box via a separate gRPC `journeyman-agent`, commands run through Git Bash | **No** (host-provisioned) |

### Why `runner-bundle` is out of scope

`docker/runner-bundle.Dockerfile` is `FROM scratch`. It is not a runtime image — it
holds a relocatable `/opt/journeyman` bundle (the Node binary + the bundled runner JS)
that gets `COPY --from`'d into other images. There is no OS, shell, or package manager
in it, so Python cannot and should not be added there. The actual runtime image is
either `runner-base` or the user's wrapped custom base.

### Base-image asymmetry

The images use two different Linux bases, so "install Python" is two different commands:

- **`runner-base`** → `node:22-slim` (Debian) → `apt-get install python3 python3-pip python-is-python3`
- **worker (`runtime-worker` stage)** → `node:22-alpine` (Alpine) → `apk add python3 py3-pip` + manual `python`→`python3` symlink (Alpine has no `python-is-python3` package)

## Design — the six changes

### 1. Docker default runner image — `docker/runner-base.Dockerfile`

Add Python to the existing `apt-get install` line (Debian base). Include the
`python-is-python3` package so a bare `python` works.

```dockerfile
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git openssh-client ca-certificates curl \
      python3 python3-pip python-is-python3 \
 && rm -rf /var/lib/apt/lists/*
```

### 2. Custom Docker images — `packages/sandbox/src/backends/docker/dockerfile-wrap.ts`

The wrap layer currently appends a best-effort, **apt-only** install of
`git openssh-client ca-certificates curl` to user-supplied Dockerfiles. Extend it to:

- Also install `python3` + pip + ensure a bare `python`.
- **Detect apt vs apk** so both Debian-family and Alpine custom bases are covered.
  Alpine: `apk add --no-cache python3 py3-pip && ln -sf /usr/bin/python3 /usr/bin/python`.
- Fall through gracefully (best-effort, as today) when the base has neither package
  manager — those bases are the user's responsibility, surfaced via the UI note (#5)
  and docs (#6).

The injection must remain best-effort: it must never hard-fail a build just because a
package manager isn't recognized.

### 3. Worker image — `Dockerfile` (`runtime-worker` stage, Alpine)

This stage runs the orchestrator + agent-runtime and therefore the **local backend
in-process**. In the deployed compose stack, this is where "local" sandbox commands
actually execute. Add Python and the `python` symlink:

```dockerfile
RUN apk add --no-cache git openssh-client ca-certificates curl python3 py3-pip \
 && ln -sf /usr/bin/python3 /usr/bin/python
```

### 4. Windows agent readiness — `packages/windows-agent/src/readiness.ts`

The Windows box is host-provisioned; we cannot install into it. The readiness check
already reports `bash` / `git` / `node` / `curl` / `workspace`. Add a `python` probe so
a missing Python is **reported at startup** (with an actionable "install Python 3"
message) instead of being discovered mid-run. This is detect-and-report only — no
install.

### 5. Docker config form (UI) — `packages/web/src/components/sandboxes/types/DockerConfigForm.tsx`

When a user is choosing the Docker sandbox type / image source, add a short note (using
the existing `Field` hint / `Code` styling) stating what is auto-provisioned:

> The default runner image and any apt- or apk-based custom image automatically include
> **git, SSH, curl, Node.js, and Python 3** (with `pip`). Images built on other bases
> must install their own toolchain.

Place it near the image-source / Dockerfile fields so expectations are set exactly where
the user picks a base.

### 6. Documentation

- **New** `docs/sandbox-environment-reference.md` — a single table of what tooling each
  backend (Docker default, Docker custom, local/worker, Windows) provides, and what is
  the host's responsibility. This is the central answer to "what's available in the
  sandbox?", which currently has no home.
- **Update** `docs/windows-sandbox-setup.md` — add Python 3 to the prerequisites and to
  the readiness scorecard section, mirroring the new readiness probe (#4).

## Decisions made during design

- **Include pip everywhere** (`python3-pip` / `py3-pip`) — agents commonly `pip install`.
- **apt + apk detection** in the custom-image wrap (#2) rather than apt-only, so Alpine
  custom bases are not silently broken.
- **`python-is-python3` / symlink everywhere** — directly fixes the "tries `python`,
  fails" symptom, which installing `python3` alone would not.

## Risks / considerations

- **Image size** grows by the Python runtime + pip (tens of MB). Acceptable for the
  stated goal; noted so it is a conscious trade-off.
- **Custom non-apt/non-apk bases** still won't get Python. This is intentional and
  surfaced via the UI note (#5) and the reference doc (#6).
- **Symlink collisions:** use `ln -sf` (force) so the symlink step is idempotent and
  safe if a base already provides `python`.

## Verification

- Build `runner-base` and the worker image; run `python --version`, `python3 --version`,
  and `pip --version` inside each — all succeed.
- Wrap a Debian custom Dockerfile and an Alpine custom Dockerfile via `dockerfile-wrap`;
  confirm `python` resolves in both.
- Windows readiness output includes a `python` line (present and absent cases).
- `npm run check` (typecheck + import boundaries) passes for the touched TS files
  (`dockerfile-wrap.ts`, `readiness.ts`, `DockerConfigForm.tsx`).
