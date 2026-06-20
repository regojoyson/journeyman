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
