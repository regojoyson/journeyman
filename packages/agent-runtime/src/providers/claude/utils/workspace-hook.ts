import type { HookCallback, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { extractPaths, findBashEscape, resolveWithinWorkspace } from "../../../workspace-guard/index.ts";

function deny(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `${reason} Operate only within the workspace.`,
    },
  };
}

/**
 * Build a Claude Agent SDK `hooks` object whose PreToolUse callback denies any
 * file/search tool path — or best-effort Bash command — that escapes `root`.
 * Returned under the `hooks` query option; works under `bypassPermissions`.
 */
export function buildWorkspaceHook(root: string): { PreToolUse: [{ hooks: [HookCallback] }] } {
  const callback: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    if (input.tool_name === "Bash") {
      const command = (input.tool_input as { command?: string })?.command ?? "";
      const bad = findBashEscape(command, root);
      return bad
        ? deny(`Command references '${bad}', outside the workspace root '${root}'.`)
        : {};
    }
    for (const p of extractPaths(input.tool_name, input.tool_input)) {
      const r = resolveWithinWorkspace(root, p);
      if (!r.ok) return deny(r.reason);
    }
    return {};
  };
  return { PreToolUse: [{ hooks: [callback] }] };
}
