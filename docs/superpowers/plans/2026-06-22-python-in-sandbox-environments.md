# Python in the Sandbox Environments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Python 3 (with `pip` and a working bare `python` command) available in every sandbox image Journeyman builds, and detect+document it where the host is not under our control.

**Architecture:** Add Python to the two Linux bases we control (Debian `runner-base`, Alpine worker), extend the custom-image wrap to inject Python on both apt and apk bases, add a Windows readiness probe (detect-only), and surface availability in the Docker config UI plus docs.

**Tech Stack:** Docker (Debian `node:22-slim` + Alpine `node:22-alpine`), TypeScript, Vitest, React (web UI).

**Execution constraints (from requester):**
- **No commits** — leave all changes in the working tree.
- **Single typecheck at the end** — do not typecheck per task.
- **Work on `master`** — no worktree, no branch.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/sandbox/src/backends/docker/dockerfile-wrap.ts` | Wrap user Dockerfiles with bundle + baseline tools | Add Python (apt + apk detection) |
| `packages/sandbox/src/backends/docker/dockerfile-wrap.test.ts` | Unit tests for the wrap | Add Python assertions |
| `docker/runner-base.Dockerfile` | Default Docker sandbox image (Debian) | Add Python to apt install |
| `Dockerfile` (`runtime-worker` stage) | Worker image — runs local backend in-process (Alpine) | Add Python via apk + symlink |
| `packages/windows-agent/src/readiness.ts` | Windows agent startup capability report | Add `python` probe |
| `packages/windows-agent/src/readiness.test.ts` | Unit tests for readiness | Add `python` assertion |
| `packages/web/src/components/sandboxes/types/DockerConfigForm.tsx` | Docker sandbox config form | Add "what's auto-provisioned" note |
| `docs/sandbox-environment-reference.md` | Central reference of tools per backend | Create |
| `docs/windows-sandbox-setup.md` | Windows setup guide | Add Python prerequisite + scorecard line |

---

## Task 1: Python injection in the custom-image wrap (TDD)

**Files:**
- Modify: `packages/sandbox/src/backends/docker/dockerfile-wrap.ts:11-22`
- Test: `packages/sandbox/src/backends/docker/dockerfile-wrap.test.ts`

- [ ] **Step 1: Add failing tests**

Append these `it` blocks inside the existing `describe("wrapDockerfile", …)` in `packages/sandbox/src/backends/docker/dockerfile-wrap.test.ts` (the `out` constant already exists at the top of the describe):

```ts
  it("installs python3 on apt bases", () => {
    expect(out).toMatch(/apt-get install -y[^\n]*python3/);
  });

  it("falls back to apk (alpine) for python3", () => {
    expect(out).toMatch(/apk add[^\n]*python3/);
  });

  it("ensures a bare `python` on both base families", () => {
    expect(out).toContain("python-is-python3");                 // apt
    expect(out).toContain("ln -sf /usr/bin/python3 /usr/bin/python"); // apk
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace @journeyman/sandbox -- dockerfile-wrap`
Expected: the three new tests FAIL (current wrap installs only git/openssh/curl, apt-only).

- [ ] **Step 3: Implement apt + apk Python injection**

Replace the single `RUN …` string (lines 16-18) in `packages/sandbox/src/backends/docker/dockerfile-wrap.ts` with a two-branch best-effort install. The full returned array becomes:

```ts
  return [
    userContent.trimEnd(),
    "",
    "# ── appended by Journeyman (runner bundle + baseline tools) ──",
    "USER root",
    "RUN ( (command -v apt-get >/dev/null 2>&1 && apt-get update && " +
      "apt-get install -y --no-install-recommends " +
      "git openssh-client ca-certificates curl python3 python3-pip python-is-python3 && " +
      "rm -rf /var/lib/apt/lists/*) " +
      "|| (command -v apk >/dev/null 2>&1 && " +
      "apk add --no-cache git openssh-client ca-certificates curl python3 py3-pip && " +
      "ln -sf /usr/bin/python3 /usr/bin/python) ) || true",
    `COPY --from=${bundleRef} /opt/journeyman /opt/journeyman`,
    "ENV PATH=/opt/journeyman/bin:$PATH",
    "",
  ].join("\n");
```

Also update the file's top doc comment (lines 2-5) to reflect apt **and** apk coverage:

```ts
/**
 * Append the Journeyman runner bundle + baseline tools to a user Dockerfile.
 * The tool install is best-effort (`|| true`) and covers both apt (Debian/glibc)
 * and apk (Alpine) bases: git, openssh, curl, and Python 3 (+ pip, + a bare
 * `python`). Non-apt/non-apk bases still build; their toolchain must come from
 * the base image. If the base is already journeyman/runner-base, injection is skipped.
 */
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace @journeyman/sandbox -- dockerfile-wrap`
Expected: all tests PASS, including the pre-existing git/curl/skip tests (still satisfied — git/curl remain in the apt branch).

---

## Task 2: Python in the default Docker sandbox image (Debian)

**Files:**
- Modify: `docker/runner-base.Dockerfile:26-28`

- [ ] **Step 1: Add Python to the apt install**

Replace the existing install block:

```dockerfile
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
```

with:

```dockerfile
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git openssh-client ca-certificates curl \
      python3 python3-pip python-is-python3 \
 && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 2: Verify intent (no build required here)**

Confirm the file now lists `python3`, `python3-pip`, and `python-is-python3`. Image build is exercised in Task 7's optional build check.

---

## Task 3: Python in the worker image (Alpine, runs the local backend)

**Files:**
- Modify: `Dockerfile` — the `runtime-worker` stage apk line

- [ ] **Step 1: Locate the worker apk line**

Run: `grep -n "apk add" Dockerfile`
Expected: a line in the `runtime-worker` stage like
`RUN apk add --no-cache git openssh-client ca-certificates curl`

- [ ] **Step 2: Add Python + the bare-`python` symlink**

Replace that `runtime-worker` apk line with:

```dockerfile
RUN apk add --no-cache git openssh-client ca-certificates curl python3 py3-pip \
 && ln -sf /usr/bin/python3 /usr/bin/python
```

Only edit the `runtime-worker` stage. Leave `runtime-api`, `runtime-analytics`, `runtime-migrations`, and `runtime-web` unchanged — they do not run agent code.

---

## Task 4: Windows readiness Python probe — ADVISORY (TDD)

> **Decision (during execution):** Python on Windows is **advisory** — reported in
> the scorecard but it must NOT block agent startup (Windows boxes that never run
> Python should still start). This required making the readiness check support
> non-required (advisory) checks, a refinement over the original plan.

**Files:**
- Modify: `packages/windows-agent/src/readiness.ts`
- Test: `packages/windows-agent/src/readiness.test.ts`

- [ ] **Step 1: Add a failing test**

Append inside the existing `describe("runReadinessChecks", …)` in `packages/windows-agent/src/readiness.test.ts`:

```ts
  it("reports python advisorily — present in the scorecard but does not block startup", async () => {
    const root = mkdtempSync(join(tmpdir(), "jm-ready-"));
    const r = await runReadinessChecks({
      bashPath: process.execPath,
      workspaceRoot: root,
      probe: async (t) => t !== "python", // everything resolves except python
    });
    expect(r.ready).toBe(true); // advisory: missing python must not block
    const py = r.checks.find((c) => c.name === "python");
    expect(py?.ok).toBe(false);
    expect(py?.detail).toMatch(/Python 3/i);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace @journeyman/windows-agent -- readiness`
Expected: FAIL — no `python` check exists yet (`py` is `undefined`).

- [ ] **Step 3: Add the advisory python probe**

In `packages/windows-agent/src/readiness.ts`, give `push` a `required_` flag that
defaults to `true`, track required results separately, and add an advisory
`python` push after the `curl` line:

```ts
  const checks: ReadinessCheck[] = [];
  const required: boolean[] = [];
  // `required: false` makes a check advisory — reported but not a startup gate.
  const push = (name: string, ok: boolean, detail = "", required_ = true) => {
    checks.push({ name, ok, detail });
    if (required_) required.push(ok);
  };
  // … bash/git/node/curl unchanged …
  push("python", await opts.probe("python"), "python on PATH — advisory; install Python 3 if a workflow needs it", false);
  // … workspace unchanged …
  return { ready: required.every(Boolean), checks };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace @journeyman/windows-agent -- readiness`
Expected: PASS. The pre-existing "reports ready when … resolve" test still passes.

---

## Task 5: Docker config form note (UI)

**Files:**
- Modify: `packages/web/src/components/sandboxes/types/DockerConfigForm.tsx`

- [ ] **Step 1: Add the auto-provisioned note**

In `DockerConfigForm`, insert this note directly after the closing `)}` of the image-source conditional block (after line 49, before the `Network` `<Field …>`). It reuses `Code` (already imported) and matches the hint styling from `form-controls.tsx` (`text-xs leading-relaxed text-slate-500`):

```tsx
        <p className="text-xs leading-relaxed text-slate-500">
          The default runner image and any apt- or apk-based image you provide
          automatically include <Code>git</Code>, SSH, <Code>curl</Code>,{" "}
          <Code>node</Code>, and <Code>python3</Code> (with <Code>pip</Code>).
          Images built on other bases must install their own toolchain.
        </p>
```

`Code` is already imported on line 4 — no new imports needed.

- [ ] **Step 2: Sanity-check JSX**

Confirm the `<p>` sits between the image block and the `Network` `<Field>`, still inside the `<>…</>` fragment. (Full verification happens in the Task 7 typecheck.)

---

## Task 6: Documentation

**Files:**
- Create: `docs/sandbox-environment-reference.md`
- Modify: `docs/windows-sandbox-setup.md`

- [ ] **Step 1: Create the sandbox environment reference**

Create `docs/sandbox-environment-reference.md`:

```markdown
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

² Not auto-installed. The Windows agent **reports** Python at readiness
(`packages/windows-agent/src/readiness.ts`); install Python 3 on the box.

## Why `python` and not just `python3`

Installing the Python package provides `python3` but no bare `python`. Models
frequently type `python script.py`, so every image we control also provides a
`python` → `python3` alias (Debian: `python-is-python3`; Alpine: a symlink).

## What is *not* provisioned

No just-in-time tool installation and no per-language environment setup. If a
task needs a toolchain beyond the table above, use a custom Docker image (apt or
apk base) or provision the host (local / Windows).
```

- [ ] **Step 2: Update the Windows setup guide**

In `docs/windows-sandbox-setup.md`:

1. Add Python 3 to the prerequisites list (alongside Git for Windows / Node), e.g.:
   `- **Python 3** — install from python.org or the Microsoft Store; ensure \`python --version\` works in Git Bash.`
2. In the readiness scorecard section (the part listing `bash` / `git` / `node` /
   `curl` / `workspace`), add a `python` row:
   `| python | Python 3 on PATH — install Python 3 for Windows |`

Match the exact list/table formatting already used in that file.

---

## Task 7: Final verification (no commit)

**Files:** none — verification only.

- [ ] **Step 1: Run the changed-package test suites**

Run:
```bash
npm test --workspace @journeyman/sandbox -- dockerfile-wrap
npm test --workspace @journeyman/windows-agent -- readiness
```
Expected: both PASS.

- [ ] **Step 2: Typecheck + import boundaries (the single end-of-plan check)**

Run: `npm run check`
Expected: typecheck and `check:boundaries` both pass with no errors.

> If `npm run check` is too broad for the environment, fall back to
> `npm run typecheck`. `npm run check` is preferred because it also runs the
> import-boundary check.

- [ ] **Step 3: (Optional) Build the controlled images**

Only if Docker is available and you want runtime proof:
```bash
docker build -f docker/runner-base.Dockerfile -t jm-runner-base-check .
docker run --rm jm-runner-base-check sh -lc 'python --version && python3 --version && pip --version'
```
Expected: all three print versions.

- [ ] **Step 4: Leave changes uncommitted**

Per the requester's constraint, do **not** commit. Run `git status` and report the
modified/created files so the requester can review the working tree.

---

## Self-Review Notes

- **Spec coverage:** all six spec changes map to Tasks 1–6; spec "Verification" maps to Task 7.
- **Symlink everywhere:** Task 1 (apk branch), Task 2 (`python-is-python3`), Task 3 (`ln -sf`) — covered. Debian `runner-base` uses `python-is-python3`; Alpine worker + apk wrap use `ln -sf`.
- **Constraints honored:** no per-task commits; a single `npm run check` in Task 7; no worktree/branch (master).
- **Naming consistency:** readiness check name is `python` in both the impl and the test; wrap assertions match the exact strings emitted (`python-is-python3`, `ln -sf /usr/bin/python3 /usr/bin/python`).
```
