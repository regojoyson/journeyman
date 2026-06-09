import { describe, it, expect } from "vitest";
import { buildServerConfig, applyEnv, freePort } from "./server-config.ts";
import type { OpenCodeProviderConfig } from "./types.ts";
import type { ResolvedMcpInstance } from "@journeyman/core";

const cfg: OpenCodeProviderConfig = { mode: "managed", model: { providerID: "anthropic", modelID: "x" } };

describe("buildServerConfig", () => {
  it("sets bypass-style permissions including skill", () => {
    const c = buildServerConfig(cfg, { mcps: undefined, model: undefined, modelConfig: undefined, env: undefined });
    expect(c.permission).toMatchObject({ bash: "allow", edit: "allow", webfetch: "allow", websearch: "allow", skill: "allow" });
  });
  it("includes mcp only when instances are present", () => {
    expect(buildServerConfig(cfg, {}).mcp).toBeUndefined();
    const mcps: ResolvedMcpInstance[] = [{ id: "1", name: "fs", transport: "stdio", command: "x", args: [], env: {}, systemPrompt: null }];
    expect(buildServerConfig(cfg, { mcps }).mcp).toHaveProperty("fs");
  });
  it("omits the provider block when there is no modelConfig", () => {
    expect(buildServerConfig(cfg, { model: "anthropic/claude-sonnet-4-6" }).provider).toBeUndefined();
  });
  it("emits a provider block keyed by the model's providerID with baseURL + npm default", () => {
    const c = buildServerConfig(cfg, {
      model: "lmstudio/llama-3.1",
      modelConfig: { baseUrl: "http://host.docker.internal:1234/v1" },
    });
    expect(c.provider).toEqual({
      lmstudio: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "http://host.docker.internal:1234/v1" } },
    });
  });
  it("injects apiKey from env when apiKeySlot is set", () => {
    const c = buildServerConfig(cfg, {
      model: "myvllm/mistral",
      modelConfig: { baseUrl: "http://gw/v1", npm: "@ai-sdk/openai-compatible", apiKeySlot: "MY_KEY" },
      env: { MY_KEY: "secret-123" },
    });
    expect((c.provider as any).myvllm.options).toEqual({ baseURL: "http://gw/v1", apiKey: "secret-123" });
  });
});

describe("applyEnv", () => {
  it("sets vars then restores prior values on close", () => {
    const KEY = "JM_TEST_OC_ENV";
    delete process.env[KEY];
    const restore = applyEnv({ [KEY]: "v" });
    expect(process.env[KEY]).toBe("v");
    restore();
    expect(process.env[KEY]).toBeUndefined();
  });
  it("is a no-op for undefined env", () => {
    expect(typeof applyEnv(undefined)).toBe("function");
    applyEnv(undefined)(); // does not throw
  });
});

describe("freePort", () => {
  it("returns a usable port number", async () => {
    const p = await freePort();
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(65536);
  });
});
