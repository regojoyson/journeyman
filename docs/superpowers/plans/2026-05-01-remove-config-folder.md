# Remove `config/` Folder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the dead `config/` folder, replace its only live usage (`workspaces.baseDir`) with an env var, and scrub all `config/pipeline.yaml` / `config/flows/` / `config/schemas/` references from docs.

**Architecture:** The `config/` folder was the old file-based config layer. Flows now live in Postgres (managed via the UI); product/provider config lives in the database; `workspaces.baseDir` is the sole surviving read and moves to `JOURNEYMAN_BASE_DIR` env var. The YAML loader (`load-worker-config.ts`) is deleted; `cli-worker.ts` reads the env var directly.

**Tech Stack:** TypeScript, Node.js, npm workspaces. No new dependencies.

---

## File Map

| Action | Path |
|---|---|
| **Delete** | `config/` (entire directory — pipeline.yaml, flows/*, schemas/*) |
| **Modify** | `.env.example` |
| **Modify** | `packages/orchestrator/src/cli-worker.ts` |
| **Delete** | `packages/orchestrator/src/config/load-worker-config.ts` |
| **Modify** | `README.md` |
| **Delete** | `docs/configuration.md` |
| **Modify** | `docs/quickstart.md` |
| **Modify** | `docs/setup.md` |
| **Modify** | `docs/flows.md` |
| **Modify** | `docs/pipeline-server.md` |
| **Modify** | `docs/providers.md` |
| **Modify** | `docs/products.md` |
| **Modify** | `docs/new-product.md` |
| **Modify** | `docs/troubleshooting.md` |

---

## Task 1: Delete `config/` folder

**Files:** Delete `config/` entirely.

- [ ] **Step 1: Delete the folder**

```bash
rm -rf config/
```

- [ ] **Step 2: Verify it's gone**

```bash
ls config/ 2>&1
# Expected: ls: config/: No such file or directory
```

---

## Task 2: Add `JOURNEYMAN_BASE_DIR` to `.env.example`

**Files:** Modify `.env.example`

- [ ] **Step 1: Open `.env.example` and locate the Worker section**

Find the block that starts with:
```
# --- Worker / orchestrator (optional — sensible defaults) ---
```

- [ ] **Step 2: Add `JOURNEYMAN_BASE_DIR` as the first uncommented variable in that block**

Replace:
```
# --- Worker / orchestrator (optional — sensible defaults) ---
# WORKER_ID=worker-1
# RUN_SYNC_INTERVAL_MS=2000
# CYCLE_VISIT_LIMIT=100
# CONDUCTOR_BASE_URL=http://localhost:8080/api
```

With:
```
# --- Worker / orchestrator (optional — sensible defaults) ---
# Root directory under which each run gets its own workspace subdirectory.
# Each run creates: <JOURNEYMAN_BASE_DIR>/<ticketId>-<timestamp>/
# Falls back to <os.tmpdir()>/journeyman-workspaces when not set.
JOURNEYMAN_BASE_DIR=/your/path/to/workspaces

# WORKER_ID=worker-1
# RUN_SYNC_INTERVAL_MS=2000
# CYCLE_VISIT_LIMIT=100
# CONDUCTOR_BASE_URL=http://localhost:8080/api
```

---

## Task 3: Simplify `cli-worker.ts` — inline env read, remove YAML loader

**Files:** Modify `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Remove the `loadWorkerConfig` import**

Find and delete this line (around line 11):
```ts
import { loadWorkerConfig } from "./config/load-worker-config.ts";
```

- [ ] **Step 2: Replace the two-line config read with a direct env read**

Find (around lines 65–66):
```ts
const workerCfg = loadWorkerConfig();
const workspaceBaseDir = workerCfg.baseDir ?? process.env.JOURNEYMAN_BASE_DIR ?? join(tmpdir(), "journeyman-workspaces");
```

Replace with:
```ts
const workspaceBaseDir = process.env.JOURNEYMAN_BASE_DIR ?? join(tmpdir(), "journeyman-workspaces");
```

---

## Task 4: Delete `load-worker-config.ts`

**Files:** Delete `packages/orchestrator/src/config/load-worker-config.ts` and the now-empty directory.

- [ ] **Step 1: Delete the file and directory**

```bash
rm packages/orchestrator/src/config/load-worker-config.ts
rmdir packages/orchestrator/src/config/
```

- [ ] **Step 2: Verify**

```bash
ls packages/orchestrator/src/config/ 2>&1
# Expected: ls: packages/orchestrator/src/config/: No such file or directory
```

---

## Task 5: Update `README.md`

**Files:** Modify `README.md`

- [ ] **Step 1: Update repo layout — remove `config/` line**

Find in the repository layout block:
```
├── config/                      Your pipeline.yaml + flows/
```
Delete that line entirely.

- [ ] **Step 2: Replace the entire `## Configuration` section**

Find the section that begins with:
```markdown
## Configuration

Runtime configuration lives in **`config/pipeline.yaml`**. The worker reads it on startup; most fields can also be overridden by environment variables (env vars win when both are set).
```
and ends just before `## Commands` (approximately lines 67–97).

Replace the entire section with:
```markdown
## Configuration

All runtime configuration is set via environment variables in `.env`. Copy `.env.example` to `.env` and fill in values.

The key worker variable is `JOURNEYMAN_BASE_DIR` — the root directory under which each run creates its own workspace subdirectory (e.g. `<JOURNEYMAN_BASE_DIR>/PROJ-123-2026-05-01T14-00-00Z/`). Falls back to `<os.tmpdir()>/journeyman-workspaces` when not set.

Flows and product/provider configuration are managed through the web UI and stored in the database.
```

- [ ] **Step 3: Fix the `### Sample flow` reference**

Find:
```markdown
This is [`config/flows/advanced-flow.yaml`](config/flows/advanced-flow.yaml), an end-to-end ticket → PR workflow with approval checkpoints.
```

Replace with:
```markdown
This is an example of an end-to-end ticket → PR workflow with approval checkpoints, as seen in the flow editor.
```

- [ ] **Step 4: Remove the stale `Configuration` link from the Reference section**

Find:
```markdown
- [Configuration](docs/configuration.md) — `pipeline.yaml` field reference
```
Delete that line entirely.

- [ ] **Step 5: Update the `## What it does` paragraph**

Find:
```markdown
The orchestration is entirely driven by YAML flow definitions — the same flow works across products by swapping adapters.
```

Replace with:
```markdown
The orchestration is entirely driven by flow definitions built in the flow editor — the same flow works across products by swapping adapters.
```

---

## Task 6: Delete `docs/configuration.md`

This file is 770 lines documenting `pipeline.yaml` fields that no longer exist. There is nothing to preserve.

- [ ] **Step 1: Delete the file**

```bash
rm docs/configuration.md
```

---

## Task 7: Update `docs/quickstart.md`

**Files:** Modify `docs/quickstart.md`

- [ ] **Step 1: Find and remove Step 3 "Write `config/pipeline.yaml`"**

Find the section starting with:
```markdown
## 3. Write `config/pipeline.yaml`
```
Delete the entire section (heading through the closing YAML block), which ends before the next `##` heading.

- [ ] **Step 2: Find and remove Step 4 "Write `config/flows/default.yaml`"**

Find the section starting with:
```markdown
## 4. Write `config/flows/default.yaml`
```
Delete the entire section (heading through the closing YAML block).

- [ ] **Step 3: Renumber remaining steps if needed and add env var note**

After Step 2 (env setup), add or update the step to mention `JOURNEYMAN_BASE_DIR`:

```markdown
Set `JOURNEYMAN_BASE_DIR` in `.env` to the path where you want run workspaces created (e.g. `/tmp/journeyman-workspaces`). This is optional — it falls back to the OS temp dir.
```

- [ ] **Step 4: Remove the webhook step that references pipeline.yaml**

Find:
```markdown
1. Add webhook to `pipeline.yaml`:
```
Replace any `pipeline.yaml` snippet with a note that webhook secrets are configured in the UI under product settings.

---

## Task 8: Update `docs/setup.md`

**Files:** Modify `docs/setup.md`

- [ ] **Step 1: Remove the `pipeline.yaml` entry from the table of contents**

Find in the TOC:
```markdown
4. [Instance-level config (`pipeline.yaml`)](#4-instance-level-config-pipelineyaml)
```
Delete that line.

- [ ] **Step 2: Delete section 4 entirely**

Find:
```markdown
## 4. Instance-level config (`pipeline.yaml`)
```
Delete the entire section up to the next `##` heading.

- [ ] **Step 3: Remove the `config/flows/` step**

Find:
```markdown
Create `config/flows/default.yaml`. This is the flow `defaultFlow: default` references.
```
Delete the surrounding step block (including the YAML example).

- [ ] **Step 4: Remove the `Create config/flows/cidms-secure.yaml` step**

Find:
```markdown
Create `config/flows/cidms-secure.yaml` with the extra phases.
```
Delete the surrounding step and replace with:
```markdown
Create the flow in the UI flow editor. The extra phases need to be registered in the phase catalog (see [phases.md](phases.md) for the "custom phase" section).
```

- [ ] **Step 5: Remove the `npx journeyman serve --config` line**

Find:
```markdown
npx journeyman serve --config path/to/pipeline.yaml   # custom config
```
Delete that line.

- [ ] **Step 6: Fix the "Remove a product" and "Change the default flow" steps**

Find:
```markdown
1. Delete its block from `pipeline.yaml`.
```
Replace with:
```markdown
1. Delete the product from the database (via the UI or API).
```

Find:
```markdown
1. Edit `defaultFlow:` in `pipeline.yaml`.
2. Make sure the new flow exists in `config/flows/`.
```
Replace with:
```markdown
1. Update the default flow for the product in the UI.
```

- [ ] **Step 7: Fix the Configuration reference link at the bottom**

Find:
```markdown
- [Configuration reference](configuration.md) — every `pipeline.yaml` field.
```
Delete that line.

---

## Task 9: Update `docs/flows.md`

**Files:** Modify `docs/flows.md`

- [ ] **Step 1: Update the opening definition**

Find:
```markdown
A **flow** is a reusable YAML blueprint that automates ticket → PR workflows. One flow = one YAML file at `config/flows/<name>.yaml`. Flows are products-agnostic; multiple products can use the same flow file, allowing status names and provider settings to vary per-product.
```

Replace with:
```markdown
A **flow** is a reusable blueprint that automates ticket → PR workflows. Flows are products-agnostic — multiple products can reference the same flow, with status names and provider settings varying per-product. Flows are created and managed in the flow editor UI and stored in the database.
```

- [ ] **Step 2: Find and remove "Save as: `config/flows/minimal-example.yaml`"**

Find:
```markdown
**5. Save as:** `config/flows/minimal-example.yaml`
```
Replace with:
```markdown
**5. Save the flow** in the flow editor UI.
```

- [ ] **Step 3: Remove `pipeline.yaml` product references**

Find any snippet like:
```yaml
# pipeline.yaml
products:
  my-product:
    flow: "standard"            # Points to config/flows/standard.yaml
```
Replace with a note:
```markdown
In the UI, set the product's flow by selecting it from the flow picker.
```

- [ ] **Step 4: Remove the `# config/flows/my-flow.yaml` snippet header**

Find:
```yaml
# config/flows/my-flow.yaml
```
Remove the comment line — keep the YAML content if it's illustrative of flow structure.

---

## Task 10: Update `docs/pipeline-server.md`

**Files:** Modify `docs/pipeline-server.md`

- [ ] **Step 1: Remove the `mkdir -p config/flows` setup block**

Find:
```bash
mkdir -p config/flows
# populate config/pipeline.yaml and config/flows/default.yaml (see docs/setup.md)
```
Delete both lines.

- [ ] **Step 2: Remove `pipeline.yaml` port reference**

Find:
```markdown
Server listens on the port set in `pipeline.yaml` (default `3000`).
```
Replace with:
```markdown
Server listens on the port set by the `PORT` environment variable (default `4000`).
```

- [ ] **Step 3: Remove `productId` table row referencing pipeline.yaml**

Find:
```markdown
| `productId` | `my-product` | A product key from `pipeline.yaml` |
```
Replace with:
```markdown
| `productId` | `my-product` | A product ID registered in the database |
```

---

## Task 11: Update `docs/providers.md`

**Files:** Modify `docs/providers.md`

- [ ] **Step 1: Replace the opening paragraph**

Find:
```markdown
All providers are configured via the `providerConfig` block inside a product in `pipeline.yaml`. Each category (`coding`, `git`, `ticket`, `notification`) maps to one registered provider. The `providers` block in a flow YAML selects which provider ID to use; `providerConfig` supplies that provider's options.
```

Replace with:
```markdown
All providers are configured per-product in the database (managed through the UI). Each category (`coding`, `git`, `ticket`, `notification`) maps to one registered provider. The `providers` block in a flow selects which provider ID to use; the product's provider config supplies that provider's options.
```

- [ ] **Step 2: Remove or replace the `pipeline.yaml — product block` YAML example**

Find:
```yaml
# pipeline.yaml — product block — supplies provider options
```
Replace the comment with:
```yaml
# Product provider config (managed in UI, stored in database)
```

---

## Task 12: Update `docs/products.md` and `docs/new-product.md`

**Files:** Modify `docs/products.md`, `docs/new-product.md`

- [ ] **Step 1: In `docs/products.md` — replace every `pipeline.yaml` product block reference**

Search for all occurrences of `pipeline.yaml` in `docs/products.md`:
```bash
grep -n "pipeline.yaml\|config/flows" docs/products.md
```

For each occurrence, replace the instruction to edit `pipeline.yaml` with an instruction to use the UI to configure the product.

Example — find:
```markdown
  default: config/flows/default.yaml
```
Replace with:
```markdown
  default: <flow ID from the UI>
```

Find:
```yaml
# config/flows/default.yaml
```
or
```yaml
# config/flows/edgereg-default.yaml
```
Remove those comment headers from YAML examples (keep the YAML content if it illustrates flow structure).

Find:
```markdown
Create a new flow at `config/flows/edgereg-default.yaml`:
```
Replace with:
```markdown
Create the flow in the UI flow editor:
```

- [ ] **Step 2: In `docs/new-product.md` — same treatment**

Search for all occurrences:
```bash
grep -n "pipeline.yaml\|config/flows\|config/" docs/new-product.md
```

For each occurrence, replace "edit `pipeline.yaml`" instructions with "configure in the UI" and remove `config/flows/` file creation instructions.

---

## Task 13: Update `docs/troubleshooting.md`

**Files:** Modify `docs/troubleshooting.md`

- [ ] **Step 1: Find all `pipeline.yaml` diagnostic commands and update them**

Search:
```bash
grep -n "pipeline.yaml\|config/flows\|config/" docs/troubleshooting.md
```

Replace each `jq` / inspection command that references `pipeline.yaml` with the equivalent instruction to check via the UI or database. Examples:

Find:
```markdown
- Verify the filter config: `jq '.products.<id>.ticketWorkflow.trigger' config/pipeline.yaml`
```
Replace with:
```markdown
- Verify the trigger labels configured for the product in the UI.
```

Find:
```markdown
- Check `config/flows/<flowName>.yaml` for typos in step definitions
```
Replace with:
```markdown
- Open the flow in the UI flow editor and check for typos in step definitions.
```

Find:
```markdown
- Check `products.<id>.ticketWorkflow.statuses` in `pipeline.yaml`
```
Replace with:
```markdown
- Check the ticket workflow status mappings configured for the product in the UI.
```

Find:
```markdown
- Check `products.<id>.repos` in `pipeline.yaml`
```
Replace with:
```markdown
- Check the repos configured for the product in the UI.
```

Find:
```markdown
1. Update the secret in your server config (env var or `pipeline.yaml`)
```
Replace with:
```markdown
1. Update the secret in your `.env` or via the secrets vault in the UI.
```

Find:
```markdown
- The webhook URL path should match a product ID in `pipeline.yaml`
```
Replace with:
```markdown
- The webhook URL path should match a product ID registered in the database.
```

Find:
```markdown
- Confirm the product exists in `pipeline.yaml` and is named exactly as in the URL
```
Replace with:
```markdown
- Confirm the product exists in the database with the correct ID.
```

Find:
```markdown
- Or configure it in `pipeline.yaml`:
```
Replace with:
```markdown
- Or set it in `.env`:
```

Find:
```bash
jq '.server.webhooks, .products[].webhookSecrets' config/pipeline.yaml
```
Replace with:
```markdown
Check webhook secrets via the secrets vault in the UI or in `.env`.
```

---

## Task 14: Run typecheck

- [ ] **Step 1: Run typecheck across all packages**

```bash
npm run typecheck
```

Expected: no errors. If errors appear, they will be import-related (e.g. a leftover `import { loadWorkerConfig }`) — fix the specific import and re-run.
