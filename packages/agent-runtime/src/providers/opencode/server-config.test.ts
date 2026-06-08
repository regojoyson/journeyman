import { describe, it, expect } from "vitest";
import { buildServerConfig, applyEnv, freePort } from "./server-config.ts";
import type { OpenCodeProviderConfig } from "./types.ts";
import type { ResolvedMcpInstance } from "@journeyman/core";

const cfg: OpenCodeProviderConfig = { mode: "managed", model: { providerID: "anthropic", modelID: "x" } };

describe("buildServerConfig", () => {
  it("sets bypass-style permissions including skill", () => {
    const c = buildServerConfig(cfg, undefined);
    expect(c.permission).toMatchObject({ bash: "allow", edit: "allow", webfetch: "allow", websearch: "allow", skill: "allow" });
  });
  it("includes mcp only when instances are present", () => {
    expect(buildServerConfig(cfg, undefined).mcp).toBeUndefined();
    const mcps: ResolvedMcpInstance[] = [{ id: "1", name: "fs", transport: "stdio", command: "x", args: [], env: {}, systemPrompt: null }];
    expect(buildServerConfig(cfg, mcps).mcp).toHaveProperty("fs");
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
