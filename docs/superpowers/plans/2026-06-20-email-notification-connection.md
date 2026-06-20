# Email Notification Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `email` as a notification connection provider supporting SMTP, Resend, SendGrid, Mailgun, and AWS SES.

**Architecture:** Single `EmailProvider` class in `notification-provider` with a discriminated union on `method`; the delivery method and non-secret config are stored in the connection's `config` JSONB column, the secret (password/API key) in the encrypted `credential` column. Follows the Slack `method: "token" | "webhook"` pattern exactly.

**Tech Stack:** `nodemailer` (SMTP), `@aws-sdk/client-ses` (SES), native `fetch` (Resend/SendGrid/Mailgun), `node:net` (SMTP test probe), `vitest` (unit tests).

---

### Task 1: Register `email` in provider catalog and update type comment

**Files:**
- Modify: `packages/core/src/registries/provider-catalog.ts`
- Modify: `packages/core/src/types/connection.types.ts`

- [ ] **Step 1: Add `email` entry to PROVIDER_CATALOG**

  In `packages/core/src/registries/provider-catalog.ts`, add after the `slack` entry:

  ```ts
  // notification — credentials come from connections, not secret slots
  { kind: "notification", value: "console", label: "Console", implemented: true, isDefault: true },
  { kind: "notification", value: "slack",   label: "Slack",   implemented: false },
  { kind: "notification", value: "email",   label: "Email",   implemented: true },
  ```

- [ ] **Step 2: Update the provider comment in connection.types.ts**

  In `packages/core/src/types/connection.types.ts`, change the comment on line 13:

  ```ts
  provider: string; // git: "github" | "gitlab" ; notification: "slack" | "console" | "email"
  ```

---

### Task 2: Install new dependencies

**Files:**
- Modify: `packages/notification-provider/package.json`

- [ ] **Step 1: Add `nodemailer` and `@aws-sdk/client-ses` to package.json**

  Replace the `dependencies` block in `packages/notification-provider/package.json`:

  ```json
  "dependencies": {
    "@aws-sdk/client-ses": "^3.803.0",
    "@journeyman/core": "*",
    "nodemailer": "^6.10.1"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "@types/nodemailer": "^6.4.17",
    "typescript": "^6.0.3",
    "vitest": "^4.1.8"
  }
  ```

- [ ] **Step 2: Install dependencies from repo root**

  ```bash
  npm install
  ```

  Expected: lock file updated, no errors.

---

### Task 3: Implement `EmailProvider` (TDD)

**Files:**
- Create: `packages/notification-provider/src/providers/email/index.ts`
- Create: `packages/notification-provider/src/providers/email/email.test.ts`

