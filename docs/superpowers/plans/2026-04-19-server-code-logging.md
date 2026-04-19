# Server Code-Level Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace scattered `console.*` calls across server/provider code with a leveled, namespaced pino logger exposed via `@journeyman/core`.

**Architecture:** One root pino instance in `@journeyman/core`, exported as `createLogger(namespace)` factory. Human-readable output in dev (via `pino-pretty`), JSON in production. `LOG_LEVEL` env var controls level globally.

**Tech Stack:** TypeScript, npm workspaces, `pino`, `pino-pretty`.

**Note:** No tests per user directive.

---

## File Structure

**Create:**
- `packages/core/src/logger.ts` — pino root + `createLogger(namespace)` factory

**Modify:**
- `package.json` (root) — add `pino` (deps) and `pino-pretty` (devDeps)
- `packages/core/src/index.ts` — export `createLogger`, `Logger` type
- 18 source files across `pipeline-server`, `pipeline`, `coding-cli`, `ticket-provider` — replace `console.*` with `log.*`

**Exclusions:**
- `*.test.ts` files — leave `console.*` untouched
- `packages/pipeline-server/journeyman-pipeline.postman_collection.json` — JSON payload, not our code
- `packages/coding-cli/src/providers/claude/operations/checkout-repo.ts:111` — inside a JSDoc comment example, leave as-is
- `packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts:235` — already commented out, leave as-is

---

## Task 1: Add pino dependencies

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Install deps**

Run from repo root:
```bash
npm install pino
npm install -D pino-pretty
```

- [ ] **Step 2: Verify root package.json**

Root `package.json` should now contain:
```json
"dependencies": {
  "pino": "^9.x.x"
},
"devDependencies": {
  "...existing...": "...",
  "pino-pretty": "^11.x.x"
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add pino + pino-pretty for server logging"
```

---

## Task 2: Create the logger module in @journeyman/core

**Files:**
- Create: `packages/core/src/logger.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/package.json` (add pino as a dependency of core)

- [ ] **Step 1: Add pino to core package.json dependencies**

Edit `packages/core/package.json` — add a `dependencies` field:
```json
"dependencies": {
  "pino": "^9.0.0"
}
```

(Keep existing `devDependencies` and `peerDependencies` as-is.)

- [ ] **Step 2: Create `packages/core/src/logger.ts`**

```typescript
import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";
const isDev = process.env.NODE_ENV !== "production";

const root = pino({
  level,
  transport: isDev
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss.l" } }
    : undefined,
});

export type Logger = pino.Logger;

export function createLogger(namespace: string): Logger {
  return root.child({ ns: namespace });
}
```

- [ ] **Step 3: Export from `packages/core/src/index.ts`**

Append to the file:
```typescript
export { createLogger, type Logger } from "./logger.ts";
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes cleanly.

- [ ] **Step 5: Smoke-test the logger**

Run:
```bash
LOG_LEVEL=debug npx tsx -e "import { createLogger } from '@journeyman/core'; const log = createLogger('smoke'); log.debug('debug msg'); log.info('info msg'); log.warn('warn msg'); log.error('error msg');"
```
Expected: four colorized, timestamped lines on stdout with `ns=smoke`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/logger.ts packages/core/src/index.ts packages/core/package.json
git commit -m "feat(core): add createLogger factory backed by pino"
```

---

## Task 3: Replace console in pipeline-server/src/cli-start.ts

**Files:**
- Modify: `packages/pipeline-server/src/cli-start.ts`

- [ ] **Step 1: Add logger import + instance**

At the top of the file (after existing imports), add:
```typescript
import { createLogger } from "@journeyman/core";
const log = createLogger("server:cli");
```

- [ ] **Step 2: Replace each console call**

