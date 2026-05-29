# Codebase-Type-Aware Workspace Setup with Docker

## Context

The Journeyman workspace pipeline creates a local directory, clones repos, and starts a feature branch. The AI agent (Claude SDK) then runs Bash commands in that workspace. Currently there is no environment preparation — the agent doesn't know if it's working on a .NET, Node.js, Python, or other project, and no dependencies are installed before it starts.

The goal is to support diverse codebases (particularly Windows/.NET) by:
1. Giving org admins a **Dockerfile Registry** where they define named, reusable Dockerfiles
2. Letting flow authors pick a Dockerfile by name on the `create-workspace` step
3. Detecting the codebase type automatically after cloning so the correct setup command is chosen
4. Building the named Dockerfile into a local image (cached) and running setup inside it

The agent's Bash commands that invoke toolchain tools (build, test) will be prompted to use `docker run` with the same built image.

---

## Dockerfile Registry

### Concept

The Dockerfile Registry is an org-scoped catalogue of named Dockerfiles managed in the admin UI. Each entry is a named, reusable build environment:

| Field | Description |
|---|---|
| `name` | Identifier used in workflow config (e.g. `dotnet48`, `node20-custom`). Pattern: `[a-zA-Z0-9_\-]{1,64}`. |
| `description` | Human-readable description of what the image provides. |
| `content` | The full Dockerfile text. |

Flow authors select a Dockerfile by name on the `create-workspace` step. At runtime, the worker builds the Dockerfile into a local Docker image (cached by content hash) and uses it for all `docker run` calls in that workspace.

### Why Dockerfiles instead of image names

| Image name approach | Dockerfile approach |
|---|---|
| References a pre-built image on a registry | Builds the image locally on the worker |
| Requires pushing images to a registry | Self-contained — no registry needed |
| Hard to audit what's in the image | Content is version-controlled in the DB |
| Harder to customise for org tooling | Just edit the Dockerfile in the UI |
| Auto-detection picks a generic default | Flow author chooses explicitly |

---

## Design

### Workflow flow

```
create-workspace (dockerfileName config)
  → clone-repos
  → detect-codebase-type          ← determines codebaseType + packageManager
  → build-image                   ← fetches Dockerfile, builds image, outputs imageTag
  → setup-workspace               ← runs setup cmd inside the built image
  → start-feature-branch
  → implement / custom-ai         ← receives imageTag for docker run prompts
```

`build-image` and `setup-workspace` are separate steps deliberately: the image build may be slow and benefits from explicit visibility in the run viewer, and `imageTag` needs to be a first-class bindable output so downstream steps (implement, custom-ai) can reference it without re-deriving it.

### Docker build pattern (`build-image` step)

```bash
# Build from stdin — no build context needed
docker build -t jm-{orgSlug}-{dockerfileName}:{contentHash} -
```

Dockerfile content is piped via stdin. The worker skips the build if the tag already exists locally (`docker image inspect`), so repeated runs on the same worker machine are fast.

### Docker run pattern (`setup-workspace` step)

```bash
docker run --rm \
  -v {repoDir}:/workspace \
  -w /workspace \
  {imageTag} \
  sh -c "{setupCmd}"
```

`imageTag` is bound from `build-image` output. `setupCmd` is derived from `codebaseType` + `packageManager` (from `detect-codebase-type`).

### Image tagging and caching

```
jm-{orgSlug}-{dockerfileName}:{sha256[:12] of content}
```

Before building, the worker runs `docker image inspect <tag>`. If the image already exists locally, the build step is skipped. This avoids redundant rebuilds when the same Dockerfile is used across multiple workflow runs on the same worker machine.

---

## Dockerfile Registry: DB Schema

**Migration file:** `packages/migrations/src/sql/033_dockerfiles.sql`

```sql
CREATE TABLE IF NOT EXISTS jm_dockerfiles (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES jm_orgs(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  description        TEXT,
  content            TEXT NOT NULL,
  -- Validation state written back by the validate-dockerfile worker task
  validation_status  TEXT NOT NULL DEFAULT 'unvalidated'
                       CHECK (validation_status IN ('unvalidated','pending','valid','invalid')),
  validation_error   TEXT,          -- stderr/build log on failure; null on success
  validated_at       TIMESTAMPTZ,   -- timestamp of last completed validation attempt
  created_by         UUID NOT NULL REFERENCES jm_users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jm_dockerfiles_org_name_unique UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_jm_dockerfiles_org ON jm_dockerfiles (org_id);
```

Org-scoped only — Dockerfiles are a shared, admin-managed resource. No user-level scope.

`validation_status` transitions:

```
unvalidated  ──► pending  ──► valid
                          └──► invalid
```

On `POST` (create) or `PATCH` (update content): status resets to `"pending"` and a `validate-dockerfile` Conductor task is dispatched automatically. On re-validate (manual button): same reset + dispatch.

---

## Dockerfile Registry: Backend Package

**New package:** `packages/dockerfiles/`

Follows the same structure as `packages/mcp/` and `packages/secrets/`.

### `src/db.ts`

