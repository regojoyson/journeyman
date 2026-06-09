# Docker sandbox = explicit remote daemon only — design

**Date:** 2026-06-09
**Status:** Approved (pending spec review)

## Problem

A Docker sandbox's daemon connection currently allows a **"Local socket"** kind, and
when its socket path is blank, `makeDockerClient` silently **guesses** the daemon:
explicit `socketPath` → `DOCKER_HOST` → default `/var/run/docker.sock`. When the guess
is wrong (e.g. Rancher Desktop, where `/var/run/docker.sock` doesn't exist), the failure
surfaces late as a cryptic `connect ENOENT /var/run/docker.sock`.

We want sandbox Docker connections to be **explicit and fail loudly**: a sandbox must
carry a real daemon address, and if it's missing or unreachable, throw a clear error —
no local-socket option, no fallback, no default.

## Decisions (locked)

1. **Remote-only sandbox connections** ("Interpretation A"). The "Local socket"
   connection kind is removed entirely; a Docker sandbox is always an explicit
   remote daemon (`tcp://…`, optional TLS).
2. **Strictness is scoped to sandbox connections** ("Option 1"). Internal host
   tooling keeps using the machine's Docker:
   - `build:kit` uses the **Docker CLI** (which resolves the daemon via the active
     `docker context`).
   - The prune sweep targets the **sandbox daemons** (read from the DB), not an
     ambient daemon.
3. **`DOCKER_HOST` is no longer used by Journeyman.** Removed from the worker
   service, from `build:kit`, and from `.env.example`. It remains a standard Docker
   CLI variable a user's shell may set, but Journeyman never references it.
4. **No data migration** for existing rows. Old `{kind:"local"}` docker sandboxes
   have no host and will throw the clear error when next used; the operator re-saves
   them in the UI (which now requires a host).
5. This **supersedes/reverts** the prior `localSocketClient` existence-check
   (commit `d1aa0d0`) — the entire local-socket branch is deleted.

## Component changes

### 1. `DockerConnection` type (`packages/sandbox/src/backends/docker/docker-client.ts`)

```ts
// before: { kind: "local" | "remote"; socketPath?; host?; certDir? }
export interface DockerConnection {
  /** Docker daemon TCP endpoint, e.g. "tcp://docker:2375" or "build-host:2376". Required. */
  host: string;
  /** Optional TLS cert dir containing ca.pem / cert.pem / key.pem. */
  certDir?: string;
}
```

`kind` and `socketPath` are removed.

### 2. `makeDockerClient` — strict, no fallback

The whole local branch (explicit socket → `DOCKER_HOST` → default socket), plus the
`localSocketClient` helper, the `existsSync` import, and the now-dead
`normalizeSocketPath` (and its test) are removed. New behavior:

```ts
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

`parseDockerHost` stays (remote host parsing). `connection` is now required.

### 3. Sandbox UI (`packages/web/src/components/sandboxes/types/DockerConfigForm.tsx`)

- Remove the connection-kind `<select>` ("Local socket" / "Remote daemon") and the
  socket-path input.
- Keep a single **Daemon host** field, prefilled with the hint `tcp://docker:2375`,
  plus the optional TLS cert dir.
- Saved config becomes `{ connection: { host, ...(certDir ? { certDir } : {}) } }`.
- The local `ConnKind` type and related state are removed.

### 4. `build:kit` → Docker CLI (`scripts/build-kit.mjs`)

- Replace the dockerode push (`makeDockerClient().pushImage`) with the Docker CLI:
  - `docker build -f <dockerfile> -t <tag> .` (already CLI)
  - `docker push <tag>`
  - read the digest via `docker inspect --format '{{index .RepoDigests 0}}' <tag>`
    → yields `<repo>@sha256:…`.
- Remove the `DOCKER_HOST` auto-discovery block (the CLI resolves the daemon via the
  active `docker context`).
- Drop the `makeDockerClient` / `registryAuthFromEnv` imports from this script.
- Private-registry push relies on a prior `docker login` (standard); the bundled/local
  registry needs no auth. The inline `kit_images` register (via `pg`) is unchanged.

### 5. Prune sweep (`packages/orchestrator/src/cli-worker.ts`)

New DB helper in `packages/sandbox/src/db.ts`:

```ts
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

Prune sweep iterates the distinct sandbox daemons, isolating per-daemon failures:

```ts
const keep = new Set(await listReadyImageRefs(pool));
for (const conn of await listDockerSandboxConnections(pool)) {
  try {
    const removed = await pruneBuiltImages(makeDockerClient(conn), keep, (l) => log.info({ line: l }, "prune"));
    if (removed.length) log.info({ removed, host: conn.host }, "pruned orphaned built images");
  } catch (err) {
    log.warn({ err: String(err), host: conn.host }, "prune failed for daemon");
  }
}
```

No docker sandboxes configured → empty list → no-op. No `DOCKER_HOST` use.

### 6. Callers that defaulted to `{ kind: "local" }`

Remove the `?? { kind: "local" }` defaults so the real connection is passed (a missing
one throws the §2 error):

- `packages/api-server/src/composition.ts` (`makeDockerClient(sb.connection …)`)
- `packages/sandbox/src/build/build-loop.ts` (`makeClient(cfg["connection"] …)`)
- `packages/sandbox/src/cli-sandbox-instance.ts`
- `packages/orchestrator/src/cli-worker.ts` (`verifyImageFresh`, `provisionDocker`)

### 7. Deploy + env cleanup

- `compose.deploy.yml`: remove `DOCKER_HOST: tcp://docker:2375` from the **worker**
  service. The dind address now lives only in the docker **sandbox's** `connection.host`.
- `.env.example`: remove the `DOCKER_HOST` guidance block.
- `scripts/build-kit.mjs`: remove the `DOCKER_HOST` auto-discovery (covered in §4).

### 8. Docs

- `README.md` + `docs/deploy-docker-compose.md`: drop `DOCKER_HOST` notes; document
  that a Docker sandbox in the deployed stack uses host `tcp://docker:2375`, and that
  local dev Docker sandboxes need a TCP daemon (otherwise use local-type sandboxes).

## Error handling

- Missing/blank `connection.host` → `makeDockerClient` throws a clear, actionable
  message (used at provision, build, and "Test connection").
- Unreachable daemon → dockerode surfaces the connection error on first use (ping /
  provision); the prune sweep isolates this per-daemon and continues.

## Testing

- `docker-client.test.ts`: remove the local-socket / `DOCKER_HOST` / existence tests;
  add `makeDockerClient` throws without a `host`, connects with a `host`, and applies
  TLS when `certDir` is set. Remove `normalizeSocketPath` tests.
- New `listDockerSandboxConnections` test (distinct rows, filters out connections
  without a host) with a fake `Queryable`.
- Update any test fixtures/fakes that build connections with `kind` / `socketPath`.
- Prune-sweep behavior: covered via the `listDockerSandboxConnections` + per-daemon
  iteration unit pieces (the sweep wiring stays in `cli-worker.ts`).

## Out of scope

- Automatic migration of old `{kind:"local"}` rows (decision 4: re-save manually).
- Adding a dind service to the dev compose stack (dev Docker sandboxes still require a
  reachable TCP daemon; local-type sandboxes are the default dev path).
- Any change to the `local` **sandbox type** (the no-isolation, in-process runner) —
  untouched; only the Docker sandbox's **connection** is affected.
