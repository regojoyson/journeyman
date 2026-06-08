import { describe, it, expect } from "vitest";
import { toOpenCodeMcpConfigs } from "./mcp-adapter.ts";
import type { ResolvedMcpInstance } from "@journeyman/core";

const stdio: ResolvedMcpInstance = {
  id: "1", name: "fs", transport: "stdio",
  command: "npx", args: ["-y", "server-fs"], env: { TOKEN: "t" }, systemPrompt: null,
};
const http: ResolvedMcpInstance = {
  id: "2", name: "remote", transport: "http",
  url: "https://mcp.example.com", env: { AUTHORIZATION: "Bearer abc" }, systemPrompt: null,
};

describe("toOpenCodeMcpConfigs", () => {
  it("maps a stdio instance to a local config (command+args combined)", () => {
    expect(toOpenCodeMcpConfigs([stdio])).toEqual({
      fs: { type: "local", command: ["npx", "-y", "server-fs"], environment: { TOKEN: "t" }, enabled: true },
    });
  });

  it("maps an http/sse instance to a remote config with headers", () => {
    expect(toOpenCodeMcpConfigs([http])).toEqual({
      remote: { type: "remote", url: "https://mcp.example.com", headers: { Authorization: "Bearer abc" }, enabled: true },
    });
  });

  it("de-duplicates colliding names with a numeric suffix", () => {
    const out = toOpenCodeMcpConfigs([stdio, { ...stdio, id: "3" }]);
    expect(Object.keys(out)).toEqual(["fs", "fs-2"]);
  });

  it("returns an empty object for no instances", () => {
    expect(toOpenCodeMcpConfigs([])).toEqual({});
  });
});
