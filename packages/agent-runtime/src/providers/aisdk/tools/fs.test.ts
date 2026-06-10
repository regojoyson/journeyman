import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileImpl, writeFileImpl, editFileImpl } from "./fs.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "aisdk-fs-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("fs tool impls", () => {
  it("writes then reads a file (paths resolved against cwd)", async () => {
    await writeFileImpl({ path: "a.txt", content: "hi" }, { cwd: dir });
    const r = await readFileImpl({ path: "a.txt" }, { cwd: dir });
    expect(r.content).toBe("hi");
  });
  it("edits a file by replacing a unique string", async () => {
    writeFileSync(join(dir, "b.txt"), "one two three");
    await editFileImpl({ path: "b.txt", oldString: "two", newString: "TWO" }, { cwd: dir });
    const r = await readFileImpl({ path: "b.txt" }, { cwd: dir });
    expect(r.content).toBe("one TWO three");
  });
  it("edit fails when oldString is not unique", async () => {
    writeFileSync(join(dir, "c.txt"), "x x");
    await expect(editFileImpl({ path: "c.txt", oldString: "x", newString: "y" }, { cwd: dir })).rejects.toThrow(/unique|not found/i);
  });
});
