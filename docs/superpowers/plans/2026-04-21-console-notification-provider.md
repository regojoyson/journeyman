# Console Notification Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ConsoleProvider` that satisfies `INotificationProvider` by logging via Pino, then register it in all three bootstrap sites and update docs.

**Architecture:** A single new file mirrors the `SlackProvider` structure. It imports `createLogger` from `@journeyman/core` and logs at `info` level. It is exported from the package root and inserted into the provider arrays in `main.ts`, `validate-config.ts`, and `run-once.ts`.

**Tech Stack:** TypeScript, Pino (`createLogger` from `@journeyman/core`), npm workspaces monorepo.

---

### Task 1: Create ConsoleProvider

**Files:**
- Create: `packages/notification-provider/src/providers/console/index.ts`

- [ ] **Step 1: Create the file**

```typescript
import type { INotificationProvider, IProviderMeta } from "@journeyman/core";
import type { SendNotificationOptions, SendNotificationResult } from "@journeyman/core";
import { createLogger } from "@journeyman/core";

const log = createLogger("provider:console");

export class ConsoleProvider implements INotificationProvider {
  static meta: IProviderMeta = {
    id: "console",
    name: "Console",
    description: "Logs notifications to the application logger (dev/test use)",
    category: "notification",
  };

  async send(opts: SendNotificationOptions): Promise<SendNotificationResult> {
    log.info(
      { channel: opts.channel, title: opts.title, message: opts.message, sessionId: opts.sessionId },
      "notify",
    );
    return { success: true, messageId: Date.now().toString(), sessionId: opts.sessionId };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/notification-provider/src/providers/console/index.ts
git commit -m "feat: add ConsoleProvider for notification logging"
```

---

### Task 2: Export ConsoleProvider from package root

**Files:**
- Modify: `packages/notification-provider/src/index.ts`

Current content:
```typescript
export { SlackProvider } from "./providers/slack/index.ts";
export type { INotificationProvider } from "@journeyman/core";
```

- [ ] **Step 1: Add ConsoleProvider export**

```typescript
export { SlackProvider } from "./providers/slack/index.ts";
export { ConsoleProvider } from "./providers/console/index.ts";
export type { INotificationProvider } from "@journeyman/core";
```

- [ ] **Step 2: Verify typecheck passes**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman && npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/notification-provider/src/index.ts
git commit -m "feat: export ConsoleProvider from notification-provider package"
```

---

### Task 3: Register ConsoleProvider in pipeline-server/main.ts

**Files:**
- Modify: `packages/pipeline-server/src/main.ts`

- [ ] **Step 1: Update import**

Find line:
```typescript
import { SlackProvider } from "@journeyman/notification-provider";
```

Replace with:
```typescript
import { SlackProvider, ConsoleProvider } from "@journeyman/notification-provider";
```

- [ ] **Step 2: Add to provider registration array**

Find (lines 89–97):
```typescript
  const providers = new ProviderRegistry();
  for (const c of [
    ClaudeProvider, GeminiProvider, CodexProvider, OpenCodeProvider,
    GitHubProvider, GitLabProvider,
    JiraProvider, LinearProvider, MondayProvider,
    GitHubIssuesProvider, GitHubProjectsProvider,
    SlackProvider,
  ]) {
    providers.register(c as any);
  }
```

Replace with:
```typescript
  const providers = new ProviderRegistry();
  for (const c of [
    ClaudeProvider, GeminiProvider, CodexProvider, OpenCodeProvider,
    GitHubProvider, GitLabProvider,
    JiraProvider, LinearProvider, MondayProvider,
    GitHubIssuesProvider, GitHubProjectsProvider,
    SlackProvider, ConsoleProvider,
  ]) {
    providers.register(c as any);
  }
```

- [ ] **Step 3: Commit**

```bash
git add packages/pipeline-server/src/main.ts
git commit -m "feat: register ConsoleProvider in pipeline-server"
```

---

### Task 4: Register ConsoleProvider in validate-config.ts

**Files:**
- Modify: `packages/pipeline/src/cli-commands/validate-config.ts`

- [ ] **Step 1: Update import**

Find:
```typescript
import { SlackProvider } from "@journeyman/notification-provider";
```

Replace with:
```typescript
import { SlackProvider, ConsoleProvider } from "@journeyman/notification-provider";
```

- [ ] **Step 2: Add to provider registration array**

Find (lines 70–76):
```typescript
    const providers = new ProviderRegistry();
    for (const c of [
      ClaudeProvider, GeminiProvider, CodexProvider, OpenCodeProvider,
      GitHubProvider, GitLabProvider,
      JiraProvider, LinearProvider, MondayProvider,
      GitHubIssuesProvider, GitHubProjectsProvider,
      SlackProvider,
    ]) providers.register(c as any);
