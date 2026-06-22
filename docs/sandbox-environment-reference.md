# Sandbox Environment Reference

What tooling each sandbox backend provides to a coding agent. The agent runs
its Bash commands inside this environment, so anything it shells out to
(`git`, `python`, `node`, …) must be present here.

## Tooling by backend

| Tool | Docker default (`runner-base`) | Docker custom image | Local (worker container) | Windows agent |
|------|:------------------------------:|:-------------------:|:------------------------:|:-------------:|
| Node.js 22 | ✅ | ✅ (bundle) | ✅ | host-provided |
| git | ✅ | ✅¹ | ✅ | host-provided |
| curl | ✅ | ✅¹ | ✅ | host-provided |
| Python 3 + pip | ✅ | ✅¹ | ✅ | host-provided² |
| bare `python` → `python3` | ✅ | ✅¹ | ✅ | host-provided |

¹ Injected best-effort for **apt (Debian)** and **apk (Alpine)** bases by the
Dockerfile wrap (`packages/sandbox/src/backends/docker/dockerfile-wrap.ts`).
Custom images on other bases must install their own toolchain.

² Not auto-installed. The Windows agent **reports** Python at readiness as an
**advisory** check (`packages/windows-agent/src/readiness.ts`) — a missing
interpreter does not block startup. Install Python 3 on the box if a workflow
needs it.

## Why `python` and not just `python3`

Installing the Python package provides `python3` but no bare `python`. Models
frequently type `python script.py`, so every image we control also provides a
`python` → `python3` alias (Debian: `python-is-python3`; Alpine: a symlink).

## What is *not* provisioned

No just-in-time tool installation and no per-language environment setup. If a
task needs a toolchain beyond the table above, use a custom Docker image (apt or
apk base) or provision the host (local / Windows).
