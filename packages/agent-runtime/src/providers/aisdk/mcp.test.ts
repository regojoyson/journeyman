import { describe, it, expect } from "vitest";
import { buildMcpTools } from "./mcp.ts";
import type { ResolvedMcpInstance } from "@journeyman/core";

function fakeClientFactory() {
  const closed: string[] = [];
  const create = async (label: string) => ({
    tools: async () => ({ search: { description: label }, fetch: { description: label } }),
    close: async () => { closed.push(label); },
  });
  return { create, closed };
}

describe("buildMcpTools", () => {
  it("prefixes tools with mcp__<name>__ and suffixes name collisions", async () => {
    const f = fakeClientFactory();
    const insts: ResolvedMcpInstance[] = [
      { id: "1", name: "files", transport: "stdio", command: "x", args: [], env: {}, systemPrompt: null },
      { id: "2", name: "files", transport: "stdio", command: "y", args: [], env: {}, systemPrompt: null },
    ];
    let n = 0;
    const { tools, close } = await buildMcpTools(insts, { createClient: () => f.create(`c${n++}`) });
    expect(Object.keys(tools).sort()).toEqual([
      "mcp__files-2__fetch", "mcp__files-2__search", "mcp__files__fetch", "mcp__files__search",
    ]);
    await close();
    expect(f.closed.length).toBe(2);
  });

  it("returns empty tools for no instances", async () => {
    const { tools } = await buildMcpTools([], { createClient: async () => ({ tools: async () => ({}), close: async () => {} }) });
    expect(tools).toEqual({});
  });
});