- [ ] **Step 1: Write the failing tests**

  Create `packages/notification-provider/src/providers/email/email.test.ts`:

  ```ts
  import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
  import { EmailProvider } from "./index.ts";

  // Mock nodemailer
  vi.mock("nodemailer", () => ({
    default: {
      createTransport: vi.fn(),
    },
    createTransport: vi.fn(),
  }));

  // Mock @aws-sdk/client-ses
  vi.mock("@aws-sdk/client-ses", () => ({
    SESClient: vi.fn(),
    SendEmailCommand: vi.fn(),
  }));

  describe("EmailProvider", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
      fetchMock.mockReset();
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    });

    // ── SMTP ────────────────────────────────────────────────────────────────

    it("smtp: sends via nodemailer and returns success", async () => {
      const sendMailMock = vi.fn().mockResolvedValue({ messageId: "smtp-mid-1" });
      const { createTransport } = await import("nodemailer");
      vi.mocked(createTransport).mockReturnValue({ sendMail: sendMailMock } as any);

      const provider = new EmailProvider({
        method: "smtp",
        host: "smtp.acme.com",
        port: 587,
        secure: false,
        from: "noreply@acme.com",
        username: "user@acme.com",
        password: "s3cret",
      });

      const result = await provider.send({
        channel: "alice@example.com",
        title: "Run done",
        message: "Your run completed.",
        sessionId: "sess-1",
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("smtp-mid-1");
      expect(result.sessionId).toBe("sess-1");

      expect(createTransport).toHaveBeenCalledWith({
        host: "smtp.acme.com",
        port: 587,
        secure: false,
        auth: { user: "user@acme.com", pass: "s3cret" },
      });
      const callArg = sendMailMock.mock.calls[0][0];
      expect(callArg.from).toBe("noreply@acme.com");
      expect(callArg.to).toBe("alice@example.com");
      expect(callArg.subject).toBe("Run done");
      expect(callArg.text).toBe("Your run completed.");
    });

    it("smtp: uses 'Notification' as subject when title is absent", async () => {
      const sendMailMock = vi.fn().mockResolvedValue({ messageId: "smtp-mid-2" });
      const { createTransport } = await import("nodemailer");
      vi.mocked(createTransport).mockReturnValue({ sendMail: sendMailMock } as any);

      const provider = new EmailProvider({
        method: "smtp", host: "smtp.acme.com", port: 587, secure: false,
        from: "noreply@acme.com", username: "u", password: "p",
      });
      await provider.send({ channel: "bob@example.com", message: "hello", sessionId: "sess-2" });
      expect(sendMailMock.mock.calls[0][0].subject).toBe("Notification");
    });

    it("smtp: returns error when sendMail throws", async () => {
      const { createTransport } = await import("nodemailer");
      vi.mocked(createTransport).mockReturnValue({
        sendMail: vi.fn().mockRejectedValue(new Error("connection refused")),
      } as any);

      const provider = new EmailProvider({
        method: "smtp", host: "bad.host", port: 25, secure: false,
        from: "a@b.com", username: "u", password: "p",
      });
      const result = await provider.send({ channel: "x@y.com", message: "hi", sessionId: "sess-3" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("connection refused");
    });

    // ── Resend ───────────────────────────────────────────────────────────────

    it("resend: POSTs to api.resend.com and returns messageId", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ id: "resend-id-1" }),
      });

      const provider = new EmailProvider({ method: "resend", from: "noreply@acme.com", apiKey: "re_abc" });
      const result = await provider.send({
        channel: "alice@example.com",
        title: "Hello",
        message: "World",
        sessionId: "sess-4",
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("resend-id-1");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.resend.com/emails");
      expect(init.headers["Authorization"]).toBe("Bearer re_abc");
      const body = JSON.parse(init.body);
      expect(body.from).toBe("noreply@acme.com");
      expect(body.to).toEqual(["alice@example.com"]);
      expect(body.subject).toBe("Hello");
      expect(body.text).toBe("World");
    });

    it("resend: returns error on non-ok response", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: "Unauthorized" }) });

      const provider = new EmailProvider({ method: "resend", from: "a@b.com", apiKey: "bad" });
      const result = await provider.send({ channel: "x@y.com", message: "hi", sessionId: "sess-5" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("401");
    });

    // ── SendGrid ─────────────────────────────────────────────────────────────

    it("sendgrid: POSTs to api.sendgrid.com with correct payload", async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

      const provider = new EmailProvider({ method: "sendgrid", from: "noreply@acme.com", apiKey: "SG.abc" });
      const result = await provider.send({
        channel: "alice@example.com",
        title: "SG subject",
        message: "SG body",
        sessionId: "sess-6",
      });

      expect(result.success).toBe(true);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
      expect(init.headers["Authorization"]).toBe("Bearer SG.abc");
      const body = JSON.parse(init.body);
      expect(body.personalizations[0].to[0].email).toBe("alice@example.com");
      expect(body.from.email).toBe("noreply@acme.com");
      expect(body.subject).toBe("SG subject");
      expect(body.content[0].value).toBe("SG body");
    });

    it("sendgrid: returns error on non-ok response", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
      const provider = new EmailProvider({ method: "sendgrid", from: "a@b.com", apiKey: "bad" });
      const result = await provider.send({ channel: "x@y.com", message: "hi", sessionId: "sess-7" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("403");
    });

    // ── Mailgun ──────────────────────────────────────────────────────────────

    it("mailgun: POSTs to US endpoint with Basic auth", async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "mg-id-1", message: "Queued." }) });

      const provider = new EmailProvider({
        method: "mailgun", from: "noreply@acme.com",
        domain: "mg.acme.com", apiKey: "key-abc",
      });
      const result = await provider.send({
        channel: "alice@example.com",
        title: "MG subject",
        message: "MG body",
        sessionId: "sess-8",
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("mg-id-1");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.mailgun.net/v3/mg.acme.com/messages");
      const expectedAuth = "Basic " + Buffer.from("api:key-abc").toString("base64");
      expect(init.headers["Authorization"]).toBe(expectedAuth);
    });

    it("mailgun: uses EU endpoint when region is 'eu'", async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "mg-eu-1", message: "Queued." }) });

      const provider = new EmailProvider({
        method: "mailgun", from: "noreply@acme.com",
        domain: "mg.acme.com", apiKey: "key-eu", region: "eu",
      });
      await provider.send({ channel: "x@y.com", message: "hi", sessionId: "sess-9" });

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.eu.mailgun.net/v3/mg.acme.com/messages");
    });

    it("mailgun: returns error on non-ok response", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
      const provider = new EmailProvider({
        method: "mailgun", from: "a@b.com", domain: "d.com", apiKey: "bad",
      });
      const result = await provider.send({ channel: "x@y.com", message: "hi", sessionId: "sess-10" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("401");
    });

    // ── AWS SES ──────────────────────────────────────────────────────────────

    it("ses: calls SESClient.send with SendEmailCommand", async () => {
      const sendMock = vi.fn().mockResolvedValue({ MessageId: "ses-id-1" });
      const { SESClient, SendEmailCommand } = await import("@aws-sdk/client-ses");
      vi.mocked(SESClient).mockImplementation(() => ({ send: sendMock } as any));
      vi.mocked(SendEmailCommand).mockImplementation((input: any) => input as any);

      const provider = new EmailProvider({
        method: "ses",
        from: "noreply@acme.com",
        region: "us-east-1",
        accessKeyId: "AKID",
        secretAccessKey: "SECRET",
      });
      const result = await provider.send({
        channel: "alice@example.com",
        title: "SES subject",
        message: "SES body",
        sessionId: "sess-11",
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("ses-id-1");

      expect(SESClient).toHaveBeenCalledWith({
        region: "us-east-1",
        credentials: { accessKeyId: "AKID", secretAccessKey: "SECRET" },
      });
      const cmdArg = vi.mocked(SendEmailCommand).mock.calls[0][0];
      expect(cmdArg.Source).toBe("noreply@acme.com");
      expect(cmdArg.Destination.ToAddresses).toEqual(["alice@example.com"]);
      expect(cmdArg.Message.Subject.Data).toBe("SES subject");
      expect(cmdArg.Message.Body.Text.Data).toBe("SES body");
    });

    it("ses: returns error when SESClient.send throws", async () => {
      const { SESClient } = await import("@aws-sdk/client-ses");
      vi.mocked(SESClient).mockImplementation(() => ({
        send: vi.fn().mockRejectedValue(new Error("InvalidClientTokenId")),
      } as any));

      const provider = new EmailProvider({
        method: "ses", from: "a@b.com", region: "us-east-1",
        accessKeyId: "bad", secretAccessKey: "bad",
      });
      const result = await provider.send({ channel: "x@y.com", message: "hi", sessionId: "sess-12" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("InvalidClientTokenId");
    });

    // ── fetch throws ─────────────────────────────────────────────────────────

    it("returns error when fetch throws (resend)", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));
      const provider = new EmailProvider({ method: "resend", from: "a@b.com", apiKey: "k" });
      const result = await provider.send({ channel: "x@y.com", message: "hi", sessionId: "sess-13" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("network down");
    });
  });
  ```

