# Remote-only Docker Sandbox Connections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a Docker sandbox's daemon connection an explicit remote address (`tcp://…`) with no local-socket option and no `DOCKER_HOST`/default-socket fallback — `makeDockerClient` throws a clear error without a host — while internal tooling (`build:kit`, prune) keeps using the host's Docker.

**Architecture:** `DockerConnection` becomes `{ host, certDir? }`. `makeDockerClient` requires `host` (no fallback). The prune sweep targets the sandbox daemons read from the DB. `build:kit` uses the Docker CLI (push + `docker inspect` for the digest) instead of dockerode. `DOCKER_HOST` is removed from Journeyman entirely.

**Tech Stack:** TypeScript (Node ESM, `tsx`), `dockerode`, PostgreSQL via `pg`, React (web UI), Vitest, npm workspaces.

> **Commit / typecheck policy (per user request):** Do **not** commit per task. Run each task's tests as you go, but make a **single commit at the very end** (Task 8) after `npm run check` passes.

---

## Background — current state (verified)

- `packages/sandbox/src/backends/docker/docker-client.ts`:
  - `DockerConnection` = `{ kind: "local" | "remote"; socketPath?; host?; certDir? }`.
  - `makeDockerClient(connection?)` (line ~282): local branch tries `connection.socketPath` → `DOCKER_HOST` → default `/var/run/docker.sock` via `localSocketClient` (added in `d1aa0d0`, uses `existsSync`); remote branch parses `connection.host` + optional TLS.
  - `localSocketClient` (line ~270) calls `normalizeSocketPath` (line ~61); `normalizeSocketPath` is used **only** there.
  - `parseDockerHost` (remote host parse) is also used — keep it.
- `packages/sandbox/src/backends/docker/docker-client.test.ts`: has a `describe("makeDockerClient socket resolution")` block (4 tests: missing socket throws, `DOCKER_HOST` unix throws, tcp `DOCKER_HOST` no-throw, remote no-throw) added in `d1aa0d0`; imports `afterEach`.
- `?? { kind: "local" }` default callers: `api-server/src/composition.ts:162`, `sandbox/src/build/build-loop.ts` (`makeClient(cfg["connection"] ?? { kind: "local" })`), `sandbox/src/cli-sandbox-instance.ts:19`, `sandbox/src/test-connection.ts:17`, `orchestrator/src/cli-worker.ts:150` (verifyImageFresh) & `:181` (provisionDocker).
- Prune sweep: `orchestrator/src/cli-worker.ts` ~line 448 — `makeDockerClient({ kind: "local" })` + `pruneBuiltImages(client, new Set(refs))`. `listReadyImageRefs` (sandbox `db.ts`) returns ready refs.
- `compose.deploy.yml`: worker service sets `DOCKER_HOST: tcp://docker:2375`.
- `.env.example`: has a `DOCKER_HOST` guidance block (added earlier).
- `scripts/build-kit.mjs`: imports `makeDockerClient`, `registryAuthFromEnv`; has a `DOCKER_HOST` auto-discovery block; pushes via `client.pushImage(tag, auth)`.
- UI: `packages/web/src/components/sandboxes/types/DockerConfigForm.tsx` has `ConnKind = "local" | "remote"`, a connection `<select>`, a socket-path input, `readConfig`/`buildConfig` handling `kind`/`socketPath`.

---

## File Structure

