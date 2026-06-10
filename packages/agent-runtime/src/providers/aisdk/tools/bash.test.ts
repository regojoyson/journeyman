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

describe("runBash confinement", () => {
  it("blocks a command referencing a path outside the workspace", async () => {
    const r = await runBash("cat /etc/passwd", { cwd: "/workspace" });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/outside the workspace/);
  });
  it("runs a command that stays inside the workspace", async () => {
    const r = await runBash("echo hello", { cwd: process.cwd() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("hello");
  });
});
