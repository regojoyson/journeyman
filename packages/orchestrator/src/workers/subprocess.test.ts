import { describe, it, expect } from "vitest";
import { execTracked } from "./subprocess.ts";

describe("execTracked", () => {
  it("returns success record on exit code 0", async () => {
    const r = await execTracked("node", ["-e", "process.exit(0)"]);
    expect(r.exitCode).toBe(0);
    expect(r.command).toContain("node");
    expect(r.stderrTail).toBe("");
  });

  it("returns error record on non-zero exit with stderr tail", async () => {
    const r = await execTracked("node", ["-e", "console.error('boom'); process.exit(2)"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderrTail).toContain("boom");
  });

  it("truncates stderr to 2KB tail", async () => {
    const script = `for (let i=0;i<5000;i++) process.stderr.write('x'); process.exit(1);`;
    const r = await execTracked("node", ["-e", script]);
    expect(r.stderrTail.length).toBeLessThanOrEqual(2048);
  });

  it("redacts sensitive arg patterns from command record", async () => {
    const r = await execTracked("node", ["-e", "process.exit(0)", "--token=abc123"], {
      redactArgs: ["--token=abc123"],
    });
    expect(r.command).not.toContain("abc123");
  });
});
