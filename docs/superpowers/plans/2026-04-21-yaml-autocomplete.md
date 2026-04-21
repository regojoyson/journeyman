# YAML Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable VS Code autocomplete and inline validation for `config/pipeline.yaml` and `config/flows/*.yaml` by generating JSON Schema files from the existing Zod schemas.

**Architecture:** A `generate-schemas.ts` script in `packages/pipeline` uses `zod-to-json-schema` to convert `PipelineConfigSchema` and `FlowSchema` to JSON Schema files committed under `config/schemas/`. VS Code's YAML extension reads those schemas via `.vscode/settings.json`.

**Tech Stack:** `zod-to-json-schema`, `tsx`, Node.js `fs/path`, VS Code YAML extension (`redhat.vscode-yaml`)

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `packages/pipeline/src/generate-schemas.ts` | Script: convert Zod → JSON Schema, write to `config/schemas/` |
| Create | `config/schemas/pipeline.schema.json` | Generated JSON Schema for `pipeline.yaml` |
| Create | `config/schemas/flow.schema.json` | Generated JSON Schema for `config/flows/*.yaml` |
| Modify | `packages/pipeline/package.json` | Add `generate:schemas` script + `zod-to-json-schema` devDep |
| Modify | `package.json` (root) | Add `generate:schemas` workspace convenience script |
| Create | `.vscode/settings.json` | Map schemas to YAML file globs for VS Code YAML extension |
| Create | `.vscode/extensions.json` | Recommend `redhat.vscode-yaml` to contributors |

---

### Task 1: Install `zod-to-json-schema`

**Files:**
- Modify: `packages/pipeline/package.json`

- [ ] **Step 1: Install the package**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npm install --save-dev zod-to-json-schema -w packages/pipeline
```

Expected: `package-lock.json` updated, `packages/pipeline/package.json` now has `"zod-to-json-schema"` in `devDependencies`.

- [ ] **Step 2: Verify install**

```bash
node -e "import('zod-to-json-schema').then(m => console.log('ok', Object.keys(m)))"
```

Expected output contains `ok` and `zodToJsonSchema`.

- [ ] **Step 3: Commit**

```bash
git add packages/pipeline/package.json package-lock.json
git commit -m "chore: add zod-to-json-schema to pipeline devDependencies"
```

---

### Task 2: Write the schema generation script

**Files:**
- Create: `packages/pipeline/src/generate-schemas.ts`

- [ ] **Step 1: Create the script**

Create `packages/pipeline/src/generate-schemas.ts` with this exact content:

```typescript
import { zodToJsonSchema } from "zod-to-json-schema";
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { PipelineConfigSchema } from "./config/pipeline-schema.js";
import { FlowSchema } from "./config/flow-schema.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../..");
const outDir = resolve(repoRoot, "config/schemas");

mkdirSync(outDir, { recursive: true });

const comment =
  "Auto-generated from packages/pipeline/src/config/*-schema.ts — run npm run generate:schemas to update";

const pipelineSchema = {
  $comment: comment,
  ...(zodToJsonSchema(PipelineConfigSchema) as object),
};

const flowSchema = {
  $comment: comment,
  ...(zodToJsonSchema(FlowSchema) as object),
};

writeFileSync(
  resolve(outDir, "pipeline.schema.json"),
  JSON.stringify(pipelineSchema, null, 2) + "\n"
);
writeFileSync(
  resolve(outDir, "flow.schema.json"),
  JSON.stringify(flowSchema, null, 2) + "\n"
);