| Line | Old | New |
|---|---|---|
| 13 | `console.log(\`Loaded ${Object.keys(result.parsed).length} variable(s) from .env\`);` | `log.info(\`Loaded ${Object.keys(result.parsed).length} variable(s) from .env\`);` |
| 16 | `console.log("No .env file found — using process environment only");` | `log.info("No .env file found — using process environment only");` |
| 21 | `console.error("Server failed to start:", err);` | `log.error({ err }, "Server failed to start");` |

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add packages/pipeline-server/src/cli-start.ts
git commit -m "refactor(server): use createLogger in cli-start"
```

---

## Task 4: Replace console in pipeline-server/src/main.ts

**Files:**
- Modify: `packages/pipeline-server/src/main.ts`

- [ ] **Step 1: Add logger**

At top (after imports):
```typescript
import { createLogger } from "@journeyman/core";
const log = createLogger("server:main");
```

- [ ] **Step 2: Replace console call**

| Line | Old | New |
|---|---|---|
| 135 | `console.log(\`journeyman pipeline-server listening on ${config.server.port}\`);` | `log.info({ port: config.server.port }, "journeyman pipeline-server listening");` |

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add packages/pipeline-server/src/main.ts
git commit -m "refactor(server): use createLogger in main"
```

---

## Task 5: Replace console in pipeline-server/src/dispatch.ts

**Files:**
- Modify: `packages/pipeline-server/src/dispatch.ts`

- [ ] **Step 1: Add logger**

At top:
```typescript
import { createLogger } from "@journeyman/core";
const log = createLogger("server:dispatch");
```

- [ ] **Step 2: Replace console call**

| Line | Old | New |
|---|---|---|
| 51 | `console.error(\`dispatch failure for ${trigger.ticketKey}:\`, err);` | `log.error({ err, ticketKey: trigger.ticketKey }, "dispatch failure");` |

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add packages/pipeline-server/src/dispatch.ts
git commit -m "refactor(server): use createLogger in dispatch"
```

---

## Task 6: Replace console in pipeline/src/cli.ts

**Files:**
- Modify: `packages/pipeline/src/cli.ts`

- [ ] **Step 1: Add logger**

At top:
```typescript
import { createLogger } from "@journeyman/core";
const log = createLogger("pipeline:cli");
```

- [ ] **Step 2: Replace console calls**

| Line | Old | New |
|---|---|---|
| 20 | `console.log(\`Usage: …\`);` (multi-line) | `log.info(\`Usage: …\`);` (same multi-line template, just swap function) |
| 53 | `console.error("--ticket and --product required");` | `log.error("--ticket and --product required");` |
| 72 | `main().catch(err => { console.error(err); process.exit(1); });` | `main().catch(err => { log.error({ err }, "cli failed"); process.exit(1); });` |

Note: the `Usage` block is a user-facing help message — `log.info` will still print it. If it looks ugly under `pino-pretty` framing, change it to `process.stdout.write(...)` instead. Try `log.info` first.

- [ ] **Step 3: Smoke test**

```bash
npx tsx packages/pipeline/src/cli.ts
```
Expected: usage block prints.

- [ ] **Step 4: Typecheck + commit**

```bash
npm run typecheck
git add packages/pipeline/src/cli.ts
git commit -m "refactor(pipeline): use createLogger in cli"
```

---

## Task 7: Replace console in pipeline/src/shutdown.ts

**Files:**
- Modify: `packages/pipeline/src/shutdown.ts`

- [ ] **Step 1: Add logger**

```typescript
import { createLogger } from "@journeyman/core";
const log = createLogger("pipeline:shutdown");
```

- [ ] **Step 2: Replace**

| Line | Old | New |
|---|---|---|
| 38 | `console.log(\`[pipeline] ${signal} received, draining...\`);` | `log.info({ signal }, "shutdown signal received, draining");` |

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add packages/pipeline/src/shutdown.ts
git commit -m "refactor(pipeline): use createLogger in shutdown"
```

---

## Task 8: Replace console in pipeline/src/cli-commands/run-once.ts

**Files:**
- Modify: `packages/pipeline/src/cli-commands/run-once.ts`

- [ ] **Step 1: Add logger**

```typescript
import { createLogger } from "@journeyman/core";
const log = createLogger("pipeline:run-once");
```

- [ ] **Step 2: Replace**

| Line | Old | New |
|---|---|---|
| 46 | `console.error(\`Unknown product: ${productId}\`);` | `log.error({ productId }, "Unknown product");` |
| 116 | `console.log(\`run ${run.sessionId} → ${run.status}\`);` | `log.info({ sessionId: run.sessionId, status: run.status }, "run complete");` |

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add packages/pipeline/src/cli-commands/run-once.ts
git commit -m "refactor(pipeline): use createLogger in run-once"
```

---

## Task 9: Replace console in pipeline/src/cli-commands/sweep.ts

**Files:**
- Modify: `packages/pipeline/src/cli-commands/sweep.ts`

- [ ] **Step 1: Add logger**

```typescript
import { createLogger } from "@journeyman/core";
const log = createLogger("pipeline:sweep");
```

- [ ] **Step 2: Replace**

| Line | Old | New |
|---|---|---|
| 40 | `console.log(\`removing ${dir}\`);` | `log.info({ dir }, "removing stale workspace");` |

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add packages/pipeline/src/cli-commands/sweep.ts
git commit -m "refactor(pipeline): use createLogger in sweep"
```

---

## Task 10: Replace console in pipeline/src/cli-commands/validate-config.ts

**Files:**
- Modify: `packages/pipeline/src/cli-commands/validate-config.ts`

- [ ] **Step 1: Add logger**

```typescript
import { createLogger } from "@journeyman/core";
const log = createLogger("pipeline:validate-config");
```

- [ ] **Step 2: Replace**

| Line | Old | New |
|---|---|---|
| 60 | `console.log("✓ config valid");` | `log.info("✓ config valid");` |
| 63 | `console.error(\`✗ ${err.message}\`);` | `log.error({ err }, "config invalid");` |

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add packages/pipeline/src/cli-commands/validate-config.ts
git commit -m "refactor(pipeline): use createLogger in validate-config"
```

---

## Task 11: Replace console in coding-cli sdk-logger.ts

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/utils/sdk-logger.ts`

- [ ] **Step 1: Add logger**

```typescript
import { createLogger } from "@journeyman/core";
const log = createLogger("claude:sdk");
```

- [ ] **Step 2: Replace**

| Line | Old | New |
|---|---|---|
| 7 | `console.log("[agent]", block.text);` | `log.debug({ text: block.text }, "agent message");` |
| 9 | `console.log("[tool]", block.name, JSON.stringify((block as any).input ?? {}));` | `log.debug({ tool: block.name, input: (block as any).input ?? {} }, "tool use");` |
| 18 | `if (output) console.log("[tool result]", output.trim());` | `if (output) log.debug({ output: output.trim() }, "tool result");` |
| 22 | `console.log("[done]", msg.subtype);` | `log.debug({ subtype: msg.subtype }, "sdk done");` |

These are verbose — `debug` level so they're silent by default, visible with `LOG_LEVEL=debug`.

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add packages/coding-cli/src/providers/claude/utils/sdk-logger.ts
git commit -m "refactor(coding-cli): use createLogger in claude sdk-logger"
```

---

## Task 12: Replace console in coding-cli claude operation runners

**Files (one per operation — each has a single `console.log(JSON.stringify(result, null, 2))` in its `if (import.meta.url === ...)` CLI runner block):**
- Modify: `packages/coding-cli/src/providers/claude/operations/scan-repos.ts:100`
- Modify: `packages/coding-cli/src/providers/claude/operations/checkout-repo.ts:167`
- Modify: `packages/coding-cli/src/providers/claude/operations/create-workspace.ts:67`
- Modify: `packages/coding-cli/src/providers/claude/operations/cleanup-repos.ts:78`
- Modify: `packages/coding-cli/src/providers/claude/operations/analyze.ts:231`
- Modify: `packages/coding-cli/src/providers/claude/operations/plan.ts:231`
- Modify: `packages/coding-cli/src/providers/claude/operations/implement.ts:239`

These are CLI entry points that dump the final result as JSON for human inspection. For these, keep `process.stdout.write` semantics — do NOT route through pino (JSON result should not be framed by pino-pretty).

- [ ] **Step 1: In each of the 7 files, replace the result dump line**

Old: `console.log(JSON.stringify(result, null, 2));`
New: `process.stdout.write(JSON.stringify(result, null, 2) + "\n");`

Rationale: these are scripts whose stdout IS the result. Keeping raw stdout keeps them pipe-friendly and avoids pino decoration.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/coding-cli/src/providers/claude/operations/
git commit -m "refactor(coding-cli): write operation CLI results to raw stdout"
```

---

## Task 13: Replace console in ticket-provider jira sdk-logger.ts

**Files:**
- Modify: `packages/ticket-provider/src/providers/jira/utils/sdk-logger.ts`

- [ ] **Step 1: Add logger**

```typescript
import { createLogger } from "@journeyman/core";
const log = createLogger("jira:sdk");
```

- [ ] **Step 2: Replace**

| Line | Old | New |
|---|---|---|
| 7 | `console.log("[agent]", block.text);` | `log.debug({ text: block.text }, "agent message");` |
| 9 | `console.log("[tool]", block.name, JSON.stringify((block as any).input ?? {}));` | `log.debug({ tool: block.name, input: (block as any).input ?? {} }, "tool use");` |
| 18 | `if (output) console.log("[tool result]", output.trim());` | `if (output) log.debug({ output: output.trim() }, "tool result");` |
| 22 | `console.log("[done]", msg.subtype);` | `log.debug({ subtype: msg.subtype }, "sdk done");` |

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add packages/ticket-provider/src/providers/jira/utils/sdk-logger.ts
git commit -m "refactor(ticket-provider): use createLogger in jira sdk-logger"
```

---

## Task 14: Final verification

- [ ] **Step 1: Full typecheck**

```bash
npm run typecheck
```
Expected: all workspaces pass.

- [ ] **Step 2: Confirm no stray `console.*` in non-test source files**

Run:
```bash
grep -rn 'console\.\(log\|error\|warn\|info\|debug\)' packages --include='*.ts' | grep -v '\.test\.ts' | grep -v 'node_modules'
```

Expected output: only the intentional exclusions remain:
- `packages/coding-cli/src/providers/claude/operations/checkout-repo.ts:111` (JSDoc example)
- `packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts:235` (commented out)
- Any `process.stdout.write` occurrences in operation runners (not `console.*`, so should not match)

- [ ] **Step 3: Start the server to smoke-test**

```bash
npm start
```
Expected: `[HH:MM:ss.lll] INFO (server:cli): …` style pretty output; server starts without errors. Stop with Ctrl-C.

- [ ] **Step 4: Verify LOG_LEVEL=debug surfaces debug lines**

Run any CLI entry, e.g.:
```bash
LOG_LEVEL=debug npm start
```
Expected: same output as above, plus any `log.debug(...)` lines from sdk-logger once an SDK call fires.

- [ ] **Step 5: Final commit if any fixup was needed**

```bash
git status
# if clean, skip. Otherwise:
git add -p
git commit -m "chore: final logging cleanup"
```

---

## Self-Review Notes

- **Spec coverage:** Tasks 1-2 implement core logger + deps. Tasks 3-13 cover all 18 non-test source files with console calls from the spec table. Task 14 verifies. ✓
- **Exclusions documented:** test files, postman JSON, JSDoc example line, already-commented line — all called out. ✓
- **Operation CLI runners (Task 12):** deliberately use `process.stdout.write` not `log.info` because their stdout is machine-readable JSON. Noted inline. ✓
- **Namespace consistency:** matches spec's table exactly. ✓
- **No tests:** per user directive. ✓
