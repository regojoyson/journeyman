import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWithinWorkspace } from "./resolve.ts";

let root: string;
let outside: string;

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), "wsguard-"));
  root = join(base, "workspace");
  outside = join(base, "outside");
  mkdirSync(join(root, "sub"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  // symlink inside root pointing outside → must be rejected
  symlinkSync(outside, join(root, "escape-link"));
});

afterAll(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* noop */ }
});

describe("resolveWithinWorkspace", () => {
  it("accepts a relative path inside root", () => {
    expect(resolveWithinWorkspace(root, "sub/file.ts").ok).toBe(true);
  });
  it("accepts an absolute path inside root", () => {
    expect(resolveWithinWorkspace(root, join(root, "sub/file.ts")).ok).toBe(true);
  });
  it("accepts root itself", () => {
    expect(resolveWithinWorkspace(root, root).ok).toBe(true);
  });
  it("accepts a not-yet-existing write path inside root", () => {
    expect(resolveWithinWorkspace(root, "sub/new/deep/file.ts").ok).toBe(true);
  });
  it("rejects a parent-traversal escape", () => {
    expect(resolveWithinWorkspace(root, "../outside/secret.txt").ok).toBe(false);
  });
  it("rejects an absolute path outside root", () => {
    expect(resolveWithinWorkspace(root, "/etc/passwd").ok).toBe(false);
  });
  it("rejects a sibling-prefix path", () => {
    expect(resolveWithinWorkspace(root, root + "-evil/x").ok).toBe(false);
  });
  it("rejects a symlink that escapes root", () => {
    expect(resolveWithinWorkspace(root, "escape-link/secret.txt").ok).toBe(false);
  });
});
