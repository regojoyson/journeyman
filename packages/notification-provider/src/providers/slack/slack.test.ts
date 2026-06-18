/**
 * @file SlackProvider unit tests — fetch mocked, token + webhook paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SlackProvider } from "./index.ts";

describe("SlackProvider", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has correct meta", () => {
    expect(SlackProvider.meta.id).toBe("slack");
    expect(SlackProvider.meta.category).toBe("notification");
  });

  it("token method: posts to chat.postMessage and returns messageId", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, ts: "1700000000.000100" }),
    });

    const provider = new SlackProvider({ method: "token", token: "xoxb-abc" });
    const result = await provider.send({
      channel: "#alerts",
      title: "Run failed",
      message: "Run xyz failed.",
      sessionId: "sess-1",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("1700000000.000100");
    expect(result.sessionId).toBe("sess-1");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    expect(init.headers.Authorization).toBe("Bearer xoxb-abc");
    const body = JSON.parse(init.body);
    expect(body.channel).toBe("#alerts");
    expect(body.text).toContain("Run failed");
    expect(body.text).toContain("Run xyz failed.");
  });

  it("token method: returns error when Slack responds ok:false", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: "channel_not_found" }),
    });

    const provider = new SlackProvider({ method: "token", token: "xoxb-abc" });
    const result = await provider.send({ channel: "#nope", message: "hi", sessionId: "sess-2" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("channel_not_found");
    expect(result.sessionId).toBe("sess-2");
  });

  it("webhook method: POSTs the webhook URL with text and returns success", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    const provider = new SlackProvider({ method: "webhook", webhookUrl: "https://hooks.slack.com/x" });
    const result = await provider.send({ channel: "", title: "Done", message: "ok", sessionId: "sess-3" });

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe("sess-3");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/x");
    const body = JSON.parse(init.body);
    expect(body.text).toContain("Done");
  });

  it("webhook method: returns error on non-ok HTTP status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });

    const provider = new SlackProvider({ method: "webhook", webhookUrl: "https://hooks.slack.com/x" });
    const result = await provider.send({ channel: "", message: "ok", sessionId: "sess-4" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("404");
  });

  it("returns error when fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const provider = new SlackProvider({ method: "token", token: "xoxb-abc" });
    const result = await provider.send({ channel: "#c", message: "hi", sessionId: "sess-5" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("network down");
  });
});
