import { describe, it, expect } from "vitest";
import { buildServerConfig, applyEnv, freePort } from "./server-config.ts";
import type { OpenCodeProviderConfig } from "./types.ts";
import type { ResolvedMcpInstance, ResolvedSkillPackage } from "@journeyman/core";

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
      lmstudio: {
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: "http://host.docker.internal:1234/v1", includeUsage: true },
        models: { "llama-3.1": {} },
      },
    });
  });
  it("omits the provider block for a cloud model (no baseUrl)", () => {
    const c = buildServerConfig(cfg, {
      model: "anthropic/claude-sonnet-4-6",
      modelConfig: { requiresApiKey: true },
      env: { ANTHROPIC_API_KEY: "sk-x" },
    });
    expect(c.provider).toBeUndefined();
  });
  it("injects apiKey from env under the derived label", () => {
    const c = buildServerConfig(cfg, {
      model: "myvllm/mistral",
      modelConfig: { baseUrl: "http://gw/v1", npm: "@ai-sdk/openai-compatible", requiresApiKey: true },
      env: { MYVLLM_API_KEY: "secret-123" },
    });
    expect((c.provider as any).myvllm.options).toEqual({ baseURL: "http://gw/v1", apiKey: "secret-123", includeUsage: true });
  });

  it("defaults includeUsage on for an openai-compatible custom endpoint", () => {
    const c = buildServerConfig(cfg, {
      model: "lmstudio/qwen",
      modelConfig: { baseUrl: "http://host:1234/v1" }, // npm defaults to openai-compatible
    });
    expect((c.provider as any).lmstudio.options.includeUsage).toBe(true);
  });

  it("respects an explicit includeUsage:false override", () => {
    const c = buildServerConfig(cfg, {
      model: "lmstudio/qwen",
      modelConfig: { baseUrl: "http://host:1234/v1", includeUsage: false },
    });
    expect((c.provider as any).lmstudio.options.includeUsage).toBe(false);
  });

  it("does not inject includeUsage for a non-openai-compatible npm unless set", () => {
    const c = buildServerConfig(cfg, {
      model: "custom/claude",
      modelConfig: { baseUrl: "http://gw/v1", npm: "@ai-sdk/anthropic" },
    });
    expect("includeUsage" in (c.provider as any).custom.options).toBe(false);
  });

  it("injects includeUsage for a non-openai-compatible npm when explicitly set", () => {
    const c = buildServerConfig(cfg, {
      model: "custom/claude",
      modelConfig: { baseUrl: "http://gw/v1", npm: "@ai-sdk/anthropic", includeUsage: true },
    });
    expect((c.provider as any).custom.options.includeUsage).toBe(true);
  });
  it("caps the build agent at the requested maxSteps", () => {
    const c = buildServerConfig(cfg, { maxSteps: 25 });
    expect(c.agent).toEqual({ build: { maxSteps: 25 } });
  });
  it("applies the default step budget (80) when maxSteps is omitted", () => {
    const c = buildServerConfig(cfg, {});
    expect(c.agent).toEqual({ build: { maxSteps: 80 } });
  });
  it("applies the default step budget when maxSteps is non-positive", () => {
    expect((buildServerConfig(cfg, { maxSteps: 0 }).agent as any).build.maxSteps).toBe(80);
    expect((buildServerConfig(cfg, { maxSteps: -5 }).agent as any).build.maxSteps).toBe(80);
  });
  it("registers enabled skills as per-skill paths", () => {
    const skills: ResolvedSkillPackage[] = [
      { id: "1", name: "pkgA", localPath: "/ws/skills/pkgA", enabledSkills: ["alpha", "beta"], cliType: "opencode" },
      { id: "2", name: "pkgB", localPath: "/ws/skills/pkgB", enabledSkills: ["gamma"], cliType: "opencode" },
    ];
    const c = buildServerConfig(cfg, { skills });
    expect(c.skills).toEqual({ paths: ["/ws/skills/pkgA/alpha", "/ws/skills/pkgA/beta", "/ws/skills/pkgB/gamma"] });
  });
  it("omits the skills block when there are no skills", () => {
    expect(buildServerConfig(cfg, {}).skills).toBeUndefined();
    expect(buildServerConfig(cfg, { skills: [] }).skills).toBeUndefined();
  });
  it("emits skills alongside the permission/agent blocks", () => {
    const skills: ResolvedSkillPackage[] = [
      { id: "1", name: "p", localPath: "/ws/p", enabledSkills: ["s"], cliType: "opencode" },
    ];
    const c = buildServerConfig(cfg, { skills, maxSteps: 5 });
    expect(c.permission).toMatchObject({ bash: "allow" });
    expect((c.agent as any).build.maxSteps).toBe(5);
    expect(c.skills).toEqual({ paths: ["/ws/p/s"] });
  });
  it("still emits permission/mcp/provider blocks alongside the agent block", () => {
    const mcps: ResolvedMcpInstance[] = [{ id: "1", name: "fs", transport: "stdio", command: "x", args: [], env: {}, systemPrompt: null }];
    const c = buildServerConfig(cfg, {
      mcps,
      model: "lmstudio/llama-3.1",
      modelConfig: { baseUrl: "http://host:1234/v1" },
      maxSteps: 10,
    });
    expect(c.permission).toMatchObject({ bash: "allow" });
    expect(c.mcp).toHaveProperty("fs");
    expect(c.provider).toHaveProperty("lmstudio");
    expect(c.agent).toEqual({ build: { maxSteps: 10 } });
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