```

Replace with:
```typescript
    const providers = new ProviderRegistry();
    for (const c of [
      ClaudeProvider, GeminiProvider, CodexProvider, OpenCodeProvider,
      GitHubProvider, GitLabProvider,
      JiraProvider, LinearProvider, MondayProvider,
      GitHubIssuesProvider, GitHubProjectsProvider,
      SlackProvider, ConsoleProvider,
    ]) providers.register(c as any);
```

- [ ] **Step 3: Commit**

```bash
git add packages/pipeline/src/cli-commands/validate-config.ts
git commit -m "feat: register ConsoleProvider in validate-config"
```

---

### Task 5: Register ConsoleProvider in run-once.ts

**Files:**
- Modify: `packages/pipeline/src/cli-commands/run-once.ts`

- [ ] **Step 1: Update import**

Find:
```typescript
import { SlackProvider } from "@journeyman/notification-provider";
```

Replace with:
```typescript
import { SlackProvider, ConsoleProvider } from "@journeyman/notification-provider";
```

- [ ] **Step 2: Add to provider registration array**

Find (lines 92–99):
```typescript
  const providers = new ProviderRegistry();
  for (const c of [
    ClaudeProvider, GeminiProvider, CodexProvider, OpenCodeProvider,
    GitHubProvider, GitLabProvider,
    JiraProvider, LinearProvider, MondayProvider,
    GitHubIssuesProvider, GitHubProjectsProvider,
    SlackProvider,
  ]) providers.register(c as any);
```

Replace with:
```typescript
  const providers = new ProviderRegistry();
  for (const c of [
    ClaudeProvider, GeminiProvider, CodexProvider, OpenCodeProvider,
    GitHubProvider, GitLabProvider,
    JiraProvider, LinearProvider, MondayProvider,
    GitHubIssuesProvider, GitHubProjectsProvider,
    SlackProvider, ConsoleProvider,
  ]) providers.register(c as any);
```

- [ ] **Step 3: Run final typecheck**

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman && npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/pipeline/src/cli-commands/run-once.ts
git commit -m "feat: register ConsoleProvider in run-once"
```

---

### Task 6: Update docs/providers.md

**Files:**
- Modify: `docs/providers.md`

- [ ] **Step 1: Add ConsoleProvider section after the `slack` section (after line 385)**

Insert after the `### \`slack\` — SlackProvider` block:

```markdown
### `console` — ConsoleProvider

**Package:** `@journeyman/notification-provider`  
**Status:** Implemented — logs via application logger (Pino); no external calls

```yaml
providers:
  notification: console
providerConfig:
  notification: {}
```

Writes one `info`-level log entry per notification containing `channel`, `title`, `message`, and `sessionId`. In development (`NODE_ENV != production`) output is pretty-printed via `pino-pretty`; in production it is structured JSON. Intended for local dev and CI environments where a real Slack workspace is unavailable.

**Returns:** `{ success: true, messageId: "<epoch ms>", sessionId }`

**Failure modes:** never fails; no external calls.
```

- [ ] **Step 2: Add ConsoleProvider to the provider summary table (near line 455)**

Find the table row:
```
| `slack` | notification | Stub | — |
```

Add after it:
```
| `console` | notification | Implemented | — |
```

- [ ] **Step 3: Commit**

```bash
git add docs/providers.md
git commit -m "docs: add ConsoleProvider to providers reference"
```

---

### Task 7: Update docs/phases.md

**Files:**
- Modify: `docs/phases.md`

- [ ] **Step 1: Update the `notify` phase description to mention `console` as a valid provider id**

Find the `notify` phase **Step config** table row:
```
| **Step config** | `channel: string`, `template?: "analysis-summary" \| "pr-opened" \| "default"`, `message?: string`, `title?: string` |
```

Find the paragraph that begins `Sends a notification to the specified channel...` and append this sentence at the end of that paragraph:

> Valid `notification` provider ids: `slack` (external Slack webhook), `console` (logs to application logger — no external calls, suitable for local dev and CI).

- [ ] **Step 2: Commit**

```bash
git add docs/phases.md
git commit -m "docs: note console as valid notification provider in phases reference"
```
