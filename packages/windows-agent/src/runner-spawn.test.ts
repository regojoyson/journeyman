import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { spawnRunner } from "./runner-spawn.ts";

const fixture = fileURLToPath(new URL("./__fixtures__/echo-runner.mjs", import.meta.url));

describe("spawnRunner", () => {
  it("pipes the request to stdin, streams stderr log lines, returns the final stdout JSON", async () => {
    const logs: Array<{ line: string; meta?: unknown }> = [];
    const result = await spawnRunner({
      command: process.execPath, args: [fixture], cwd: process.cwd(),
      requestJson: JSON.stringify({ op: "custom-prompt" }), env: {},
      onLog: (line, meta) => logs.push({ line, meta }),
    });
    expect(result.ok).toBe(true);
    expect(result.structured).toEqual({ op: "custom-prompt" });
    expect(logs.map((l) => l.line)).toContain("op=custom-prompt");
    expect(logs.find((l) => l.line === "starting")?.meta).toEqual({ phase: "init" });
  });

  it("rejects when the abort signal fires", async () => {
    const ac = new AbortController();
    const p = spawnRunner({ command: process.execPath, args: [fixture], cwd: process.cwd(), requestJson: "{}", env: {}, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow();
  });
});
