import { describe, it, expect, vi, afterEach } from "vitest";
import { guardRunnerStdout } from "./stdout-guard.ts";

const origLog = console.log;
const origInfo = console.info;

afterEach(() => {
  console.log = origLog;
  console.info = origInfo;
});

describe("guardRunnerStdout", () => {
  it("disables AI SDK warning logging", () => {
    guardRunnerStdout();
    expect((globalThis as Record<string, unknown>).AI_SDK_LOG_WARNINGS).toBe(false);
  });

  it("routes console.info and console.log to stderr (never stdout)", () => {
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    guardRunnerStdout();
    console.info("AI SDK Warning System: ...");
    console.log("stray log");
    expect(err).toHaveBeenCalledTimes(2);
    expect(out).not.toHaveBeenCalled();
    err.mockRestore();
    out.mockRestore();
  });
});