```typescript
export type DockerfileValidationStatus = "unvalidated" | "pending" | "valid" | "invalid";

export interface DockerfileRow {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  content: string;
  validationStatus: DockerfileValidationStatus;
  validationError: string | null;
  validatedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function listDockerfiles(pool: Pool, orgId: string): Promise<DockerfileRow[]>
export async function getDockerfile(pool: Pool, orgId: string, id: string): Promise<DockerfileRow | null>
export async function getDockerfileByName(pool: Pool, orgId: string, name: string): Promise<DockerfileRow | null>
export async function insertDockerfile(pool: Pool, input: InsertDockerfileInput): Promise<DockerfileRow>
export async function updateDockerfile(pool: Pool, orgId: string, id: string, patch: UpdateDockerfilePatch): Promise<DockerfileRow | null>
export async function deleteDockerfile(pool: Pool, orgId: string, id: string): Promise<boolean>

// Called by ValidateDockerfileStepHandler via worker token
export async function setValidationResult(
  pool: Pool,
  orgId: string,
  id: string,
  result: { status: "valid" | "invalid"; error: string | null },
): Promise<void>
```

Name validation: `/^[a-zA-Z0-9_\-]{1,64}$/` — enforced in `insertDockerfile` and `updateDockerfile`.

### `src/routes/org-dockerfiles.ts`

All routes require authentication. Create/update/delete require `role: "admin"`.

```
GET    /api/orgs/:orgId/dockerfiles                → list all Dockerfiles for the org
POST   /api/orgs/:orgId/dockerfiles                → create new Dockerfile (admin); auto-dispatches validation
GET    /api/orgs/:orgId/dockerfiles/:id            → get single Dockerfile (content + validation status)
PATCH  /api/orgs/:orgId/dockerfiles/:id            → update name/description/content (admin); resets + re-dispatches validation
DELETE /api/orgs/:orgId/dockerfiles/:id            → delete (admin)
POST   /api/orgs/:orgId/dockerfiles/:id/validate   → manually trigger re-validation (admin); resets status to "pending", dispatches task
PATCH  /api/orgs/:orgId/dockerfiles/:id/validation → internal endpoint called by worker token to write back validation result
```

`GET /api/orgs/:orgId/dockerfiles` returns `{ id, name, description, validationStatus, validatedAt, updatedAt }` — no `content` in list response.
`GET /api/orgs/:orgId/dockerfiles/:id` returns the full record including `content` and `validationError`.

The `PATCH …/validation` endpoint accepts a worker service token (`Authorization: Bearer <JOURNEYMAN_WORKER_TOKEN>`) in addition to user JWTs, so the `ValidateDockerfileStepHandler` can write results back without a user session. It accepts `{ status: "valid" | "invalid", error: string | null }`.

### `src/routes/index.ts`

```typescript
export async function registerDockerfileRoutes(app: FastifyInstance, pool: Pool) {
  await registerOrgDockerfileRoutes(app, pool);
}
```

### Registration in API server

**File:** `packages/api-server/src/server.ts`

```typescript
import { registerDockerfileRoutes } from "@journeyman/dockerfiles";

// inside buildServer(), alongside other feature route registrations:
await registerDockerfileRoutes(app, c.pool);
```

---

## Dockerfile Registry: Frontend UI

### Admin page

**File:** `packages/web/src/routes/AdminDockerfilesPage.tsx`

Follows the same pattern as `AdminMcpsPage.tsx`:

- Fetches `GET /api/orgs/:orgId/dockerfiles` on mount; re-polls every 5 seconds while any row has `validationStatus === "pending"` (stops polling once all rows are settled)
- Table columns: name, description, **validation badge**, updated date, action buttons (Validate, Edit, Delete)
- "Add Dockerfile" button → `AddDockerfileModal`
- `AddDockerfileModal`: form with name (text), description (text), content (`<textarea>`). On save, status will immediately show as "pending" since validation is dispatched automatically.
- `EditDockerfileModal`: pre-fills from `GET …/:id` (fetches full content + validation details). On save, status resets to "pending".
- Delete confirms before calling `DELETE`
- "Validate" action button calls `POST …/:id/validate` and reloads the row

**Validation status badge:**

| `validationStatus` | Badge |
|---|---|
| `"unvalidated"` | grey — "Not validated" |
| `"pending"` | animated spinner — "Validating…" |
| `"valid"` | green — "Valid" |
| `"invalid"` | red — "Invalid" (click to see `validationError` in a tooltip or modal) |

The `"invalid"` badge is clickable: opens a `ValidationErrorModal` showing the raw Docker build log (`validationError` field) so the admin can diagnose the Dockerfile issue.

### Routing and sidebar

**File:** `packages/web/src/App.tsx`

```tsx
<Route path="/admin/dockerfiles"
  element={role === "admin"
    ? <AdminDockerfilesPage orgId={activeOrgId} />
    : <Navigate to="/" replace />}
/>
```

**File:** `packages/web/src/components/Sidebar.tsx`

Add to `ADMIN_ITEMS`:
```typescript
{ to: "/admin/dockerfiles", icon: "🐳", label: "Dockerfiles" },
```

---

## Changes to `create-workspace` Step

### Config field: `dockerfileName`

`dockerfileName` replaces the earlier `containerImage` text field. It is a select populated at runtime from the Dockerfile Registry.

**File:** `packages/steps/src/repos/create-workspace.meta.ts`

```typescript
export const createWorkspaceConfigSchema = z.object({
  ref: z.string().min(1),
  dockerfileName: z.string().optional(),
});

export const createWorkspaceOutputSchema: OutputSchema = {
  workspaceDir:   { type: "string" },
  folderName:     { type: "string" },
  dockerfileName: { type: "string" },  // empty string if not configured
};

export const createWorkspaceInputFields: InputFields = {
  ref:            { shape: { type: "string" }, label: "Ref", required: true },
  dockerfileName: { shape: { type: "string" }, label: "Dockerfile" },
};
```

