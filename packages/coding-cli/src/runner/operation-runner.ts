import type { ICodingCLI, OperationRunner } from "@journeyman/core";
import { dispatchOperation } from "./dispatch.ts";

export interface CodingOperationRunnerDeps {
  /** Build a coding provider for a given per-exec env (e.g. ANTHROPIC_API_KEY). */
  makeProvider: (env: Record<string, string>) => ICodingCLI;
}

/**
 * Adapt the coding-cli operations to Plan 1's OperationRunner seam so the
 * `local` execution environment can run them in-process. The workspaceDir from
 * the provisioned env is injected as the operation's `cwd`.
 */
export function createCodingOperationRunner(deps: CodingOperationRunnerDeps): OperationRunner {
  return async (op, ctx) => {
    const provider = deps.makeProvider(op.env ?? {});
    const opts = {
      ...((op.stdin as Record<string, unknown> | undefined) ?? {}),
      cwd: ctx.workspaceDir,
    };
    const res = await dispatchOperation(provider, op.op, opts, {
      ...(op.onLog ? { onLog: op.onLog } : {}),
      ...(op.signal ? { signal: op.signal } : {}),
    });
    return { ok: res.ok, structured: res.structured ?? res.result, error: res.error };
  };
}