**Modify:**
- `packages/sandbox/src/backends/docker/docker-client.ts` — `DockerConnection` type; `makeDockerClient` strict; delete `localSocketClient`, `normalizeSocketPath`, `existsSync` import.
- `packages/sandbox/src/backends/docker/docker-client.test.ts` — replace the socket-resolution tests.
- `packages/sandbox/src/db.ts` — add `listDockerSandboxConnections`.
- `packages/sandbox/src/db.test.ts` (or nearest sandbox db test) — test the new helper. *(If no such test file exists, create `packages/sandbox/src/kit/` style colocated test — see Task 2.)*
- `packages/sandbox/src/index.ts` — export `listDockerSandboxConnections`.
- `packages/sandbox/src/test-connection.ts` — drop `?? { kind: "local" }`.
- `packages/sandbox/src/build/build-loop.ts` — drop `?? { kind: "local" }`.
- `packages/sandbox/src/cli-sandbox-instance.ts` — drop `?? { kind: "local" }`.
- `packages/api-server/src/composition.ts` — drop `?? { kind: "local" }`.
- `packages/orchestrator/src/cli-worker.ts` — drop `?? { kind: "local" }` (×2); rewrite prune sweep to iterate sandbox connections.
- `scripts/build-kit.mjs` — Docker CLI push + digest; remove `DOCKER_HOST` discovery + dockerode imports.
- `packages/web/src/components/sandboxes/types/DockerConfigForm.tsx` — remote-only form.
- `compose.deploy.yml` — remove worker `DOCKER_HOST`.
- `.env.example` — remove the `DOCKER_HOST` block.
- `README.md`, `docs/deploy-docker-compose.md` — drop `DOCKER_HOST`; document sandbox host `tcp://docker:2375`.

No new SQL migration (decision: re-save old sandboxes manually).

---

### Task 1: `DockerConnection` remote-only + strict `makeDockerClient`

**Files:**
- Modify: `packages/sandbox/src/backends/docker/docker-client.ts`
- Test: `packages/sandbox/src/backends/docker/docker-client.test.ts`

- [ ] **Step 1: Replace the socket-resolution tests**

In `docker-client.test.ts`, replace the entire `describe("makeDockerClient socket resolution", …)` block with:

```ts
describe("makeDockerClient (remote-only)", () => {
  it("throws a clear error when no host is given", () => {
    expect(() => makeDockerClient({} as any))
      .toThrow(/explicit daemon host/i);
  });

  it("throws when host is an empty string", () => {
    expect(() => makeDockerClient({ host: "" }))
      .toThrow(/explicit daemon host/i);
  });

  it("builds a client for a tcp host", () => {
    expect(() => makeDockerClient({ host: "tcp://docker:2375" })).not.toThrow();
  });
});
```

