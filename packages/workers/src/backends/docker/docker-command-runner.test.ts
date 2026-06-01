import { describe, it, expect } from "vitest";
import { makeProcessCommandRunner } from "./docker-command-runner.ts";

// Test the spawn wrapper against `node` instead of `docker` (no daemon needed).
const node = makeProcessCommandRunner("node");

describe("makeProcessCommandRunner", () => {
  it("captures stdout and exit code 0", async () => {
    const r = await node(["-e", "process.stdout.write('hi')"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("hi");
  });

  it("pipes stdin to the process", async () => {
    const r = await node(["-e", "process.stdin.on('data', d => process.stdout.write(d))"], { stdin: "echoed" });
    expect(r.stdout).toBe("echoed");
  });

  it("captures stderr and a non-zero exit code", async () => {
    const r = await node(["-e", "process.stderr.write('boom'); process.exit(3)"]);
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain("boom");
  });

  it("streams stderr lines to onStderr", async () => {
    const lines: string[] = [];
    await node(["-e", "process.stderr.write('a\\nb\\n')"], { onStderr: (l) => lines.push(l) });
    expect(lines).toEqual(["a", "b"]);
  });
});
