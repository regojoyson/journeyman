# Notification Providers End-to-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every notification provider type (console, slack, email) work in both the workflow send-message step and agent run-finished notifications, fix the 11 TypeScript errors, and make the editor ask for provider-appropriate inputs.

**Architecture:** Collapse the two divergent provider-construction sites into one shared `buildNotificationProvider()` factory in `@journeyman/notification-provider`. Add a `notificationFields(provider)` registry in `@journeyman/core` that both editors use to render provider-aware inputs. The three backend input slots (`channel`, `title`, `message`) are unchanged — only the visible boxes/labels differ.

**Tech Stack:** TypeScript, React, Vitest, npm workspaces. Coding providers are plain classes implementing `INotificationProvider`.

**Execution constraints (from the requester):**
- **No git commits.** Do not run `git commit`/`git add`. Work stays in the working tree on the current `master` branch. (The per-task commit step from the writing-plans skill is intentionally omitted.)
- **Stay on `master`.** No new branch, no worktree.
- **Typecheck once, at the end.** Per-task verification is limited to running the specific unit test a task adds. The full `npm run typecheck` + `npm run check:boundaries` run is the final task.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/notification-provider/src/providers/email/index.ts` | EmailProvider class | Widen `sessionId` param (×5) |
| `packages/notification-provider/src/providers/email/email.test.ts` | EmailProvider tests | Non-null assertions (×6) |
| `packages/notification-provider/src/build-provider.ts` | **New** — `buildNotificationProvider(provider, config, credential)` | Create |
| `packages/notification-provider/src/build-provider.test.ts` | **New** — factory unit tests | Create |
| `packages/notification-provider/src/index.ts` | Package barrel | Export factory |
| `packages/orchestrator/src/cli-worker.ts` | Worker provider factories | Delegate notification factory |
| `packages/api-server/src/services/notify-on-terminal.ts` | Agent run-finished hook | Delegate; generic over all types |
| `packages/api-server/src/services/notify-on-terminal.test.ts` | Hook tests | Add email case |
| `packages/core/src/registries/provider-catalog.ts` | Provider catalog | slack `implemented: true` |
| `packages/core/src/registries/notification-fields.ts` | **New** — `notificationFields(provider)` | Create |
| `packages/core/src/index.ts` | Core barrel | Export notification-fields |
| `packages/steps/src/notifications/send-message.meta.ts` | Step metadata | Add optional `title` |
| `packages/steps/src/notifications/send-message.tsx` | Step definition | Add `title` to type/defaults/schemaFields baseline |
| `packages/flow-editor/src/properties-panel/ConnectionPicker.tsx` | Connection dropdown | Add `onResolved` callback |
| `packages/flow-editor/src/properties-panel/ConfigTab.tsx` | Step config panel | Provider-aware fields for send-message |
| `packages/web/src/components/agents/sections/NotificationsSection.tsx` | Agent notifications UI | Provider-aware recipient field |
| `CLAUDE.md` | Project guide | Mark SlackProvider implemented |

---

## Task 1: Fix EmailProvider compile errors

**Files:**
- Modify: `packages/notification-provider/src/providers/email/index.ts`
- Modify: `packages/notification-provider/src/providers/email/email.test.ts`

- [ ] **Step 1: Widen the five private method signatures**

In `packages/notification-provider/src/providers/email/index.ts`, each of the five private methods declares `sessionId: string`. `SendNotificationOptions.sessionId` is optional, so the public `send()` passes `string | undefined`. Change the parameter type in all five methods from `sessionId: string` to `sessionId?: string`.

The five method signatures become:

```ts
private async sendSmtp(to: string, subject: string, text: string, sessionId?: string): Promise<SendNotificationResult> {
```
```ts
private async sendResend(to: string, subject: string, text: string, sessionId?: string): Promise<SendNotificationResult> {
```
```ts
private async sendSendGrid(to: string, subject: string, text: string, sessionId?: string): Promise<SendNotificationResult> {
```
```ts
private async sendMailgun(to: string, subject: string, text: string, sessionId?: string): Promise<SendNotificationResult> {
```
```ts
private async sendSes(to: string, subject: string, text: string, sessionId?: string): Promise<SendNotificationResult> {
```

The method bodies are unchanged — they already only place `sessionId` into the optional `SendNotificationResult.sessionId` field.

- [ ] **Step 2: Add non-null assertions in the SES test**

In `packages/notification-provider/src/providers/email/email.test.ts`, the SES assertion block (lines 247-250) reads optional nested fields of `SendEmailCommandInput`. Replace those four lines:

```ts
    expect(cmdArg.Source).toBe("noreply@acme.com");
    expect(cmdArg.Destination!.ToAddresses).toEqual(["alice@example.com"]);
    expect(cmdArg.Message!.Subject!.Data).toBe("SES subject");
    expect(cmdArg.Message!.Body!.Text!.Data).toBe("SES body");
```

(`cmdArg.Source` already typechecks; only the `Destination`/`Message` chains need the `!` assertions. The mock always populates them.)

- [ ] **Step 3: Run the EmailProvider tests to confirm they still pass**

Run: `npm test -w @journeyman/notification-provider`
Expected: PASS — all EmailProvider tests green (smtp/resend/sendgrid/mailgun/ses + error cases). No type errors reported by vitest's esbuild transform.

---

## Task 2: Create the shared `buildNotificationProvider` factory

**Files:**
- Create: `packages/notification-provider/src/build-provider.ts`
- Create: `packages/notification-provider/src/build-provider.test.ts`
- Modify: `packages/notification-provider/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/notification-provider/src/build-provider.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildNotificationProvider } from "./build-provider.ts";
import { ConsoleProvider } from "./providers/console/index.ts";
import { SlackProvider } from "./providers/slack/index.ts";
import { EmailProvider } from "./providers/email/index.ts";

describe("buildNotificationProvider", () => {
  it("builds a ConsoleProvider", () => {
    expect(buildNotificationProvider("console", {}, "")).toBeInstanceOf(ConsoleProvider);
  });

  it("builds a SlackProvider for token method", () => {
    expect(buildNotificationProvider("slack", { method: "token" }, "xoxb-1")).toBeInstanceOf(SlackProvider);
  });

  it("builds a SlackProvider for webhook method", () => {
    expect(buildNotificationProvider("slack", { method: "webhook" }, "https://hooks.slack.com/x")).toBeInstanceOf(SlackProvider);
  });

  it("builds an EmailProvider for each email method", () => {
    for (const cfg of [
      { method: "smtp", host: "h", port: 587, secure: false, from: "a@b.com", username: "u" },
      { method: "resend", from: "a@b.com" },
      { method: "sendgrid", from: "a@b.com" },
      { method: "mailgun", from: "a@b.com", domain: "d.com" },
      { method: "ses", from: "a@b.com", region: "us-east-1", accessKeyId: "AKID" },
    ]) {
      expect(buildNotificationProvider("email", cfg, "secret")).toBeInstanceOf(EmailProvider);
    }
  });

  it("throws ConfigurationError when email config.method is missing", () => {
    expect(() => buildNotificationProvider("email", {}, "secret")).toThrow(/missing config.method/);
    try {
      buildNotificationProvider("email", {}, "secret");
    } catch (e) {
      expect((e as Error).name).toBe("ConfigurationError");
    }
  });

  it("throws ConfigurationError for an unknown email method", () => {
    expect(() => buildNotificationProvider("email", { method: "carrier-pigeon" }, "secret")).toThrow(/Unknown email method/);
  });

  it("throws ConfigurationError for an unknown provider", () => {
    expect(() => buildNotificationProvider("teams", {}, "")).toThrow(/Unknown notification provider/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @journeyman/notification-provider -- build-provider`
Expected: FAIL — `Failed to resolve import "./build-provider.ts"` (module does not exist yet).

- [ ] **Step 3: Implement the factory**

Create `packages/notification-provider/src/build-provider.ts`:

```ts
import type { INotificationProvider } from "@journeyman/core";
import { ConsoleProvider } from "./providers/console/index.ts";
import { SlackProvider } from "./providers/slack/index.ts";
import { EmailProvider, type EmailProviderOptions } from "./providers/email/index.ts";

function configError(message: string): Error {
  return Object.assign(new Error(message), { name: "ConfigurationError" });
}

/**
 * Build a notification provider from a connection's provider key, its `config`
 * object, and its already-decrypted credential. Single source of truth used by
 * both the workflow send-message step factory and the agent notify-on-terminal
 * hook, so the two never diverge.
 */
export function buildNotificationProvider(
  provider: string,
  config: Record<string, unknown>,
  credential: string,
): INotificationProvider {
  switch (provider) {
    case "console":
      return new ConsoleProvider();
    case "slack":
      return config.method === "webhook"
        ? new SlackProvider({ method: "webhook", webhookUrl: credential })
        : new SlackProvider({ method: "token", token: credential });
    case "email":
      return new EmailProvider(buildEmailOptions(config, credential));
    default:
      throw configError(`Unknown notification provider: ${provider}`);
  }
}

function buildEmailOptions(config: Record<string, unknown>, credential: string): EmailProviderOptions {
  const method = config.method as string | undefined;
  if (!method) throw configError("Email connection missing config.method");
  const from = config.from as string;
  switch (method) {
    case "smtp":
      return {
        method: "smtp",
        host: config.host as string,
        port: Number(config.port),
        secure: Boolean(config.secure),
        from,
        username: config.username as string,
        password: credential,
      };
    case "resend":
      return { method: "resend", from, apiKey: credential };
    case "sendgrid":
      return { method: "sendgrid", from, apiKey: credential };
    case "mailgun":
      return {
        method: "mailgun",
        from,
        domain: config.domain as string,
        apiKey: credential,
        region: (config.region as "us" | "eu" | undefined) ?? "us",
      };
    case "ses":
      return {
        method: "ses",
        from,
        region: config.region as string,
        accessKeyId: config.accessKeyId as string,
        secretAccessKey: credential,
      };
    default:
      throw configError(`Unknown email method: ${method}`);
  }
}
```

- [ ] **Step 4: Export the factory from the package barrel**

In `packages/notification-provider/src/index.ts`, add this line after the existing `EmailProvider` exports:

```ts
export { buildNotificationProvider } from "./build-provider.ts";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w @journeyman/notification-provider -- build-provider`
Expected: PASS — all 7 `buildNotificationProvider` cases green.

---

## Task 3: Delegate the worker's notification factory to the shared builder

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts:29-30` (imports)
- Modify: `packages/orchestrator/src/cli-worker.ts:274-331` (factory)

- [ ] **Step 1: Replace the notification-provider imports**

In `packages/orchestrator/src/cli-worker.ts`, replace these two lines (currently lines 29-30):

```ts
import { ConsoleProvider, EmailProvider } from "@journeyman/notification-provider";
import type { EmailProviderOptions } from "@journeyman/notification-provider";
```

with:

```ts
import { buildNotificationProvider } from "@journeyman/notification-provider";
```

- [ ] **Step 2: Replace the `notification` factory body**

Replace the entire `notification` factory (currently lines 274-331, from `const notification:` through its closing `};`) with:

```ts
const notification: ProviderFactory<INotificationProvider> = (key, _env, connection) => {
  const provider = connection?.provider ?? key ?? "console";
  return buildNotificationProvider(
    provider,
    (connection?.config ?? {}) as Record<string, unknown>,
    connection?.credential ?? "",
  );
};
```

This removes the `slack` "not yet implemented" throw and the inlined email switch — the worker step now supports console, slack, and email.

- [ ] **Step 3: Verify no remaining references to the removed imports**

Run: `grep -n "EmailProvider\|ConsoleProvider\|EmailProviderOptions" packages/orchestrator/src/cli-worker.ts`
Expected: no output (all references removed). If any remain, they are leftovers from the old factory and must be deleted.

---

## Task 4: Make the agent notify hook generic over all notification types

**Files:**
- Modify: `packages/api-server/src/services/notify-on-terminal.ts`
- Modify: `packages/api-server/src/services/notify-on-terminal.test.ts`

- [ ] **Step 1: Write the failing test (email branch)**

In `packages/api-server/src/services/notify-on-terminal.test.ts`, the existing mock for `@journeyman/notification-provider` (lines 20-27) only stubs `SlackProvider` and `ConsoleProvider`. Replace that mock block with one that also stubs `buildNotificationProvider`, routing by provider to the existing send mocks plus a new email mock:

```ts
const emailSendMock = vi.fn().mockResolvedValue({ success: true });
vi.mock("@journeyman/notification-provider", () => ({
  buildNotificationProvider: (provider: string) => {
    if (provider === "slack") return { send: slackSendMock };
    if (provider === "console") return { send: consoleSendMock };
    if (provider === "email") return { send: emailSendMock };
    throw Object.assign(new Error(`Unknown notification provider: ${provider}`), { name: "ConfigurationError" });
  },
}));
```

Add `emailSendMock.mockClear();` inside the `beforeEach` block (alongside the existing `slackSendMock.mockClear()`).

Then add this test inside the `describe("makeNotifyOnTerminal", ...)` block:

```ts
  it("sends an email success notification", async () => {
    getAgentMock.mockResolvedValue({
      name: "Dev Agent",
      notifications: { on: ["success"], connectionId: "c1", target: "alice@example.com" },
    });
    getConnectionMock.mockResolvedValue({
      category: "notification",
      provider: "email",
      config: { method: "resend", from: "noreply@acme.com" },
    });
    getConnectionSealedMock.mockResolvedValue({ ciphertext: Buffer.from("x"), iv: Buffer.from("y"), authTag: Buffer.from("z") });

    const notify = makeNotifyOnTerminal(deps(vi.fn().mockResolvedValue({ inputs: { agentId: "a1" } })));
    await notify("wi1", "completed");

    expect(emailSendMock).toHaveBeenCalledOnce();
    const arg = emailSendMock.mock.calls[0][0];
    expect(arg.channel).toBe("alice@example.com");
    expect(arg.title).toContain("Dev Agent");
    expect(consoleSendMock).not.toHaveBeenCalled();
    expect(slackSendMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @journeyman/api-server -- notify-on-terminal`
Expected: FAIL — the current implementation hits `else { return; }` for `provider === "email"`, so `emailSendMock` is never called.

- [ ] **Step 3: Rewrite the provider-construction block**

In `packages/api-server/src/services/notify-on-terminal.ts`, replace the import line:

```ts
import { SlackProvider, ConsoleProvider } from "@journeyman/notification-provider";
```

with:

```ts
import { buildNotificationProvider } from "@journeyman/notification-provider";
```

Then replace the whole provider-selection block — the `let provider: INotificationProvider;` declaration through the closing `}` of the final `else { return; }` (the `if (conn.provider === "console") { ... } else if (conn.provider === "slack") { ... } else { return; }` chain) — with:

```ts
      const sealed = await getConnectionSealed(deps.pool, connectionId);
      const credential = sealed ? open(sealed) : "";
      const provider = buildNotificationProvider(
        conn.provider,
        (conn.config ?? {}) as Record<string, unknown>,
        credential,
      );
```

The surrounding behavior is unchanged: still gated on `conn.category === "notification"` (the early `return` above this block stays), still wrapped in the outer `try { ... } catch {}` that swallows all failures, still calls `provider.send({ channel: agent.notifications.target ?? "", title: ..., message: ..., sessionId: workflowInstanceId })`. An unknown provider now throws inside the try and is swallowed exactly like a send failure.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @journeyman/api-server -- notify-on-terminal`
Expected: PASS — all cases green, including the new email case and the unchanged slack/console/non-notification/never-throws cases.

---

## Task 5: Clear the stale "Slack not implemented" flags

**Files:**
- Modify: `packages/core/src/registries/provider-catalog.ts:51`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Flip the catalog flag**

In `packages/core/src/registries/provider-catalog.ts`, change line 51 from:

```ts
  { kind: "notification", value: "slack",   label: "Slack",   implemented: false },
```

to:

```ts
  { kind: "notification", value: "slack",   label: "Slack",   implemented: true },
```

- [ ] **Step 2: Update the CLAUDE.md status table**

In `CLAUDE.md`, find the Implementation Status row:

```
| `GitLabProvider` / `JiraProvider` / `LinearProvider` / `MondayProvider` / `SlackProvider` | Stub |
```

Remove `SlackProvider` from that stub row so it reads:

```
| `GitLabProvider` / `JiraProvider` / `LinearProvider` / `MondayProvider` | Stub |
```

and add a new row directly below it:

```
| `SlackProvider` (notifications) | Implemented (token → chat.postMessage; webhook → incoming webhook) |
```

---

## Task 6: Add the `notificationFields` registry to core

**Files:**
- Create: `packages/core/src/registries/notification-fields.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create the registry module**

Create `packages/core/src/registries/notification-fields.ts`:

```ts
/**
 * The input boxes an editor should show for a notification provider. All
 * fields persist into the same three backend slots on SendNotificationOptions
 * (`channel`, `title`, `message`); only the visible labels/help/order differ.
 * Single source of truth shared by the flow-editor step config and the agent
 * notifications section.
 */
export interface NotificationField {
  key: "channel" | "title" | "message";
  label: string;
  help?: string;
  placeholder?: string;
  required?: boolean;
}

export function notificationFields(provider?: string): NotificationField[] {
  switch (provider) {
    case "email":
      return [
        { key: "channel", label: "Recipient email", help: "Address the notification is sent to.", placeholder: "alice@acme.com", required: true },
        { key: "title", label: "Subject", help: "Email subject line.", placeholder: "Run finished" },
        { key: "message", label: "Email body", help: "Plain-text body of the email.", required: true },
      ];
    case "slack":
      return [
        { key: "channel", label: "Channel / user", help: "Channel (#alerts) or user ID. Ignored for incoming webhooks.", placeholder: "#alerts or U01234", required: true },
        { key: "message", label: "Message", help: "Message text to post.", required: true },
      ];
    case "console":
      return [
        { key: "message", label: "Message", help: "Text written to the console log.", required: true },
      ];
    default:
      return [
        { key: "channel", label: "Channel / recipient", help: "Where to deliver the notification.", required: true },
        { key: "message", label: "Message", help: "Message text.", required: true },
      ];
  }
}
```

- [ ] **Step 2: Export from the core barrel**

In `packages/core/src/index.ts`, add this line next to the other registry exports (after line 135, `export * from "./registries/builder-availability.ts";`):

```ts
export * from "./registries/notification-fields.ts";
```

---

## Task 7: Add an optional `title` (subject) input to the send-message step

**Files:**
- Modify: `packages/steps/src/notifications/send-message.meta.ts`
- Modify: `packages/steps/src/notifications/send-message.tsx`

- [ ] **Step 1: Add `title` to the config schema and input fields**

In `packages/steps/src/notifications/send-message.meta.ts`, update `sendMessageConfigSchema` to include an optional `title`:

```ts
export const sendMessageConfigSchema = z.object({
  channel: z.string().min(1),
  title: z.string().optional(),
  message: z.string().min(1),
  blocks: z.string().optional(),
});
```

and add a `title` entry to `sendMessageInputFields` (between `channel` and `message`):

```ts
export const sendMessageInputFields: InputFields = {
  channel: { shape: { type: "string" }, label: "Channel / target", required: true },
  title:   { shape: { type: "string" }, label: "Subject" },
  message: { shape: { type: "string" }, label: "Message", required: true },
  blocks:  { shape: { type: "object", fields: {} }, label: "Rich blocks (optional)" },
};
```

- [ ] **Step 2: Add `title` to the step definition type and defaults**

In `packages/steps/src/notifications/send-message.tsx`, update the `SendMessageConfig` interface and `defaultConfig`. Change the interface:

```ts
interface SendMessageConfig {
  channel: string;
  title?: string;
  message: string;
  blocks?: string;
}
```

and the `defaultConfig`:

```ts
  defaultConfig: { channel: "", title: "", message: "", blocks: "" },
```

Leave `configFields` as-is — Task 9 makes the flow editor render provider-aware fields (including `title`) dynamically, so the static `configFields` here is only the neutral fallback and does not need a `title` entry.

---

## Task 8: Add an `onResolved` callback to `ConnectionPicker`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/ConnectionPicker.tsx`

- [ ] **Step 1: Add the prop and fire it when the selection resolves**

In `packages/flow-editor/src/properties-panel/ConnectionPicker.tsx`, add `onResolved` to the `Props` interface:

```ts
interface Props {
  category: ConnectionCategory;
  value: string | null | undefined;
  onChange: (connectionId: string | null) => void;
  readOnly?: boolean;
  onResolved?: (connection: Connection | null) => void;
}
```

Destructure it in the component signature:

```ts
export function ConnectionPicker({ category, value, onChange, readOnly, onResolved }: Props) {
```

Add an effect (after the existing `useEffect` that fetches connections) that reports the resolved connection whenever the value or the fetched list changes:

```ts
  useEffect(() => {
    if (!onResolved) return;
    onResolved(connections.find(c => c.id === value) ?? null);
  }, [value, connections, onResolved]);
```

The existing render and fetch logic are unchanged. Existing callers that do not pass `onResolved` are unaffected (it is optional and guarded).

---

## Task 9: Render provider-aware inputs for the send-message step

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/ConfigTab.tsx`

- [ ] **Step 1: Import the registry and add helper + state**

In `packages/flow-editor/src/properties-panel/ConfigTab.tsx`, add to the existing `@journeyman/core` import (line 4 currently imports `codingModelKeySlot`):

```ts
import { codingModelKeySlot, notificationFields } from "@journeyman/core";
```

Do **not** import the step-type constant from `@journeyman/steps` — that would create a flow-editor → steps → flow-editor import cycle (the step definition imports `StepDefinition` from flow-editor). Instead, the notification step is detected via the catalog's `connectionCategory` (Step 2).

Add a module-level helper above the `ConfigTab` component (after `nextMaxStepsConfig`):

```ts
/** Build the editor field map for the send-message step from the selected
 *  notification connection's provider. Keys stay channel/title/message so the
 *  worker and providers are unchanged — only labels/help/order vary. */
function notificationConfigFields(
  provider?: string,
): Record<string, import("../step-definition.ts").FieldMeta> {
  const out: Record<string, import("../step-definition.ts").FieldMeta> = {};
  for (const f of notificationFields(provider)) {
    out[f.key] = {
      label: f.label,
      widget: f.key === "message" ? "textarea" : "text",
      help: f.help,
    };
  }
  return out;
}
```

Inside the `ConfigTab` component, after the existing `const [pickerFor, setPickerFor] = useState<string | null>(null);` (line 64), add:

```ts
  const [notifyProvider, setNotifyProvider] = useState<string | undefined>(undefined);
```

- [ ] **Step 2: Compute the effective config fields**

In `ConfigTab`, after `catalogEntry` is defined (line 140) add. Any step whose catalog entry declares `connectionCategory: "notification"` (currently `send-message`) gets provider-aware fields:

```ts
  const isNotificationStep = catalogEntry?.connectionCategory === "notification";
  const effectiveConfigFields = isNotificationStep
    ? notificationConfigFields(notifyProvider)
    : definition?.configFields;
```

- [ ] **Step 3: Use the effective fields in the render and key sets**

Replace the three usages of `definition?.configFields` that drive rendering with `effectiveConfigFields`:

1. `configFieldKeys` (line 141) — change:

```ts
  const configFieldKeys = new Set(effectiveConfigFields ? Object.keys(effectiveConfigFields) : []);
```

2. The SchemaForm guard + `fields` prop (lines 442-457) — change the outer guard and the `<SchemaForm>` block to use `effectiveConfigFields`:

```ts
      {(effectiveConfigFields || bindOnlyFields.length > 0) && (
        <div style={{ position: "relative" }}>
          {effectiveConfigFields && (
            <SchemaForm
              config={config}
              fields={effectiveConfigFields}
              schema={definition?.configSchema}
              onChange={next => onChange({ ...node, config: next })}
              readOnly={readOnly}
              boundKeys={boundKeys}
              renderFieldBindControl={renderFieldBindControl}
              renderBoundPill={renderBoundPill}
              renderFieldInput={renderMentionField}
              warningsByKey={nodeWarningsByKey}
            />
          )}
```

3. `expectedForKey` fallback (line 161) — change:

```ts
    return shapeForWidget(effectiveConfigFields?.[key]?.widget);
```

(Leave the stale-key sweep at lines 88-94 referencing `definition?.configFields` untouched — it is keyed on `[node.id, node.stepType]` and must reflect the static definition, not the dynamic provider view.)

- [ ] **Step 4: Wire the connection picker to set the provider**

In the `ConnectionPicker` render (lines 311-316), add the `onResolved` prop:

```ts
          <ConnectionPicker
            category={catalogEntry.connectionCategory}
            value={node.connectionId}
            onChange={connectionId => onChange({ ...node, connectionId })}
            onResolved={conn => setNotifyProvider(conn?.provider)}
            readOnly={readOnly}
          />
```

- [ ] **Step 5: Verify the flow-editor and steps packages still build via the final typecheck**

(No standalone unit test for this UI change; correctness is confirmed by the final `npm run typecheck` in Task 11 and by the existing flow-editor test suite, which runs in Task 11.)

---

## Task 10: Provider-aware recipient field in the agent Notifications section

**Files:**
- Modify: `packages/web/src/components/agents/sections/NotificationsSection.tsx`

- [ ] **Step 1: Derive the provider and drive the recipient field copy**

In `packages/web/src/components/agents/sections/NotificationsSection.tsx`, add the import:

```ts
import { notificationFields } from "@journeyman/core";
```

Inside the component, after the `notifyConnections` state/effect, derive the selected provider and the recipient-field copy:

```ts
  const selectedProvider = notifyConnections.find((c) => c.id === a.notifications.connectionId)?.provider;
  const recipient = notificationFields(selectedProvider).find((f) => f.key === "channel");
```

Update the connection field help (line 33) to drop the Slack-specific wording:

```tsx
        <FieldLabel help="Channel used to send run notifications">Notification connection</FieldLabel>
```

Replace the "Channel / target" field block (lines 52-61) with a provider-aware version. When the selected provider has no recipient field (e.g. `console`, which only takes a message), fall back to neutral copy:

```tsx
      <div>
        <FieldLabel help={recipient?.help ?? "Where to deliver run notifications"}>
          {recipient?.label ?? "Channel / recipient"}
        </FieldLabel>
        <input
          className={inputCls}
          disabled={locked}
          placeholder={recipient?.placeholder ?? "channel or recipient"}
          value={a.notifications.target ?? ""}
          onChange={(e) => patch({ notifications: { ...a.notifications, target: e.target.value || undefined } })}
        />
      </div>
```

(The "Notify on success / failure" checkboxes below are unchanged. The agent message body remains the auto-generated run-status line — no message box here.)

---

## Task 11: Final verification — typecheck, boundaries, and test suites

**Files:** none (verification only)

- [ ] **Step 1: Run the full typecheck across the monorepo**

Run: `npm run typecheck`
Expected: PASS — 0 errors. (The 11 errors from `notification-provider/src/providers/email/*` reported by `@journeyman/orchestrator` and the package itself are gone.)

- [ ] **Step 2: Run the import-boundary check**

Run: `npm run check:boundaries`
Expected: PASS — no violations. The new `build-provider.ts` imports only `@journeyman/core` types plus sibling provider classes within the same package; `notification-fields.ts` is pure and imports nothing.

- [ ] **Step 3: Run the affected package test suites**

Run: `npm test -w @journeyman/notification-provider`
Expected: PASS — EmailProvider tests + `buildNotificationProvider` tests green.

Run: `npm test -w @journeyman/api-server -- notify-on-terminal`
Expected: PASS — all `makeNotifyOnTerminal` cases green, including the new email case.

- [ ] **Step 4: Report results**

Summarize: typecheck error count (must be 0), boundary check result, and the pass/fail of each test suite. Do not commit — leave all changes in the working tree on `master`.

---

## Self-Review Notes

- **Spec coverage:** §3a → Task 1; §3b → Task 2; §3c → Tasks 3-4; §3d → Task 5; §3e → Tasks 6-10. Final verification → Task 11. All spec sections covered.
- **Type consistency:** `buildNotificationProvider(provider, config, credential)` signature is identical across Tasks 2, 3, 4. `notificationFields(provider)` / `NotificationField` identical across Tasks 6, 9, 10. The `channel`/`title`/`message` slot keys are consistent across the meta (Task 7), the registry (Task 6), and the backend handler (unchanged).
- **No commits:** per the requester, no task includes `git add`/`git commit`. Verification is per-task tests + one final typecheck (Task 11).
