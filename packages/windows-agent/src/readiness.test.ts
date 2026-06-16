import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReadinessChecks } from "./readiness.ts";

describe("runReadinessChecks", () => {
  it("reports ready when bash/git/node resolve and workspace is writable", async () => {
    const root = mkdtempSync(join(tmpdir(), "jm-ready-"));
    const r = await runReadinessChecks({ bashPath: process.execPath, workspaceRoot: root, probe: async () => true });
    expect(r.ready).toBe(true);
    expect(r.checks.find((c) => c.name === "bash")?.ok).toBe(true);
    expect(r.checks.find((c) => c.name === "workspace")?.ok).toBe(true);
  });

  it("reports not-ready with an actionable detail when bash is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "jm-ready-"));
    const r = await runReadinessChecks({ bashPath: null, workspaceRoot: root, probe: async () => true });
    expect(r.ready).toBe(false);
    expect(r.checks.find((c) => c.name === "bash")?.detail).toMatch(/Git for Windows/i);
  });
});
