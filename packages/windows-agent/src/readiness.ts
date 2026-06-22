import { access, constants } from "node:fs/promises";
import type { ReadinessReply, ReadinessCheck } from "@journeyman/agent-protocol";

export interface ReadinessOpts {
  bashPath: string | null;
  workspaceRoot: string;
  /** which-style probe for an external tool (real impl spawns `<tool> --version`). */
  probe: (tool: string) => Promise<boolean>;
}

export async function runReadinessChecks(opts: ReadinessOpts): Promise<ReadinessReply> {
  const checks: ReadinessCheck[] = [];
  const required: boolean[] = [];
  // `required: false` makes a check advisory — reported in the scorecard but not
  // a startup gate (the agent still starts when it fails).
  const push = (name: string, ok: boolean, detail = "", required_ = true) => {
    checks.push({ name, ok, detail });
    if (required_) required.push(ok);
  };

  push("bash", !!opts.bashPath, opts.bashPath ?? "not found — install Git for Windows");
  push("git", await opts.probe("git"), "git on PATH");
  push("node", await opts.probe("node"), "node on PATH");
  push("curl", await opts.probe("curl"), "curl on PATH — ships with Windows 10 1803+");
  // Advisory: many workflows never use Python, so a missing interpreter must not
  // block startup — it is only reported so a needed Python is fixed up front.
  push("python", await opts.probe("python"), "python on PATH — advisory; install Python 3 if a workflow needs it", false);
  let writable = false;
  try { await access(opts.workspaceRoot, constants.W_OK); writable = true; } catch { /* not writable */ }
  push("workspace", writable, writable ? opts.workspaceRoot : `not writable: ${opts.workspaceRoot}`);

  return { ready: required.every(Boolean), checks };
}