If the `afterEach` import is now unused, drop it from the top `vitest` import (leave `describe, it, expect, vi`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @journeyman/sandbox -- docker-client`
Expected: FAIL — current `makeDockerClient` doesn't throw `/explicit daemon host/` (it falls back).

- [ ] **Step 3: Narrow the `DockerConnection` type**

Replace the interface:

```ts
/** How to reach a Docker daemon. Persisted on the sandbox row so any process can rebuild the client. */
export interface DockerConnection {
  /** Docker daemon TCP endpoint, e.g. "tcp://docker:2375" or "build-host:2376". Required. */
  host: string;
  /** Optional TLS cert dir containing ca.pem / cert.pem / key.pem. */
  certDir?: string;
}
```

- [ ] **Step 4: Rewrite `makeDockerClient` and delete the local helpers**

Replace the `localSocketClient` function AND the `makeDockerClient` function with:

```ts
/** Build an IDockerClient for a remote Docker daemon. Throws if no host is configured. */
export function makeDockerClient(connection: DockerConnection): IDockerClient {
  if (!connection?.host) {
    throw new Error(
      "Docker sandbox needs an explicit daemon host (e.g. tcp://docker:2375) — " +
        "no local socket / DOCKER_HOST fallback.",
    );
  }
  const { host, port } = parseDockerHost(connection.host);
  const opts: Docker.DockerOptions = { host, port };
  if (connection.certDir) {
    opts.ca = readFileSync(join(connection.certDir, "ca.pem"));
    opts.cert = readFileSync(join(connection.certDir, "cert.pem"));
    opts.key = readFileSync(join(connection.certDir, "key.pem"));
  }
  return new DockerodeClient(new Docker(opts));
}
```

Then delete the now-dead `normalizeSocketPath` function (search the file; it is only referenced by the removed `localSocketClient`). Remove `existsSync` from the `node:fs` import, leaving `import { readFileSync } from "node:fs";`. Update the doc comment on `DockerConnection.host`/`certDir` if it still mentions sockets.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w @journeyman/sandbox -- docker-client`
Expected: PASS.

- [ ] **Step 6: Typecheck sandbox (surfaces all the `kind`/`socketPath` users)**

Run: `npm run typecheck -w @journeyman/sandbox`
Expected: errors where code still references `connection.kind` / `socketPath` / `{ kind: "local" }` — those are fixed in Tasks 2 & 5. (Leave them for now; do not silence.)

---

### Task 2: `listDockerSandboxConnections` DB helper

**Files:**
- Modify: `packages/sandbox/src/db.ts`
- Modify: `packages/sandbox/src/index.ts`
- Test: `packages/sandbox/src/db-kit-connections.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// packages/sandbox/src/db-kit-connections.test.ts
import { describe, it, expect, vi } from "vitest";
import { listDockerSandboxConnections } from "./db.ts";

function fakeDb(rows: any[]) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe("listDockerSandboxConnections", () => {
  it("returns the connection objects that have a host", async () => {
    const db = fakeDb([
      { connection: { host: "tcp://docker:2375" } },
      { connection: { host: "tcp://build:2376", certDir: "/certs" } },
    ]);
    expect(await listDockerSandboxConnections(db)).toEqual([
      { host: "tcp://docker:2375" },
      { host: "tcp://build:2376", certDir: "/certs" },
    ]);
    expect(db.query.mock.calls[0][0]).toMatch(/from jm_sandboxes/i);
    expect(db.query.mock.calls[0][0]).toMatch(/type = 'docker'/i);
  });

  it("filters out rows with no connection or no host", async () => {
    const db = fakeDb([
      { connection: null },
      { connection: { certDir: "/x" } }, // no host
      { connection: { host: "tcp://ok:2375" } },
    ]);
    expect(await listDockerSandboxConnections(db)).toEqual([{ host: "tcp://ok:2375" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/sandbox -- db-kit-connections`
Expected: FAIL — `listDockerSandboxConnections` not exported.

- [ ] **Step 3: Implement the helper in `db.ts`**

Add near `listReadyImageRefs` (and import the type at the top if not already available — `db.ts` can import it):

```ts
import type { DockerConnection } from "./backends/docker/docker-client.ts";

/** Distinct daemons where docker-sandbox images are built (for the prune sweep). */
export async function listDockerSandboxConnections(db: Queryable): Promise<DockerConnection[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT config->'connection' AS connection
       FROM jm_sandboxes
      WHERE type = 'docker' AND config->'connection' IS NOT NULL`,
  );
  return rows
    .map((r) => r.connection as DockerConnection | null)
    .filter((c): c is DockerConnection => !!c?.host);
}
```

- [ ] **Step 4: Export it from `index.ts`**

In `packages/sandbox/src/index.ts`, add `listDockerSandboxConnections` to the existing `db.ts` re-export that already lists `listReadyImageRefs`:

```ts
export {
  markImagePending, clearImageState, claimPendingBuild,
  renewBuildLease, commitBuildResult, failBuild, applyImageStateOnSave,
  listReadyImageRefs, listDockerSandboxConnections,
} from "./db.ts";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w @journeyman/sandbox -- db-kit-connections`
Expected: PASS (2 tests).

---

### Task 3: `build:kit` → Docker CLI push + digest

**Files:**
- Modify: `scripts/build-kit.mjs`

- [ ] **Step 1: Replace the dockerode push with CLI push + digest read**

In `scripts/build-kit.mjs`:

1. Change the import line from
   `import { makeDockerClient, registryAuthFromEnv, upsertKitImage } from "@journeyman/sandbox";`
   to
   `import { upsertKitImage } from "@journeyman/sandbox";`

2. Delete the entire `if (!process.env.DOCKER_HOST) { … docker context inspect … }` auto-discovery block.

3. Delete these two lines (the dockerode client + auth):
   ```js
   const client = makeDockerClient();
   const auth = registryAuthFromEnv(process.env);
   ```

4. Replace the build/push loop body so push + digest use the CLI. The loop becomes:
   ```js
   for (const t of targets) {
     console.log(`\n=== build ${t.tag} (${t.dockerfile}) ===`);
     run("docker", ["build", "-f", t.dockerfile, "-t", t.tag, "."]);
     console.log(`\n=== push ${t.tag} ===`);
     run("docker", ["push", t.tag]);
     const repoDigest = execFileSync(
       "docker",
       ["inspect", "--format", "{{index .RepoDigests 0}}", t.tag],
       { encoding: "utf8" },
     ).trim();
     if (!repoDigest) {
       console.error(`ERROR: no RepoDigest for ${t.tag} after push`);
       process.exit(1);
     }
     console.log(`pushed ${t.role}: ${repoDigest}`);
     kit[t.role] = repoDigest;
   }
   ```
   (`run` and `execFileSync` are already imported/defined at the top of the file.)

- [ ] **Step 2: Syntax check**

Run: `node --check scripts/build-kit.mjs`
Expected: prints nothing (exit 0).

- [ ] **Step 3: Manual smoke (optional, needs a local registry)**

```bash
docker run -d -p 5000:5000 --name jm-test-registry registry:2
JOURNEYMAN_REGISTRY=localhost:5000 node scripts/build-kit.mjs
cat "${JOURNEYMAN_BASE_DIR:-$HOME/.journeyman}/kit/kit.json"   # base/bundle = localhost:5000/runner-*@sha256:…
docker rm -f jm-test-registry
```
Expected: `kit.json` has `@sha256:` digests. (Skip if no Docker handy; the digest path is exercised here, not in unit tests.)

---

### Task 4: Prune sweep uses sandbox connections

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Import the new helper**

In the `@journeyman/sandbox` import block in `cli-worker.ts`, add `listDockerSandboxConnections` alongside `listReadyImageRefs`:

```ts
  listReadyImageRefs, listDockerSandboxConnections, resolveKitRefs, registryAuthFromEnv,
