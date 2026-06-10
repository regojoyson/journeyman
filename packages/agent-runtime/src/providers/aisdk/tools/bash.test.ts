import { describe, it, expect } from "vitest";
import { runBash } from "./bash.ts";

describe("runBash", () => {
  it("captures stdout and a zero exit code", async () => {
    const r = await runBash("echo hello", {});
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("hello");
  });
  it("captures a non-zero exit code", async () => {
    const r = await runBash("exit 3", {});
    expect(r.exitCode).toBe(3);
  });
  it("injects env values", async () => {
    const r = await runBash("echo $FOO", { env: { FOO: "bar" } });
    expect(r.stdout.trim()).toBe("bar");
  });
  it("runs in the given cwd", async () => {
    const r = await runBash("pwd", { cwd: "/tmp" });
    expect(r.stdout.trim()).toMatch(/\/tmp$/);
  });
});