**File:** `packages/steps/src/repos/create-workspace.tsx`

Use a custom `ConfigForm` (like `CustomAiConfigForm`) instead of declarative `configFields` for the `dockerfileName` field — it needs to fetch the list from the API:

```typescript
interface CreateWorkspaceConfig {
  ref: string;
  dockerfileName?: string;
}

export function CreateWorkspaceConfigForm({
  config, onChange, readOnly,
}: StepFormProps<CreateWorkspaceConfig>) {
  const orgId = useOrgId();
  const [dockerfiles, setDockerfiles] = useState<{ id: string; name: string; description: string | null }[]>([]);

  useEffect(() => {
    if (!orgId) return;
    fetch(`/api/orgs/${orgId}/dockerfiles`, { credentials: "include" })
      .then(r => r.ok ? r.json() as Promise<typeof dockerfiles> : Promise.resolve([]))
      .then(setDockerfiles)
      .catch(() => {});
  }, [orgId]);

  return (
    <>
      <div className="je-props__field">
        <label className="je-props__label">Ref</label>
        <input
          className={inputCls}
          value={config.ref ?? ""}
          disabled={readOnly}
          onChange={e => onChange({ ...config, ref: e.target.value })}
        />
      </div>
      <div className="je-props__field">
        <label className="je-props__label">Dockerfile</label>
        <select
          className={inputCls}
          value={config.dockerfileName ?? ""}
          disabled={readOnly}
          onChange={e => onChange({ ...config, dockerfileName: e.target.value || undefined })}
        >
          <option value="">(none — skip setup)</option>
          {dockerfiles.map(d => (
            <option key={d.id} value={d.name}>{d.name}{d.description ? ` — ${d.description}` : ""}</option>
          ))}
        </select>
      </div>
    </>
  );
}

export const createWorkspaceStep: StepDefinition<CreateWorkspaceConfig> = {
  // ...existing fields...
  defaultConfig: { ref: "", dockerfileName: undefined },
  configFields: {},          // declarative fields replaced by ConfigForm
  ConfigForm: CreateWorkspaceConfigForm,
  outputSchema: createWorkspaceOutputSchema,
};
```

### Step handler: pass `dockerfileName` through

**File:** `packages/orchestrator/src/workers/steps/create-workspace-step-handler.ts`

```typescript
const dockerfileName = (input.dockerfileName as string | undefined) ?? "";
return {
  kind: "success",
  output: { workspaceDir, folderName, dockerfileName },
};
```

---

## New Types in `@journeyman/core`

**File:** `packages/core/src/types/git.types.ts`

```typescript
export type CodebaseType =
  | "dotnet-core"       // .NET Core / .NET 5+ — cross-platform Linux container
  | "dotnet-framework"  // .NET Framework 4.x — Windows container only
  | "nodejs" | "python"
  | "java-maven" | "java-gradle"
  | "go" | "rust" | "unknown";

export type PackageManager = "npm" | "yarn" | "pnpm";

export interface DetectCodebaseTypeOptions extends SessionOptions {
  repos: Array<{ repoDir: string }>;
  signal?: AbortSignal;
}

export type WorkerCapability =
  | "dotnet-core"
  | "dotnet-framework"   // requires Windows worker
  | "nodejs" | "python"
  | "java-maven" | "java-gradle"
  | "go" | "rust"
  | "any";               // worker accepts all tasks (default Linux worker)

export interface DetectedRepo {
  repoDir: string;
  codebaseType: CodebaseType;
  packageManager?: PackageManager;       // nodejs only
  windowsContainerRequired?: boolean;    // true for dotnet-framework
  requiredCapability: WorkerCapability;
}

export interface DetectCodebaseTypeResult extends SessionResult {
  repos: DetectedRepo[];
  error?: string;
}

export interface BuildImageOptions extends SessionOptions {
  dockerfileName: string;       // name key used in image tag
  dockerfileContent: string;    // raw Dockerfile text
  orgSlug: string;              // image tag prefix: jm-{orgSlug}-{name}:{hash}
  signal?: AbortSignal;
}

export interface BuildImageResult extends SessionResult {
  imageTag: string;   // fully qualified tag; empty string if dockerfileContent was empty
  built: boolean;     // true = image was built; false = cache hit
  error?: string;
}

export interface ValidateDockerfileOptions {
  dockerfileId: string;
  dockerfileContent: string;
  orgSlug: string;
  signal?: AbortSignal;
}

export interface ValidateDockerfileResult {
  valid: boolean;
  error: string | null;
}

export interface SetupWorkspaceOptions extends SessionOptions {
  repos: DetectedRepo[];
  imageTag: string;             // from BuildImageResult.imageTag; empty = skip
  signal?: AbortSignal;
}

export interface SetupWorkspaceRepoResult {
  repoDir: string;
  codebaseType: CodebaseType;
  success: boolean;
  error?: string;
}

export interface SetupWorkspaceResult extends SessionResult {
  repos: SetupWorkspaceRepoResult[];
  error?: string;
}
```

Also add optional `codebaseType?: CodebaseType` to `CloneResult` and `RepoInfo`.

