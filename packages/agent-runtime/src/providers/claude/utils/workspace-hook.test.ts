import { describe, it, expect } from "vitest";
import { buildWorkspaceHook } from "./workspace-hook.ts";

const root = "/workspace";

async function run(toolName: string, toolInput: unknown) {
  const hooks = buildWorkspaceHook(root);
  const cb = hooks.PreToolUse[0].hooks[0];
  return cb(
    { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput, tool_use_id: "t1", cwd: root } as any,
    "t1",
    { signal: new AbortController().signal },
  );
}

describe("buildWorkspaceHook", () => {
  it("allows an in-workspace Read", async () => {
    const out: any = await run("Read", { file_path: "/workspace/a.ts" });
    expect(out.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });
  it("denies an out-of-workspace Read", async () => {
    const out: any = await run("Read", { file_path: "/etc/passwd" });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("/etc/passwd");
  });
  it("denies a Grep whose path escapes the workspace", async () => {
    const out: any = await run("Grep", { pattern: "x", path: "/var/log" });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });
  it("denies a Bash command reading outside the workspace", async () => {
    const out: any = await run("Bash", { command: "cat /etc/shadow" });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });
  it("allows a Bash command inside the workspace", async () => {
    const out: any = await run("Bash", { command: "git -C /workspace/api status" });
    expect(out.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });
});