```

- [ ] **Step 2: Rewrite the prune sweep body**

Replace the prune sweep's inner `try { … }` block (currently builds `makeDockerClient({ kind: "local" })` and prunes once) with:

```ts
          try {
            const keep = new Set(await listReadyImageRefs(pool));
            const connections = await listDockerSandboxConnections(pool);
            for (const conn of connections) {
              try {
                const removed = await pruneBuiltImages(
                  makeDockerClient(conn),
                  keep,
                  (line) => log.info({ line }, "prune"),
                );
                if (removed.length) log.info({ removed, host: conn.host }, "pruned orphaned built images");
              } catch (err) {
                log.warn({ err: String(err), host: conn.host }, "prune failed for daemon");
              }
            }
          } catch (err) {
            log.warn({ err: String(err) }, "image prune sweep failed");
          }
```

Also update the comment above the sweep from "Targets the local daemon only." to "Targets each docker sandbox's daemon (from the DB)."

- [ ] **Step 3: Drop the `?? { kind: "local" }` defaults (provision + verify)**

In `verifyImageFresh` (≈line 150) and `provisionDocker` (≈line 181), change:
```ts
const connection = (config as Record<string, unknown>)["connection"] ?? { kind: "local" };
```
to:
```ts
const connection = (config as Record<string, unknown>)["connection"] as import("@journeyman/sandbox").DockerConnection | undefined;
```
and pass `connection` directly to `makeDockerClient(connection as never)` / `makeDockerClient(connection as never)` — a missing connection now throws the clear error from Task 1. (Keep the existing variable names `client` / `dockerClient`.)

- [ ] **Step 4: Typecheck orchestrator**

Run: `npm run typecheck -w @journeyman/orchestrator`
Expected: PASS (no remaining `{ kind: "local" }` / `connection.kind` references).

---

### Task 5: Drop `{ kind: "local" }` defaults in the remaining callers

**Files:**
- Modify: `packages/sandbox/src/test-connection.ts`
- Modify: `packages/sandbox/src/build/build-loop.ts`
- Modify: `packages/sandbox/src/cli-sandbox-instance.ts`
- Modify: `packages/api-server/src/composition.ts`

- [ ] **Step 1: `test-connection.ts`**

Change:
```ts
const connection = (input.config.connection as DockerConnection | undefined) ?? { kind: "local" };
```
to:
```ts
const connection = input.config.connection as DockerConnection | undefined;
```
and the call to `deps.makeDockerClient(connection as DockerConnection)`. Update the deps type `makeDockerClient: (connection?: DockerConnection) => IDockerClient` → `(connection: DockerConnection) => IDockerClient`. A missing connection throws → already caught by the surrounding `try/catch`, returning `{ ok: false, error }`.

- [ ] **Step 2: `build-loop.ts`**

Change `const client = makeClient(cfg["connection"] ?? { kind: "local" });` to:
```ts
const client = makeClient(cfg["connection"]);
```
(`makeClient` default is `makeDockerClient`, which now throws on a missing connection — correct for a docker build target.)

- [ ] **Step 3: `cli-sandbox-instance.ts`**

Change `const client = makeDockerClient(sb.connection ?? { kind: "local" });` to:
```ts
const client = makeDockerClient(sb.connection as DockerConnection);
```
Add `import type { DockerConnection } from "@journeyman/sandbox";` if not present.

- [ ] **Step 4: `composition.ts`**

Change `const client = makeDockerClient(sb.connection ?? { kind: "local" });` to:
```ts
const client = makeDockerClient(sb.connection as DockerConnection);
```
Add the `DockerConnection` type import from `@journeyman/sandbox` if not present.

- [ ] **Step 5: Typecheck both packages**

Run: `npm run typecheck -w @journeyman/sandbox && npm run typecheck -w @journeyman/api-server`
Expected: PASS. Fix any leftover `kind`/`socketPath` references in test fixtures (e.g. `build-loop.test.ts` `target.config.connection` — drop `kind`, keep `host`).

---

### Task 6: Remote-only Docker sandbox UI

**Files:**
- Modify: `packages/web/src/components/sandboxes/types/DockerConfigForm.tsx`

- [ ] **Step 1: Remove the `local` connection kind from state**

Replace the top types + `DockerState`:
```ts
type ImageKind = "ref" | "dockerfile";