---

## New Methods on `ICodingCLI`

**File:** `packages/core/src/interfaces/coding-cli.interface.ts`

```typescript
detectCodebaseType(opts: DetectCodebaseTypeOptions): Promise<DetectCodebaseTypeResult>;
buildImage(opts: BuildImageOptions): Promise<BuildImageResult>;
validateDockerfile(opts: ValidateDockerfileOptions): Promise<ValidateDockerfileResult>;
setupWorkspace(opts: SetupWorkspaceOptions): Promise<SetupWorkspaceResult>;
```

---

## New Operations in `coding-cli` (Claude provider)

### `detect-codebase-type.ts`
**File:** `packages/coding-cli/src/providers/claude/operations/detect-codebase-type.ts`

Pure Node.js — no AI. For each `repoDir`, reads the directory and checks for indicator files in priority order:

| Indicator | `codebaseType` | Notes |
|---|---|---|
| `*.sln` or `*.csproj` | `dotnet-core` or `dotnet-framework` | see .NET detection below |
| `package.json` | `nodejs` | |
| `pyproject.toml` / `requirements.txt` / `setup.py` | `python` | |
| `pom.xml` | `java-maven` | |
| `build.gradle` / `build.gradle.kts` | `java-gradle` | |
| `go.mod` | `go` | |
| `Cargo.toml` | `rust` | |
| (none) | `unknown` | |

For `nodejs`, check lockfile: `yarn.lock` → `yarn`, `pnpm-lock.yaml` → `pnpm`, else `npm`.

#### .NET Detection: Core vs Framework

When `.sln` or `.csproj` files are found, read the `<TargetFramework>` (or `<TargetFrameworks>`) element:

| `<TargetFramework>` pattern | `codebaseType` | Notes |
|---|---|---|
| `net[0-9]{2,3}` — e.g. `net45`, `net462`, `net481` | `dotnet-framework` | Windows container only |
| `netcoreapp*` — e.g. `netcoreapp3.1` | `dotnet-core` | |
| `net[5-9].*` / `net[5-9]` — e.g. `net6.0`, `net8.0` | `dotnet-core` | |
| `netstandard*` | `dotnet-core` | |
| Multiple targets | If any `net[0-9]{2,3}` exists → `dotnet-framework` | |
| Unreadable / no target element | `dotnet-core` | Safe default |

**`windowsContainerRequired`** is set to `true` for `dotnet-framework`.

### `build-image.ts`
**File:** `packages/coding-cli/src/providers/claude/operations/build-image.ts`

Pure Node.js — uses `execFile` to build a Docker image from Dockerfile content.

#### Interface

```typescript
export interface BuildImageOptions extends SessionOptions {
  dockerfileName: string;      // used in image tag
  dockerfileContent: string;   // raw Dockerfile text
  orgSlug: string;             // used in image tag prefix
  signal?: AbortSignal;
}

export interface BuildImageResult extends SessionResult {
  imageTag: string;   // fully qualified tag: jm-{orgSlug}-{name}:{hash}
  built: boolean;     // true = new build; false = cache hit, skipped
  error?: string;
}
```

#### Image tag computation

```typescript
import { createHash } from "node:crypto";

const hash = createHash("sha256").update(opts.dockerfileContent).digest("hex").slice(0, 12);
const imageTag = `jm-${opts.orgSlug}-${opts.dockerfileName}:${hash}`;
```

#### Build with cache check

```typescript
const inspectResult = await execFileP("docker", ["image", "inspect", imageTag]).catch(() => null);
if (inspectResult) {
  return { imageTag, built: false };
}

// Build from stdin — no build context needed
await execFileP("docker", ["build", "-t", imageTag, "-"], {
  input: opts.dockerfileContent,
  signal: opts.signal,
});

return { imageTag, built: true };
```

#### Errors

If `docker build` exits non-zero, the error includes the full `stderr` output (scrubbed of any secrets) so the failure message in the run viewer is diagnostic.

---

### `validate-dockerfile.ts`
**File:** `packages/coding-cli/src/providers/claude/operations/validate-dockerfile.ts`

Same as `build-image` but for validation: builds a temporary image, captures any error output, then always removes the temporary image.

```typescript
export interface ValidateDockerfileOptions {
  dockerfileId: string;
  dockerfileContent: string;
  orgSlug: string;
  signal?: AbortSignal;
}

export interface ValidateDockerfileResult {
  valid: boolean;
  error: string | null;  // Docker build stderr on failure
}
```

```typescript
const tempTag = `jm-validate-${dockerfileId}:${hash}`;

try {
  await execFileP("docker", ["build", "-t", tempTag, "-"], {
    input: dockerfileContent,
    signal,
  });
  return { valid: true, error: null };
} catch (err) {
  const e = err as { stderr?: string; message: string };
  return { valid: false, error: e.stderr?.trim() || e.message };
} finally {
  // Always clean up the temp image; ignore errors
  await execFileP("docker", ["rmi", tempTag]).catch(() => {});
}
```

---

### `setup-workspace.ts`
**File:** `packages/coding-cli/src/providers/claude/operations/setup-workspace.ts`

Pure Node.js — uses `execFile` to run the setup command inside an already-built image. **Does not build the image** — that is `build-image`'s responsibility.

#### Interface

```typescript
export interface SetupWorkspaceOptions extends SessionOptions {
  repos: DetectedRepo[];
  imageTag: string;       // from build-image output; empty = skip
  signal?: AbortSignal;
}
```

