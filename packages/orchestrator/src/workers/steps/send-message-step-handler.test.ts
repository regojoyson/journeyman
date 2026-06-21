import { describe, it, expect, vi } from "vitest";
import { SendMessageStepHandler } from "./send-message-step-handler.ts";
import type { INotificationProvider, StepContext, ProviderFactory, ResolvedConnection } from "@journeyman/core";

const conn = { id: "c1", category: "notification", provider: "slack", credential: "x" } as ResolvedConnection;

function makeCtx(connection?: ResolvedConnection): StepContext {
  return {
    workflowInstanceId: "wf", nodeId: "notify", attempt: 1,
    workspaceDir: "/workspace", signal: new AbortController().signal,
    env: {}, workflowInputs: {},
    log: vi.fn(),
    ...(connection ? { connection } : {}),
  } as unknown as StepContext;
}

function makeHandler(send: INotificationProvider["send"]): SendMessageStepHandler {
  const notification: ProviderFactory<INotificationProvider> = () =>
    ({ send }) as unknown as INotificationProvider;
  return new SendMessageStepHandler({ notification });
}

function makeThrowingHandler(): SendMessageStepHandler {
  const notification: ProviderFactory<INotificationProvider> = () => {
    throw Object.assign(new Error("Unknown notification provider: legacy"), { name: "ConfigurationError" });
  };
  return new SendMessageStepHandler({ notification });
}

describe("SendMessageStepHandler", () => {
  it("success → delivered:true with messageId", async () => {
    const handler = makeHandler(async () => ({ success: true, messageId: "m1" }));
    const r = await handler.run({ channel: "#x", message: "hi" }, makeCtx(conn));
    expect(r.kind).toBe("success");
    expect((r as any).output).toEqual({ delivered: true, messageId: "m1" });
  });

  it("optional (default) + send returns failure → step still succeeds, delivered:false", async () => {
    const handler = makeHandler(async () => ({ success: false, error: "boom" }));
    const r = await handler.run({ channel: "#x", message: "hi" }, makeCtx(conn));
    expect(r.kind).toBe("success");
    expect((r as any).output.delivered).toBe(false);
  });

  it("optional + send throws → step still succeeds, delivered:false", async () => {
    const handler = makeHandler(async () => { throw new Error("network down"); });
    const r = await handler.run({ channel: "#x", message: "hi" }, makeCtx(conn));
    expect(r.kind).toBe("success");
    expect((r as any).output.delivered).toBe(false);
  });

  it("optional + no connection → step succeeds, delivered:false", async () => {
    const handler = makeHandler(async () => ({ success: true }));
    const r = await handler.run({ channel: "#x", message: "hi" }, makeCtx());
    expect(r.kind).toBe("success");
    expect((r as any).output.delivered).toBe(false);
  });

  it("required + send fails → step fails (NotifyFailed, retryable)", async () => {
    const handler = makeHandler(async () => ({ success: false, error: "boom" }));
    const r = await handler.run({ channel: "#x", message: "hi", required: true }, makeCtx(conn));
    expect(r.kind).toBe("failure");
    expect((r as any).failure.errorClass).toBe("NotifyFailed");
    expect((r as any).failure.retryable).toBe(true);
  });

  it("required + no connection → step fails (NoConnection, not retryable)", async () => {
    const handler = makeHandler(async () => ({ success: true }));
    const r = await handler.run({ channel: "#x", message: "hi", required: true }, makeCtx());
    expect(r.kind).toBe("failure");
    expect((r as any).failure.errorClass).toBe("NoConnection");
    expect((r as any).failure.retryable).toBe(false);
  });

  it("optional + provider construction throws (unknown/legacy provider) → success delivered:false", async () => {
    const handler = makeThrowingHandler();
    const r = await handler.run({ channel: "#x", message: "hi" }, makeCtx(conn));
    expect(r.kind).toBe("success");
    expect((r as any).output.delivered).toBe(false);
  });

  it("required + provider construction throws → failure (NotifyFailed)", async () => {
    const handler = makeThrowingHandler();
    const r = await handler.run({ channel: "#x", message: "hi", required: true }, makeCtx(conn));
    expect(r.kind).toBe("failure");
    expect((r as any).failure.errorClass).toBe("NotifyFailed");
  });

  it("missing message: required → InvalidInput failure; optional → success delivered:false", async () => {
    const handler = makeHandler(async () => ({ success: true }));
    const req = await handler.run({ channel: "#x", required: true }, makeCtx(conn));
    expect(req.kind).toBe("failure");
    expect((req as any).failure.errorClass).toBe("InvalidInput");
    const opt = await handler.run({ channel: "#x" }, makeCtx(conn));
    expect(opt.kind).toBe("success");
    expect((opt as any).output.delivered).toBe(false);
  });
});