interface DockerState {
  host: string;
  imageKind: ImageKind; imageRef: string; dockerfile: string;
  network: "full" | "none";
}
```
(Delete `type ConnKind` and the `connKind` / `socketPath` fields.)

- [ ] **Step 2: Replace the connection fields in the form JSX**

Replace the `<Field … label="Connection">` block AND the two `{s.connKind === …}` blocks (the socket-path field and the remote-host field) with a single host field:
```tsx
        <Field icon={Globe} label="Daemon host"
          hint={<>Docker daemon over TCP. In the bundled compose stack use <Code>tcp://docker:2375</Code>;
            for a remote daemon, e.g. <Code>tcp://build-host:2376</Code>.</>}>
          <input className={inputCls} placeholder="tcp://docker:2375" value={s.host}
            onChange={(e) => set({ host: e.target.value })} />
        </Field>
```
Remove the now-unused `Plug` and `Terminal` icon imports (keep `Globe, Box, FileText, Network`).

- [ ] **Step 3: Update `readConfig` / `buildConfig`**

```ts
  readConfig: (raw) => {
    const connection = (raw.connection ?? {}) as { host?: string };
    const image = (raw.image ?? { kind: "ref", imageRef: "" }) as { kind?: ImageKind; imageRef?: string; content?: string };
    return {
      host: connection.host ?? "",
      imageKind: (image.kind ?? "ref"),
      imageRef: image.imageRef ?? "",
      dockerfile: image.content ?? "",
      network: (raw.network ?? "full"),
    };
  },
  buildConfig: (state) => {
    const s = state as unknown as DockerState;
    return {
      connection: { host: s.host },
      image: s.imageKind === "ref" ? { kind: "ref", imageRef: s.imageRef } : { kind: "dockerfile", content: s.dockerfile },
      network: s.network,
    };
  },
```

- [ ] **Step 4: Typecheck web**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS.

---

### Task 7: Deploy + env + docs cleanup

**Files:**
- Modify: `compose.deploy.yml`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/deploy-docker-compose.md`

- [ ] **Step 1: Remove `DOCKER_HOST` from the worker service**

In `compose.deploy.yml`, in the `worker:` service `environment:` block, delete the two lines:
```yaml
      # Default Docker engine for docker-workspace sandboxes (the built-in dind).
      DOCKER_HOST: tcp://docker:2375
```
(Leave `IS_SANDBOX: "1"` and the rest.)

- [ ] **Step 2: Remove the `DOCKER_HOST` block from `.env.example`**

Delete the comment block that begins `# Host-based dev only: dockerode …` through the `# DOCKER_HOST=unix:///Users/you/.rd/docker.sock` line.

- [ ] **Step 3: Update README**

In `README.md`, remove the Rancher/`DOCKER_HOST` callout under the runner-kit section (the blockquote beginning `> **Rancher Desktop / colima / rootless:**`). In the kit section, add a line:
> Docker sandboxes connect to an explicit daemon host. In the bundled compose stack, set the sandbox's host to `tcp://docker:2375`. Local dev Docker sandboxes need a reachable TCP daemon (otherwise use a Local-type sandbox).

- [ ] **Step 4: Update the deploy guide**

In `docs/deploy-docker-compose.md`, under "Docker workspace" setup, change the connection guidance to: Connection host = `tcp://docker:2375` (the built-in dind). Remove any remaining "Local socket / blank path / DOCKER_HOST" wording.

- [ ] **Step 5: Grep for stragglers**

Run:
```bash
grep -rn "DOCKER_HOST\|kind: \"local\"\|connKind\|socketPath\|normalizeSocketPath\|localSocketClient" \
  packages scripts compose.deploy.yml .env.example README.md docs \
  --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.yml" --include="*.md" --include="*.example" \
  | grep -v "docs/superpowers/"
```
Expected: no matches (or only inside the spec/plan under `docs/superpowers/`, which the `grep -v` excludes). Fix any code/doc straggler found.

---

### Task 8: Final typecheck + single commit

**Files:** none (verification + commit)

- [ ] **Step 1: Full sandbox test pass**

Run: `npm test -w @journeyman/sandbox`
Expected: PASS (incl. the new/updated `docker-client` and `db-kit-connections` tests).

- [ ] **Step 2: Full repo check**

Run: `npm run check`
Expected: PASS (`typecheck` across workspaces + `check:boundaries`). Fix any remaining type errors (most likely leftover `kind`/`socketPath` in a test fixture).

- [ ] **Step 3: Stage and commit (single commit)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(sandbox): Docker sandbox = explicit remote daemon only

Drop the local-socket connection kind and all daemon fallback: DockerConnection
is now { host, certDir? } and makeDockerClient throws without a host. Prune sweep
targets the sandbox daemons from the DB; build:kit pushes via the Docker CLI;
DOCKER_HOST removed from the worker, build:kit, and .env.example.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```
(Stage only this feature's files if unrelated WIP is present — mirror the prior session's selective-add approach.)

---

## Self-Review (completed during authoring)

- **Spec coverage:** §1 type → Task 1; §2 makeDockerClient → Task 1; §3 UI → Task 6; §4 build:kit → Task 3; §5 prune + helper → Tasks 2 & 4; §6 callers → Tasks 4 & 5; §7 deploy/env → Task 7; §8 docs → Task 7. All mapped. No migration (spec decision 4) — none added.
- **Placeholder scan:** none — every code step shows full content.
- **Type consistency:** `DockerConnection = { host, certDir? }`, `makeDockerClient(connection: DockerConnection)`, `listDockerSandboxConnections(db): DockerConnection[]`, prune uses `conn.host` — consistent across tasks.
- **Note:** `build-loop.test.ts` fixtures use `{ kind: "remote", host }`; Task 5 Step 5 calls out dropping the now-removed `kind` from such fixtures.