#### Skip condition

If `opts.imageTag` is empty, return per-repo success with a logged warning:

```typescript
if (!opts.imageTag) {
  return { repos: opts.repos.map(r => ({ repoDir: r.repoDir, codebaseType: r.codebaseType, success: true })) };
}
```

#### Setup commands per codebase type

| `codebaseType` | `packageManager` | Setup command |
|---|---|---|
| `dotnet-core` | — | `dotnet restore` |
| `dotnet-framework` | — | `nuget restore` |
| `nodejs` | `npm` | `npm ci` |
| `nodejs` | `yarn` | `yarn install --frozen-lockfile` |
| `nodejs` | `pnpm` | `pnpm install --frozen-lockfile` |
| `python` | — | `pip install -r requirements.txt` (if exists) else `pip install -e .` |
| `java-maven` | — | `mvn dependency:resolve -q` |
| `java-gradle` | — | `gradle dependencies --quiet` |
| `go` | — | `go mod download` |
| `rust` | — | `cargo fetch` |
| `unknown` | — | no-op (success, log warning) |

#### Platform-aware `docker run`

`opts.imageTag` is passed directly from `build-image` output.

**Linux worker:**
```typescript
execFile("docker", [
  "run", "--rm",
  "-v", `${repoDir}:/workspace`,
  "-w", "/workspace",
  opts.imageTag,
  "sh", "-c", setupCmd,
])
```

**Windows worker (`windowsContainerRequired === true`):**
```typescript
execFile("docker", [
  "run", "--rm",
  "-v", `${repoDir}:C:\\workspace`,
  "-w", "C:\\workspace",
  opts.imageTag,
  "cmd", "/c", setupCmd,
])
```

#### Guard: Linux worker receiving a `dotnet-framework` task

```typescript
if (repo.windowsContainerRequired && process.platform !== "win32") {
  return { kind: "failure", failure: {
    errorClass: "WindowsContainerRequired",
    message: `Repo ${repo.repoDir} requires a Windows worker. `
           + `Deploy one with JOURNEYMAN_WORKER_CAPABILITIES=dotnet-framework.`,
    retryable: false,
  }};
}
```

### Stubs in Gemini, Codex, OpenCode providers

Throw `new Error("GeminiProvider.buildImage not implemented")`, `"GeminiProvider.validateDockerfile not implemented"`, `"GeminiProvider.detectCodebaseType not implemented"`, `"GeminiProvider.setupWorkspace not implemented"` etc.

---

## New Step Handlers in `orchestrator`

### `DetectCodebaseTypeStepHandler`
**File:** `packages/orchestrator/src/workers/steps/detect-codebase-type-step-handler.ts`

- `stepType = "detect-codebase-type"`
- Input: `repos` (array of `{ repoDir }` from clone-repos output)
- Calls `coding.detectCodebaseType({ repos, sessionId, signal })`
- Output: `{ repos: DetectedRepo[] }`

### `BuildImageStepHandler`
**File:** `packages/orchestrator/src/workers/steps/build-image-step-handler.ts`

- `stepType = "build-image"`
- Constructor deps: `{ coding, apiBaseUrl, workerToken }`
- Input:
  - `dockerfileName` — string (bound from `create-workspace` output)
  - `orgId`, `orgSlug` — from step context
- Fetches Dockerfile content: `GET {apiBaseUrl}/api/orgs/{orgId}/dockerfiles/{name}` using worker token
- Calls `coding.buildImage({ dockerfileName, dockerfileContent, orgSlug, sessionId, signal })`
- Output: `{ imageTag, built }`
- On build failure: returns `kind: "failure"` with Docker build stderr as the error message — surfaced in the run viewer so the user can diagnose the Dockerfile

### `ValidateDockerfileStepHandler`
**File:** `packages/orchestrator/src/workers/steps/validate-dockerfile-step-handler.ts`

- `stepType = "validate-dockerfile"` — dispatched by the API server, not by user-built flows
- Constructor deps: `{ coding, apiBaseUrl, workerToken }`
- Input: `{ dockerfileId, dockerfileContent, orgId, orgSlug }`
- Calls `coding.validateDockerfile({ dockerfileId, dockerfileContent, orgSlug, signal })`
- On completion (success or failure): calls `PATCH {apiBaseUrl}/api/orgs/{orgId}/dockerfiles/{dockerfileId}/validation` with `{ status, error }` using worker token
- Output: `{ valid, error }` (also stored back in DB via the PATCH call)
- Does **not** fail the Conductor task on invalid Dockerfile — the validation result is informational; only a network/infrastructure error should fail the task itself

### `SetupWorkspaceStepHandler`
**File:** `packages/orchestrator/src/workers/steps/setup-workspace-step-handler.ts`

- `stepType = "setup-workspace"`
- Constructor deps: `{ coding, workerCapabilities }`
- Input:
  - `repos` — array of `DetectedRepo` (bound from `detect-codebase-type` output)
  - `imageTag` — string (bound from `build-image` output)
- Calls `coding.setupWorkspace({ repos, imageTag, sessionId, signal })`
- Output: `{ repos: SetupWorkspaceRepoResult[] }`
- On partial failure: returns `kind: "failure"` with combined error message

#### Worker env vars for API access