- [ ] **Step 2: Run tests — expect them to fail**

  ```bash
  cd packages/notification-provider && npx vitest run src/providers/email/email.test.ts 2>&1 | tail -20
  ```

  Expected: FAIL — `Cannot find module './index.ts'`

- [ ] **Step 3: Implement `EmailProvider`**

  Create `packages/notification-provider/src/providers/email/index.ts`:

  ```ts
  import nodemailer from "nodemailer";
  import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
  import type { INotificationProvider, IProviderMeta } from "@journeyman/core";
  import type { SendNotificationOptions, SendNotificationResult } from "@journeyman/core";

  export type EmailProviderOptions =
    | { method: "smtp";     host: string; port: number; secure: boolean; from: string; username: string; password: string }
    | { method: "resend";   from: string; apiKey: string }
    | { method: "sendgrid"; from: string; apiKey: string }
    | { method: "mailgun";  from: string; domain: string; apiKey: string; region?: "us" | "eu" }
    | { method: "ses";      from: string; region: string; accessKeyId: string; secretAccessKey: string };

  export class EmailProvider implements INotificationProvider {
    static meta: IProviderMeta = {
      id: "email",
      name: "Email",
      description: "Email notification provider — SMTP, Resend, SendGrid, Mailgun, AWS SES",
      category: "notification",
    };

    constructor(private opts: EmailProviderOptions) {}

    async send(opts: SendNotificationOptions): Promise<SendNotificationResult> {
      const to = opts.channel;
      const subject = opts.title ?? "Notification";
      const text = opts.message;
      const { sessionId } = opts;

      try {
        switch (this.opts.method) {
          case "smtp":
            return await this.sendSmtp(to, subject, text, sessionId);
          case "resend":
            return await this.sendResend(to, subject, text, sessionId);
          case "sendgrid":
            return await this.sendSendGrid(to, subject, text, sessionId);
          case "mailgun":
            return await this.sendMailgun(to, subject, text, sessionId);
          case "ses":
            return await this.sendSes(to, subject, text, sessionId);
        }
      } catch (err: any) {
        return { success: false, error: `Email send failed: ${err?.message ?? String(err)}`, sessionId };
      }
    }

    private async sendSmtp(to: string, subject: string, text: string, sessionId: string): Promise<SendNotificationResult> {
      const o = this.opts as Extract<EmailProviderOptions, { method: "smtp" }>;
      const transport = nodemailer.createTransport({
        host: o.host,
        port: o.port,
        secure: o.secure,
        auth: { user: o.username, pass: o.password },
      });
      const info = await transport.sendMail({ from: o.from, to, subject, text });
      return { success: true, messageId: info.messageId, sessionId };
    }

    private async sendResend(to: string, subject: string, text: string, sessionId: string): Promise<SendNotificationResult> {
      const o = this.opts as Extract<EmailProviderOptions, { method: "resend" }>;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${o.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: o.from, to: [to], subject, text }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        return { success: false, error: `Resend error ${res.status}${body.message ? `: ${body.message}` : ""}`, sessionId };
      }
      const data = await res.json() as { id?: string };
      return { success: true, messageId: data.id, sessionId };
    }

    private async sendSendGrid(to: string, subject: string, text: string, sessionId: string): Promise<SendNotificationResult> {
      const o = this.opts as Extract<EmailProviderOptions, { method: "sendgrid" }>;
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { "Authorization": `Bearer ${o.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: o.from },
          subject,
          content: [{ type: "text/plain", value: text }],
        }),
      });
      if (!res.ok) {
        return { success: false, error: `SendGrid error ${res.status}`, sessionId };
      }
      return { success: true, sessionId };
    }

    private async sendMailgun(to: string, subject: string, text: string, sessionId: string): Promise<SendNotificationResult> {
      const o = this.opts as Extract<EmailProviderOptions, { method: "mailgun" }>;
      const host = o.region === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";
      const auth = Buffer.from(`api:${o.apiKey}`).toString("base64");
      const body = new URLSearchParams({ from: o.from, to, subject, text });
      const res = await fetch(`https://${host}/v3/${o.domain}/messages`, {
        method: "POST",
        headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!res.ok) {
        return { success: false, error: `Mailgun error ${res.status}`, sessionId };
      }
      const data = await res.json() as { id?: string };
      return { success: true, messageId: data.id, sessionId };
    }

    private async sendSes(to: string, subject: string, text: string, sessionId: string): Promise<SendNotificationResult> {
      const o = this.opts as Extract<EmailProviderOptions, { method: "ses" }>;
      const client = new SESClient({
        region: o.region,
        credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey },
      });
      const cmd = new SendEmailCommand({
        Source: o.from,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: { Text: { Data: text, Charset: "UTF-8" } },
        },
      });
      const res = await client.send(cmd);
      return { success: true, messageId: res.MessageId, sessionId };
    }
  }
  ```

- [ ] **Step 4: Run tests — expect them all to pass**

  ```bash
  cd packages/notification-provider && npx vitest run src/providers/email/email.test.ts 2>&1 | tail -20
  ```

  Expected: all 13 tests PASS.

---

### Task 4: Export `EmailProvider` from the package

**Files:**
- Modify: `packages/notification-provider/src/index.ts`

- [ ] **Step 1: Add EmailProvider export**

  Replace the contents of `packages/notification-provider/src/index.ts`:

  ```ts
  export { SlackProvider } from "./providers/slack/index.ts";
  export { ConsoleProvider } from "./providers/console/index.ts";
  export { EmailProvider } from "./providers/email/index.ts";
  export type { EmailProviderOptions } from "./providers/email/index.ts";
  export type { INotificationProvider } from "@journeyman/core";
  ```

- [ ] **Step 2: Run the full notification-provider test suite to confirm nothing broke**

  ```bash
  cd packages/notification-provider && npx vitest run 2>&1 | tail -10
  ```

  Expected: all tests PASS.

---

### Task 5: Wire `email` in the orchestrator notification factory

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Import EmailProvider**

  In `packages/orchestrator/src/cli-worker.ts`, update the notification-provider import (around line 29):

  ```ts
  import { ConsoleProvider, EmailProvider } from "@journeyman/notification-provider";
  import type { EmailProviderOptions } from "@journeyman/notification-provider";
  ```

- [ ] **Step 2: Add `email` case to the notification factory**

  Replace the `notification` factory block (around lines 271–284):

  ```ts
  const notification: ProviderFactory<INotificationProvider> = (key, _env, connection) => {
    const provider = connection?.provider ?? key ?? "console";
    switch (provider) {
      case "console":
        return new ConsoleProvider();
      case "slack":
        throw Object.assign(new Error("Slack provider not yet implemented"), { name: "ConfigurationError" });
      case "email": {
        const cfg = (connection?.config ?? {}) as Record<string, unknown>;
        const method = cfg.method as string | undefined;
        if (!method) {
          throw Object.assign(new Error("Email connection missing config.method"), { name: "ConfigurationError" });
        }
        const from = cfg.from as string;
        const credential = connection?.credential ?? "";
        let opts: EmailProviderOptions;
        if (method === "smtp") {
          opts = {
            method: "smtp",
            host: cfg.host as string,
            port: Number(cfg.port),
            secure: Boolean(cfg.secure),
            from,
            username: cfg.username as string,
            password: credential,
          };
        } else if (method === "resend") {
          opts = { method: "resend", from, apiKey: credential };
        } else if (method === "sendgrid") {
          opts = { method: "sendgrid", from, apiKey: credential };
        } else if (method === "mailgun") {
          opts = {
            method: "mailgun",
            from,
            domain: cfg.domain as string,
            apiKey: credential,
            region: (cfg.region as "us" | "eu" | undefined) ?? "us",
          };
        } else if (method === "ses") {
          opts = {
            method: "ses",
            from,
            region: cfg.region as string,
            accessKeyId: cfg.accessKeyId as string,
            secretAccessKey: credential,
          };
        } else {
          throw Object.assign(new Error(`Unknown email method: ${method}`), { name: "ConfigurationError" });
        }
        return new EmailProvider(opts);
      }
      default: {
        const err = new Error(`Unknown notification provider: ${provider}`) as Error & { name: string };
        err.name = "ConfigurationError";
        throw err;
      }
    }
  };
  ```

---

### Task 6: Implement email test in the connections route

**Files:**
- Modify: `packages/api-server/package.json`
- Modify: `packages/api-server/src/routes/connections.ts`

- [ ] **Step 1: Add `@aws-sdk/client-ses` to api-server's dependencies**

  In `packages/api-server/package.json`, add to the `dependencies` block:

  ```json
  "@aws-sdk/client-ses": "^3.803.0",
  ```

  Then re-run install from the repo root:

  ```bash
  npm install
  ```

- [ ] **Step 2: Add `node:net` and SES imports at the top of the file**

  In `packages/api-server/src/routes/connections.ts`, add after the existing imports:

  ```ts
  import * as net from "node:net";
  ```

- [ ] **Step 3: Add static imports at the top of connections.ts**

  In `packages/api-server/src/routes/connections.ts`, add after the existing imports:

  ```ts
  import * as net from "node:net";
  import { SESClient, GetSendQuotaCommand } from "@aws-sdk/client-ses";
  ```

- [ ] **Step 4: Add `testEmailConnection` helper function**

  Add this function before `registerConnectionRoutes` (around line 78):

  ```ts
  async function testEmailConnection(
    credential: string,
    config: Record<string, unknown>,
  ): Promise<{ ok: boolean; note?: string; error?: string }> {
    const method = config.method as string | undefined;
    if (!method) return { ok: false, error: "missing config.method" };

    if (method === "smtp") {
      const host = config.host as string;
      const port = Number(config.port);
      return new Promise((resolve) => {
        const sock = net.createConnection({ host, port, timeout: 5000 }, () => {
          sock.destroy();
          resolve({ ok: true, note: `Reached ${host}:${port}` });
        });
        sock.once("timeout", () => { sock.destroy(); resolve({ ok: false, error: "connection timed out" }); });
        sock.once("error", (err) => resolve({ ok: false, error: err.message }));
      });
    }

    if (method === "resend") {
      try {
        const r = await fetch("https://api.resend.com/domains", {
          headers: { Authorization: `Bearer ${credential}` },
        });
        if (!r.ok) return { ok: false, error: `Resend returned ${r.status}` };
        return { ok: true, note: "Resend API key valid" };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "network error" };
      }
    }

    if (method === "sendgrid") {
      try {
        const r = await fetch("https://api.sendgrid.com/v3/user/profile", {
          headers: { Authorization: `Bearer ${credential}` },
        });
        if (!r.ok) return { ok: false, error: `SendGrid returned ${r.status}` };
        const data = await r.json() as { username?: string };
        return { ok: true, note: `Connected as ${data.username ?? "unknown"}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "network error" };
      }
    }

    if (method === "mailgun") {
      const domain = config.domain as string;
      const region = (config.region as string | undefined) ?? "us";
      const host = region === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";
      const auth = Buffer.from(`api:${credential}`).toString("base64");
      try {
        const r = await fetch(`https://${host}/v3/domains/${domain}`, {
          headers: { Authorization: `Basic ${auth}` },
        });
        if (!r.ok) return { ok: false, error: `Mailgun returned ${r.status}` };
        return { ok: true, note: `Domain ${domain} verified` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "network error" };
      }
    }

    if (method === "ses") {
      const sesRegion = config.region as string;
      const accessKeyId = config.accessKeyId as string;
      const client = new SESClient({
        region: sesRegion,
        credentials: { accessKeyId, secretAccessKey: credential },
      });
      try {
        const quota = await client.send(new GetSendQuotaCommand({})) as { Max24HourSend?: number };
        return { ok: true, note: `SES quota: ${quota.Max24HourSend ?? "unknown"}/day` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "SES error" };
      }
    }

    return { ok: false, error: `unknown email method: ${method}` };
  }
  ```

- [ ] **Step 5: Replace the notification stub in the `/test` route**

  In `registerConnectionRoutes`, update the notification branch of the test route (around line 184):

  ```ts
  if (conn.category === "notification") {
    if (conn.provider !== "email") {
      return { ok: true, note: "Notification delivery is verified in a later phase." };
    }
    const sealed = await getConnectionSealed(pool, id);
    if (!sealed) { reply.code(404); return { error: "not_found" }; }
    return testEmailConnection(open(sealed), conn.config ?? {});
  }
  ```

  The full updated `app.post("/workspaces/:wsId/connections/:id/test", ...)` handler becomes:

  ```ts
  app.post("/workspaces/:wsId/connections/:id/test", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const conn = await loadConn(id, wsId);
    if (!conn) { reply.code(404); return { error: "not_found" }; }
    if (conn.category === "notification") {
      if (conn.provider !== "email") {
        return { ok: true, note: "Notification delivery is verified in a later phase." };
      }
      const sealed = await getConnectionSealed(pool, id);
      if (!sealed) { reply.code(404); return { error: "not_found" }; }
      return testEmailConnection(open(sealed), conn.config ?? {});
    }
    const sealed = await getConnectionSealed(pool, id);
    if (!sealed) { reply.code(404); return { error: "not_found" }; }
    if (conn.category === "ticket") {
      return testTicketConnection(conn.provider, open(sealed), conn.baseUrl, conn.config);
    }
    // git
    const git = gitProviderFor(conn.provider, open(sealed), conn.baseUrl);
    if (!git.listRepos) return { ok: false, error: "provider does not support repo listing" };
    const res = await git.listRepos({ limit: 100 });
    if (res.error) return { ok: false, error: res.error };
    return { ok: true, repoCount: res.repos.length };
  });
  ```

---

### Task 7: UI — email provider + method sub-form

**Files:**
- Modify: `packages/web/src/routes/ConnectionsPage.tsx`

- [ ] **Step 1: Add email-specific state fields to `AddConnectionModal`**

  In `AddConnectionModal`, the `useState` declarations currently include `category`, `provider`, `label`, `baseUrl`, `credential`, `email`. Add three new state fields after `email`:

  ```tsx
  const [emailMethod, setEmailMethod] = useState<"smtp" | "resend" | "sendgrid" | "mailgun" | "ses">("smtp");
  const [emailFrom, setEmailFrom] = useState("");
  const [emailHost, setEmailHost] = useState("");
  const [emailPort, setEmailPort] = useState("587");
  const [emailSecure, setEmailSecure] = useState(false);
  const [emailUsername, setEmailUsername] = useState("");
  const [emailDomain, setEmailDomain] = useState("");
  const [emailRegion, setEmailRegion] = useState("us");
  const [emailAccessKeyId, setEmailAccessKeyId] = useState("");
  ```

- [ ] **Step 2: Reset email fields when switching category/provider**

  Update `onSelectCategory` to reset email state when leaving email:

  ```tsx
  const onSelectCategory = (next: ConnectionCategory) => {
    setCategory(next);
    if (next === "git") setProvider("github");
    else if (next === "notification") setProvider("slack");
    else setProvider("jira");
    setBaseUrl("");
    setEmail("");
    setEmailMethod("smtp");
    setEmailFrom("");
    setEmailHost("");
    setEmailPort("587");
    setEmailSecure(false);
    setEmailUsername("");
    setEmailDomain("");
    setEmailRegion("us");
    setEmailAccessKeyId("");
  };
  ```

  Also add a handler for when the user switches the notification provider to `email`:

  ```tsx
  const onSelectProvider = (next: string) => {
    setProvider(next);
    setEmailMethod("smtp");
    setEmailFrom("");
    setEmailHost("");
    setEmailPort("587");
    setEmailSecure(false);
    setEmailUsername("");
    setEmailDomain("");
    setEmailRegion("us");
    setEmailAccessKeyId("");
  };
  ```

  Update the provider `<select>` to use `onSelectProvider`:

  ```tsx
  <select className={`${selectCls} block mt-1 w-full`} value={provider} onChange={(e) => onSelectProvider(e.target.value)}>
  ```

- [ ] **Step 3: Add `email` option to the notification provider select**

  Replace the notification provider options:

  ```tsx
  ) : (
    <>
      <option value="slack">Slack</option>
      <option value="console">Console</option>
      <option value="email">Email</option>
    </>
  )}
  ```

- [ ] **Step 4: Add the email method sub-form**

  After the existing `{category === "ticket" && provider === "jira" && (...)}` block, add:

  ```tsx
  {category === "notification" && provider === "email" && (
    <>
      <div>
        <label className="text-sm font-medium">Method</label>
        <select className={`${selectCls} block mt-1 w-full`} value={emailMethod} onChange={(e) => setEmailMethod(e.target.value as typeof emailMethod)}>
          <option value="smtp">SMTP</option>
          <option value="resend">Resend</option>
          <option value="sendgrid">SendGrid</option>
          <option value="mailgun">Mailgun</option>
          <option value="ses">AWS SES</option>
        </select>
      </div>

      <div>
        <label className="text-sm font-medium">From address</label>
        <input className={inputCls} type="email" placeholder="noreply@acme.com" value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)} />
      </div>

      {emailMethod === "smtp" && (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-sm font-medium">Host</label>
              <input className={inputCls} placeholder="smtp.acme.com" value={emailHost} onChange={(e) => setEmailHost(e.target.value)} />
            </div>
            <div className="w-24">
              <label className="text-sm font-medium">Port</label>
              <input className={inputCls} type="number" value={emailPort} onChange={(e) => setEmailPort(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={emailSecure} onChange={(e) => setEmailSecure(e.target.checked)} />
            Use TLS (secure)
          </label>
          <div>
            <label className="text-sm font-medium">Username</label>
            <input className={inputCls} placeholder="user@acme.com" value={emailUsername} onChange={(e) => setEmailUsername(e.target.value)} />
          </div>
        </>
      )}

      {emailMethod === "mailgun" && (
        <>
          <div>
            <label className="text-sm font-medium">Domain</label>
            <input className={inputCls} placeholder="mg.acme.com" value={emailDomain} onChange={(e) => setEmailDomain(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium">Region</label>
            <select className={`${selectCls} block mt-1 w-full`} value={emailRegion} onChange={(e) => setEmailRegion(e.target.value)}>
              <option value="us">US</option>
              <option value="eu">EU</option>
            </select>
          </div>
        </>
      )}

      {emailMethod === "ses" && (
        <>
          <div>
            <label className="text-sm font-medium">Region</label>
            <input className={inputCls} placeholder="us-east-1" value={emailRegion} onChange={(e) => setEmailRegion(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium">Access Key ID</label>
            <input className={inputCls} placeholder="AKIAIOSFODNN7EXAMPLE" value={emailAccessKeyId} onChange={(e) => setEmailAccessKeyId(e.target.value)} />
          </div>
        </>
      )}
    </>
  )}
  ```

- [ ] **Step 5: Update `credentialLabel` to reflect the email method**

  Replace the current `credentialLabel` line:

  ```tsx
  const credentialLabel =
    category === "git" ? "Access token (PAT)"
    : (category === "notification" && provider === "email" && emailMethod === "smtp") ? "Password"
    : (category === "notification" && provider === "email" && emailMethod === "ses") ? "Secret access key"
    : category === "notification" && provider === "email" ? "API key"
    : "API token";
  ```

- [ ] **Step 6: Update `isDisabled` validation to cover email fields**

  Replace the current `isDisabled` expression:

  ```tsx
  const isDisabled =
    !label.trim() ||
    !credential ||
    (category === "ticket" && provider === "jira" && (!baseUrl.trim() || !email.trim())) ||
    (category === "notification" && provider === "email" && !emailFrom.trim()) ||
    (category === "notification" && provider === "email" && emailMethod === "smtp" && (!emailHost.trim() || !emailPort || !emailUsername.trim())) ||
    (category === "notification" && provider === "email" && emailMethod === "mailgun" && !emailDomain.trim()) ||
    (category === "notification" && provider === "email" && emailMethod === "ses" && (!emailRegion.trim() || !emailAccessKeyId.trim()));
  ```

- [ ] **Step 7: Build the `config` object in `handleCreate` for email**

  Update `handleCreate` to assemble email config:

  ```tsx
  const handleCreate = () => {
    const config: Record<string, unknown> = {};
    if (category === "ticket" && provider === "jira") config.email = email;
    if (category === "notification" && provider === "email") {
      config.method = emailMethod;
      config.from = emailFrom.trim();
      if (emailMethod === "smtp") {
        config.host = emailHost.trim();
        config.port = Number(emailPort);
        config.secure = emailSecure;
        config.username = emailUsername.trim();
      }
      if (emailMethod === "mailgun") {
        config.domain = emailDomain.trim();
        config.region = emailRegion;
      }
      if (emailMethod === "ses") {
        config.region = emailRegion.trim();
        config.accessKeyId = emailAccessKeyId.trim();
      }
    }
    onCreate({
      category,
      provider,
      label: label.trim(),
      baseUrl: (category === "ticket" && provider !== "jira") ? undefined : (baseUrl || undefined),
      credential,
      config: Object.keys(config).length > 0 ? config : undefined,
    });
  };
  ```

---

### Task 8: Final typecheck

- [ ] **Step 1: Run typecheck from repo root**

  ```bash
  npm run typecheck
  ```

  Expected: no errors. If errors appear, fix them before proceeding.

- [ ] **Step 2: Run the full test suite to confirm no regressions**

  ```bash
  npm test 2>&1 | tail -30
  ```

  Expected: all tests pass (5 pre-existing failures are acceptable — see `docs/superpowers/memory/deps-campaign-test-baseline.md`).
