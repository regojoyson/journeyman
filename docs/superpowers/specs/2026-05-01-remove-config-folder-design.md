# Remove `config/` Folder

**Date:** 2026-05-01  
**Status:** Approved

## Context

The `config/` folder was originally the source of truth for pipeline configuration: product definitions, flow YAML files, server settings, and JSON schemas. Since then:

- Flows are now created and stored in PostgreSQL, managed via the flow editor UI.
- Product/provider/webhook config moved into the database or environment variables.
- `config/schemas/` was auto-generated from a `packages/pipeline` package that no longer exists.
- The only remaining live read of `pipeline.yaml` is `workspaces.baseDir`, which the worker already falls back to `JOURNEYMAN_BASE_DIR` env var.

The folder is dead weight. This spec removes it completely.

## Changes

### 1. Delete `config/` entirely

Remove all files under `config/`:

- `config/pipeline.yaml`
- `config/flows/default.yaml`
- `config/flows/full-flow.yaml`
- `config/flows/advanced-flow.yaml`
- `config/flows/opencode-flow.yaml`
- `config/schemas/flow.schema.json`
- `config/schemas/pipeline.schema.json`

### 2. Add `JOURNEYMAN_BASE_DIR` to `.env.example`

Add under the Worker / orchestrator section:

```
JOURNEYMAN_BASE_DIR=/path/to/your/workspaces
```

No code change needed — the worker already reads this env var as a fallback.

### 3. Simplify `load-worker-config.ts` and its caller

`packages/orchestrator/src/config/load-worker-config.ts` exists solely to read `workspaces.baseDir` from YAML. With that field moving to env, the file is unnecessary.

- Delete `packages/orchestrator/src/config/load-worker-config.ts`
- Delete `packages/orchestrator/src/config/` directory (if empty after removal)
- In `packages/orchestrator/src/cli-worker.ts`, replace:
  ```ts
  const workerCfg = loadWorkerConfig();
  const workspaceBaseDir = workerCfg.baseDir ?? process.env.JOURNEYMAN_BASE_DIR ?? join(tmpdir(), "journeyman-workspaces");
  ```
  with:
  ```ts
  const workspaceBaseDir = process.env.JOURNEYMAN_BASE_DIR ?? join(tmpdir(), "journeyman-workspaces");
  ```
- Remove the `import { loadWorkerConfig }` statement from `cli-worker.ts`.

### 4. Docs and README cleanup

Remove all references to `config/pipeline.yaml`, `config/flows/`, and `config/schemas/` from:

- `README.md` — remove config folder section, pipeline.yaml mentions, schema mentions
- Any other docs files under `docs/` that reference these paths

## What is NOT changing

- The `PipelineConfig` type in `packages/core/src/types/pipeline.types.ts` — it may still be used by `packages/core/src/interfaces/pipeline.interface.ts`. Only remove if unused (verify before touching).
- Flow storage in Postgres — unaffected.
- `.env.example` other than the one addition.

## Testing

- Run `npm run typecheck` — no errors.
- Start the worker (`npm run start:worker`) — it should boot and log the workspace base dir from env.
- Confirm no remaining references to `config/pipeline.yaml` or `config/flows/` in non-doc source files.