```bash
JOURNEYMAN_API_BASE_URL=http://<server>:3000    # base URL of the API server
JOURNEYMAN_WORKER_TOKEN=<service-token>         # auth token for worker → API calls
```

Used by `BuildImageStepHandler` (fetch Dockerfile content) and `ValidateDockerfileStepHandler` (write back validation result). Issued by the org admin, stored in the worker's env. Routes that accept this token check `Authorization: Bearer <token>` against a stored hash.

---

## New Step Metadata in `steps`

### `detect-codebase-type.meta.ts`
**File:** `packages/steps/src/repos/detect-codebase-type.meta.ts`

```typescript
STEP_TYPE = "detect-codebase-type"
LABEL = "Detect Codebase Type"
CATEGORY = "Workspace"
DESCRIPTION = "Detect the language/framework type of each cloned repository."

inputFields = {
  repos: { shape: { type: "array", items: { type: "ref", name: "Repo" } }, required: true, bindOnly: true }
}

outputSchema = {
  repos: { type: "array", items: { type: "ref", name: "DetectedRepo" } }
}
```

### `build-image.meta.ts`
**File:** `packages/steps/src/repos/build-image.meta.ts`

```typescript
STEP_TYPE = "build-image"
LABEL = "Build Image"
CATEGORY = "Workspace"
DESCRIPTION = "Build a Docker image from the workflow's configured Dockerfile. Skips if the image was already built on this worker."

inputFields = {
  dockerfileName: { shape: { type: "string" }, label: "Dockerfile name", required: true, bindOnly: true }
}

outputSchema = {
  imageTag: { type: "string" },   // jm-{orgSlug}-{name}:{hash}
  built:    { type: "boolean" },  // false = cache hit
}
```

### `setup-workspace.meta.ts`
**File:** `packages/steps/src/repos/setup-workspace.meta.ts`

```typescript
STEP_TYPE = "setup-workspace"
LABEL = "Setup Workspace"
CATEGORY = "Workspace"
DESCRIPTION = "Install dependencies for each repo by running the setup command inside the built Docker image."

inputFields = {
  repos:     { shape: { type: "array", items: { type: "ref", name: "DetectedRepo" } }, required: true, bindOnly: true },
  imageTag:  { shape: { type: "string" }, label: "Image tag", required: true, bindOnly: true },
}

outputSchema = {
  repos: { type: "array", items: { type: "ref", name: "SetupResult" } }
}
```

Add `.tsx` UI components for all three new steps following the `create-workspace.tsx` pattern.

---

## Worker Capability Routing

### Architecture: Server + Separate Linux Worker + Separate Windows Worker

All three components run on **separate machines**. The server (Conductor + API) is never co-located with workers. Both workers poll Conductor over HTTP — the server never initiates connections to workers.

```
┌──────────────────────────────┐
│       Server Machine         │
│  Conductor (task broker)     │
│  API Server (REST + SSE)     │
└──────────────┬───────────────┘
               │  HTTP poll (worker-initiated)
        ┌──────┴───────┐
        ▼              ▼
┌───────────────────┐  ┌───────────────────────┐
│  Linux Worker     │  │  Windows Worker        │
│  Machine          │  │  Machine               │
│                   │  │                        │
│  cli-worker.ts    │  │  cli-worker.ts         │
│  Docker Linux     │  │  Docker Windows        │
│  containers       │  │  containers mode       │
│                   │  │                        │
│  CAPABILITIES=    │  │  CAPABILITIES=         │
│  dotnet-core,     │  │  dotnet-framework      │
│  nodejs,python,   │  │                        │
│  go,rust,…        │  │  BASE_DIR=             │
│                   │  │  C:\journeyman-ws      │
│  BASE_DIR=        │  │                        │
│  /opt/jm-ws       │  │  Git for Windows +     │
│                   │  │  Node.js + Docker      │
└───────────────────┘  └───────────────────────┘
```

Both workers are **stateless pollers** — no shared filesystem. Each creates its workspace on local disk, runs the task, and reports back to Conductor.

| Aspect | Linux worker | Windows worker |
|---|---|---|
| `JOURNEYMAN_BASE_DIR` | `/tmp/journeyman-workspaces` | `C:\journeyman-workspaces` |
| Docker mode | Linux containers (default) | Windows containers mode |
| Volume mount | `-v /host/path:/workspace` | `-v C:\host\path:C:\workspace` |
| Container shell | `sh -c "<cmd>"` | `cmd /c "<cmd>"` |

### Worker Capability Declaration

```bash
# Linux worker
JOURNEYMAN_WORKER_CAPABILITIES=dotnet-core,nodejs,python,java-maven,java-gradle,go,rust,any

# Windows worker
JOURNEYMAN_WORKER_CAPABILITIES=dotnet-framework,dotnet-core
```

If `JOURNEYMAN_WORKER_CAPABILITIES` is unset the worker defaults to `["any"]`.

### Conductor Task Domain Routing

When `detect-codebase-type` returns `requiredCapability: "dotnet-framework"`, the orchestrator tags subsequent tasks with `domain: "dotnet-framework"`. Only workers that declared `dotnet-framework` will poll that domain.

### Capability Mismatch: Fast-Fail

`DetectCodebaseTypeStepHandler` fast-fails if the detected capability is incompatible with the current worker:

