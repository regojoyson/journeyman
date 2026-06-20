import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EmailProvider } from "./index.ts";

// Mock nodemailer — share the same fn ref so default.createTransport === named createTransport
vi.mock("nodemailer", () => {
  const createTransport = vi.fn();
  return { default: { createTransport }, createTransport };
});

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
    vi.mocked(SESClient).mockImplementation(function() { return { send: sendMock }; } as any);
    vi.mocked(SendEmailCommand).mockImplementation(function(input: any) { return input; } as any);

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
    expect(cmdArg.Destination!.ToAddresses).toEqual(["alice@example.com"]);
    expect(cmdArg.Message!.Subject!.Data).toBe("SES subject");
    expect(cmdArg.Message!.Body!.Text!.Data).toBe("SES body");
  });

  it("ses: returns error when SESClient.send throws", async () => {
    const { SESClient } = await import("@aws-sdk/client-ses");
    vi.mocked(SESClient).mockImplementation(function() {
      return { send: vi.fn().mockRejectedValue(new Error("InvalidClientTokenId")) };
    } as any);

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