console.log("Generated config/schemas/pipeline.schema.json");
console.log("Generated config/schemas/flow.schema.json");
```

- [ ] **Step 2: Add the script to `packages/pipeline/package.json`**

In `packages/pipeline/package.json`, update `"scripts"`:

```json
"scripts": {
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "generate:schemas": "tsx src/generate-schemas.ts"
}
```

- [ ] **Step 3: Add root convenience script**

In root `package.json`, add to `"scripts"`:

```json
"generate:schemas": "npm run generate:schemas -w packages/pipeline"
```

The full scripts section becomes:

```json
"scripts": {
  "typecheck": "npm run typecheck --workspaces --if-present",
  "test": "npm test --workspaces --if-present",
  "start": "tsx packages/pipeline-server/src/cli-start.ts config/pipeline.yaml",
  "validate": "tsx packages/pipeline/src/cli.ts validate-config --config config/pipeline.yaml",
  "run-once": "tsx packages/pipeline/src/cli.ts run",
  "sweep": "tsx packages/pipeline/src/cli.ts sweep --config config/pipeline.yaml",
  "generate:schemas": "npm run generate:schemas -w packages/pipeline"
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/pipeline/src/generate-schemas.ts packages/pipeline/package.json package.json
git commit -m "feat: add generate:schemas script (zod-to-json-schema)"
```

---

### Task 3: Generate and commit the schema files

**Files:**
- Create: `config/schemas/pipeline.schema.json`
- Create: `config/schemas/flow.schema.json`

- [ ] **Step 1: Run the generation script**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npm run generate:schemas
```

Expected output:
```
Generated config/schemas/pipeline.schema.json
Generated config/schemas/flow.schema.json
```

- [ ] **Step 2: Verify pipeline schema has expected top-level keys**

```bash
cat config/schemas/pipeline.schema.json | head -20
```

Expected: output starts with `{`, contains `"$comment"`, `"type": "object"`, and `"required"` array that includes `"defaultFlow"` and `"products"`.

- [ ] **Step 3: Verify flow schema has expected top-level keys**

```bash
cat config/schemas/flow.schema.json | head -20
```

Expected: output starts with `{`, contains `"$comment"`, `"type": "object"`, and `"required"` array that includes `"name"`, `"providers"`, `"steps"`.

- [ ] **Step 4: Commit**

```bash
git add config/schemas/
git commit -m "feat: add generated JSON Schema files for pipeline and flow YAML"
```

---

### Task 4: Configure VS Code

**Files:**
- Create: `.vscode/settings.json`
- Create: `.vscode/extensions.json`

- [ ] **Step 1: Create `.vscode/settings.json`**

Create `.vscode/settings.json` with this exact content:

```json
{
  "yaml.schemas": {
    "./config/schemas/pipeline.schema.json": ["config/pipeline.yaml"],
    "./config/schemas/flow.schema.json": ["config/flows/*.yaml"]
  }
}
```

- [ ] **Step 2: Create `.vscode/extensions.json`**

Create `.vscode/extensions.json` with this exact content:

```json
{
  "recommendations": ["redhat.vscode-yaml"]
}
```

- [ ] **Step 3: Verify `.vscode/` now has three files**

```bash
ls .vscode/
```

Expected: `extensions.json  launch.json  settings.json`

- [ ] **Step 4: Commit**

```bash
git add .vscode/settings.json .vscode/extensions.json
git commit -m "feat: configure VS Code YAML extension for pipeline and flow schema autocomplete"
```

---

### Task 5: Smoke-test autocomplete in VS Code

**No code changes — verification only.**

- [ ] **Step 1: Open `config/pipeline.yaml` in VS Code**

Open the file. In the bottom status bar you should see `YAML` as the language mode. The YAML extension will load the schema silently.

- [ ] **Step 2: Verify field autocomplete**

Inside the `products:` block under an existing product, add a new line and type `con` — VS Code should suggest `concurrency`. Press Escape to dismiss without saving.

- [ ] **Step 3: Verify enum autocomplete**

Inside `repos:`, under `providerId:`, delete the current value and press `Ctrl+Space` — VS Code should show `github` and `gitlab` as the only options.

- [ ] **Step 4: Verify flow autocomplete**

Open `config/flows/full-flow.yaml`. Inside a step, add a new line and type `onF` — VS Code should suggest `onFailure` and show the enum values `fail`, `skip`, `retry`, `block`.

- [ ] **Step 5: Verify validation**

In `config/pipeline.yaml`, temporarily change `type: file` under `stateStorage` to `type: invalid` — VS Code should show a red underline. Revert the change.