```typescript
if (detected && !workerCapabilities.includes(detected) && !workerCapabilities.includes("any")) {
  return { kind: "failure", failure: {
    errorClass: "WorkerCapabilityMismatch",
    message: `Requires capability "${detected}" but worker supports: ${workerCapabilities.join(", ")}`,
    retryable: false,
  }};
}
```

### Mapping: `codebaseType` → `requiredCapability`

| `codebaseType` | `requiredCapability` |
|---|---|
| `dotnet-framework` | `"dotnet-framework"` |
| `dotnet-core` | `"dotnet-core"` |
| `nodejs` | `"nodejs"` |
| `python` | `"python"` |
| `java-maven` | `"java-maven"` |
| `java-gradle` | `"java-gradle"` |
| `go` | `"go"` |
| `rust` | `"rust"` |
| `unknown` | `"any"` |

---

## Register New Handlers in Worker

**File:** `packages/orchestrator/src/cli-worker.ts`

```typescript
const rawCaps = process.env.JOURNEYMAN_WORKER_CAPABILITIES;
const workerCapabilities: WorkerCapability[] = rawCaps
  ? (rawCaps.split(",").map(s => s.trim()) as WorkerCapability[])
  : ["any"];

const apiBaseUrl = process.env.JOURNEYMAN_API_BASE_URL ?? "";
const workerToken = process.env.JOURNEYMAN_WORKER_TOKEN ?? "";

registry.register(new DetectCodebaseTypeStepHandler({ coding, workerCapabilities }));
registry.register(new BuildImageStepHandler({ coding, apiBaseUrl, workerToken }));
registry.register(new ValidateDockerfileStepHandler({ coding, apiBaseUrl, workerToken }));
registry.register(new SetupWorkspaceStepHandler({ coding, workerCapabilities }));
```

`ValidateDockerfileStepHandler` is registered on all workers — any available worker can run a validation task. Validation tasks carry no domain, so they go to the default `"any"` queue.

---

## CodingCLIStep Union Update

**File:** `packages/core/src/types/coding.types.ts`

Add `"detectCodebaseType"`, `"buildImage"`, `"validateDockerfile"`, and `"setupWorkspace"` to `CodingCLIStep`.

---

## Agent Context: How the AI Uses the Container Image

For `custom-ai` and `implement` steps that receive `dockerfileName` from `create-workspace`, the step handler reconstructs the image tag to include in the AI prompt. The tag formula is the same as in `setup-workspace.ts` — derive it from the already-fetched Dockerfile content.

For Linux containers:
```
This is a {codebaseType} project.
To run build, test, or other toolchain commands, use:
  docker run --rm -v {repoDir}:/workspace -w /workspace {imageTag} <cmd>
```

For Windows containers (`dotnet-framework`):
```
This is a .NET Framework project running on a Windows worker.
  docker run --rm -v {repoDir}:C:\workspace -w C:\workspace {imageTag} cmd /c "<cmd>"
```

---

## Windows Compatibility Audit

| File | Finding | Action |
|---|---|---|
| `packages/git-provider/src/providers/github/operations/clone-repos.ts:61` | `` `${workspaceDir}/${folderName}` `` hardcoded `/` | **Fixed** — use `join()` |
| `packages/coding-cli/src/providers/claude/operations/checkout-repo.ts` | `date +%s` in SDK prompt | **OK** — Git Bash handles this |
| `packages/coding-cli/src/providers/claude/operations/cleanup-repos.ts` | `process.env.HOME` guard | **OK** — Node.js maps from `USERPROFILE` |
| `packages/orchestrator/src/workspace/directory-workspace-provider.ts` | `tmpdir()`, `join()`, `mkdir()`, `rm()` | **OK** — cross-platform |

### Windows Worker System Prerequisites

| Dependency | Purpose |
|---|---|
| **Node.js v20+ LTS** | Runs `cli-worker.ts` |
| **Git for Windows** | `git clone`, `git checkout`; provides `bash.exe` for Claude Agent SDK |
| **Docker Desktop (Windows containers mode)** | Runs Windows images for `dotnet-framework` repos |

---

## Files to Create / Modify

