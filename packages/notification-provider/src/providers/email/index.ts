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
