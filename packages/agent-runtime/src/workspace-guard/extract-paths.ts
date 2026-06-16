import { resolveWithinWorkspace } from "./resolve.ts";

/** Path argument(s) a given tool call would touch, for boundary validation. */
export function extractPaths(toolName: string, input: unknown): string[] {
  const o = (input ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
      return typeof o.file_path === "string" ? [o.file_path] : [];
    case "Grep":
    case "Glob":
      return typeof o.path === "string" ? [o.path] : [];
    default:
      return [];
  }
}

/**
 * Best-effort scan of a shell command for a path that escapes `root`. Catches
 * literal absolute paths and `cd <target>` outside the workspace. Does NOT
 * catch obfuscation (env vars, subshells, command substitution) — this is a
 * focus guardrail, not a security boundary. Returns the first offending token
 * or null.
 */
export function findBashEscape(command: string, root: string): string | null {
  const cd = command.match(/\bcd\s+(['"]?)([^\s'";|&]+)\1/);
  if (cd) {
    const target = cd[2];
    const looksWindows = /^(?:[A-Za-z]:\\|\\\\)/.test(target);
    const escapes = looksWindows ? isWindowsPathOutside(root, target) : !resolveWithinWorkspace(root, target).ok;
    if (escapes) return target;
  }
  const absTokens = command.match(/(?<![\w/=])\/[^\s'";|&)<>]+/g) ?? [];
  for (const tok of absTokens) {
    if (!resolveWithinWorkspace(root, tok).ok) return tok;
  }
  // Windows drive-absolute (C:\…) and UNC (\\server\share) tokens — the POSIX
  // scan above never matches these, so on Windows they'd otherwise slip through.
  const winTokens = command.match(/(?<!\w)(?:[A-Za-z]:\\|\\\\)[^\s'";|&)<>]*/g) ?? [];
  for (const tok of winTokens) {
    if (isWindowsPathOutside(root, tok)) return tok;
  }
  return null;
}

/** True if a Windows drive/UNC token is not contained within `root` (case-insensitive). */
function isWindowsPathOutside(root: string, tok: string): boolean {
  const norm = (p: string) => p.replace(/\//g, "\\").toLowerCase().replace(/\\+$/, "");
  const t = norm(tok);
  if (t.includes("..")) return true; // any climb-out is suspect
  const r = norm(root);
  return !(t === r || t.startsWith(r + "\\"));
}