| File | Action |
|---|---|
| **DB & Backend** | |
| `packages/migrations/src/sql/033_dockerfiles.sql` | New — `jm_dockerfiles` table with validation columns |
| `packages/dockerfiles/package.json` | New package manifest |
| `packages/dockerfiles/src/db.ts` | New — CRUD + `setValidationResult` |
| `packages/dockerfiles/src/routes/org-dockerfiles.ts` | CRUD + `/validate` + `/validation` routes |
| `packages/dockerfiles/src/routes/index.ts` | Route registration |
| `packages/api-server/src/server.ts` | Register `registerDockerfileRoutes`; dispatch `validate-dockerfile` Conductor task on POST/PATCH |
| **Frontend** | |
| `packages/web/src/routes/AdminDockerfilesPage.tsx` | New — table with validation badges, re-validate button, `ValidationErrorModal` |
| `packages/web/src/App.tsx` | Add `/admin/dockerfiles` route |
| `packages/web/src/components/Sidebar.tsx` | Add "Dockerfiles" sidebar entry |
| **Core types** | |
| `packages/core/src/types/git.types.ts` | Add `CodebaseType`, `WorkerCapability`, `DetectedRepo`, `BuildImageOptions/Result`, `ValidateDockerfileOptions/Result`, `DetectCodebaseTypeOptions/Result`, `SetupWorkspaceOptions/Result` |
| `packages/core/src/interfaces/coding-cli.interface.ts` | Add `detectCodebaseType`, `buildImage`, `validateDockerfile`, `setupWorkspace` |
| `packages/core/src/types/coding.types.ts` | Add 4 new values to `CodingCLIStep` |
| **coding-cli** | |
| `packages/coding-cli/src/providers/claude/operations/detect-codebase-type.ts` | New — pure Node.js detection |
| `packages/coding-cli/src/providers/claude/operations/build-image.ts` | New — cache-aware `docker build` |
| `packages/coding-cli/src/providers/claude/operations/validate-dockerfile.ts` | New — temp build + cleanup |
| `packages/coding-cli/src/providers/claude/operations/setup-workspace.ts` | New — platform-aware `docker run` using `imageTag` |
| `packages/coding-cli/src/providers/claude/index.ts` | Wire all four new methods |
| `packages/coding-cli/src/providers/gemini/index.ts` | Stub all four new methods |
| `packages/coding-cli/src/providers/codex/index.ts` | Stub all four new methods |
| `packages/coding-cli/src/providers/opencode/index.ts` | Stub all four new methods |
| **orchestrator** | |
| `packages/orchestrator/src/workers/steps/create-workspace-step-handler.ts` | Pass `dockerfileName` through in output |
| `packages/orchestrator/src/workers/steps/detect-codebase-type-step-handler.ts` | New — capability check + fast-fail |
| `packages/orchestrator/src/workers/steps/build-image-step-handler.ts` | New — fetches Dockerfile content, calls `coding.buildImage` |
| `packages/orchestrator/src/workers/steps/validate-dockerfile-step-handler.ts` | New — calls `coding.validateDockerfile`, writes result back via API |
| `packages/orchestrator/src/workers/steps/setup-workspace-step-handler.ts` | New — runs `coding.setupWorkspace` with `imageTag` from input |
| `packages/orchestrator/src/workers/worker-harness.ts` | Wire task domain polling from `workerCapabilities` |
| `packages/orchestrator/src/cli-worker.ts` | Read `JOURNEYMAN_WORKER_CAPABILITIES`, `JOURNEYMAN_API_BASE_URL`, `JOURNEYMAN_WORKER_TOKEN`; register 4 new handlers |
| **steps** | |
| `packages/steps/src/repos/create-workspace.meta.ts` | Replace `containerImage` with `dockerfileName` |
| `packages/steps/src/repos/create-workspace.tsx` | Replace configField with `ConfigForm` + dynamic Dockerfile select |
| `packages/steps/src/repos/detect-codebase-type.meta.ts` | New step metadata |
| `packages/steps/src/repos/detect-codebase-type.tsx` | New step UI component |
| `packages/steps/src/repos/build-image.meta.ts` | New step metadata |
| `packages/steps/src/repos/build-image.tsx` | New step UI component |
| `packages/steps/src/repos/setup-workspace.meta.ts` | New step metadata — `imageTag` bindOnly input |
| `packages/steps/src/repos/setup-workspace.tsx` | New step UI component |
| `packages/steps/src/catalog.ts` | Register all three new steps |
| `packages/steps/src/registry.ts` | Register all three new step UI components |

---

## Verification

```bash
# Type-check the full monorepo
npm run typecheck

# Import boundary check
npm run check:boundaries

# Run migrations against a local DB
npm run migrate

# --- Dockerfile validation ---
#   1. Admin creates a Dockerfile named "node20" with content "FROM node:20-alpine"
#   2. Verify row appears with validationStatus: "pending" immediately after save
#   3. Worker picks up validate-dockerfile task; builds temp image, removes it
#   4. Row updates to validationStatus: "valid" within a few seconds
#   5. Edit Dockerfile to invalid content (e.g. "FROM nonexistent:image")
#   6. Verify validationStatus changes to "invalid" and validationError shows build log
#   7. Click "Validate" button — verify status resets to "pending" then resolves

# --- End-to-end workflow test ---
#   1. Admin creates a Dockerfile named "node20" with content "FROM node:20-alpine"
#   2. Build flow:
#      create-workspace (dockerfileName=node20)
#      → clone-repos
#      → detect-codebase-type
#      → build-image          (dockerfileName bound from create-workspace)
#      → setup-workspace      (repos from detect, imageTag from build-image)
#   3. Trigger a run — verify step by step:
#      - create-workspace output: { workspaceDir, folderName, dockerfileName: "node20" }
#      - detect-codebase-type output: { repos: [{ codebaseType: "nodejs", requiredCapability: "nodejs", … }] }
#      - build-image output: { imageTag: "jm-{org}-node20:{hash}", built: true }
#      - second run on same worker: build-image output has built: false (cache hit)
#      - setup-workspace runs npm ci inside the built image; success

# --- Windows worker smoke test ---
#   1. Create Dockerfile named "dotnet48" with content:
#      FROM mcr.microsoft.com/dotnet/framework/sdk:4.8
#   2. Verify validation completes on a Windows worker (Docker Windows containers mode)
#   3. Build flow: create-workspace (dockerfileName=dotnet48) → clone-repos
#      → detect-codebase-type → build-image → setup-workspace
#   4. On Windows worker: JOURNEYMAN_WORKER_CAPABILITIES=dotnet-framework
#   5. Verify build-image builds the Windows container image
#   6. Verify setup-workspace uses cmd /c and C:\workspace volume mount
```
