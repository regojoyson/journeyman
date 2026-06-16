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
  const push = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });

  push("bash", !!opts.bashPath, opts.bashPath ?? "not found — install Git for Windows");
  push("git", await opts.probe("git"), "git on PATH");
  push("node", await opts.probe("node"), "node on PATH");
  let writable = false;
  try { await access(opts.workspaceRoot, constants.W_OK); writable = true; } catch { /* not writable */ }
  push("workspace", writable, writable ? opts.workspaceRoot : `not writable: ${opts.workspaceRoot}`);

  return { ready: checks.every((c) => c.ok), checks };
}
