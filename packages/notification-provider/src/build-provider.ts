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
