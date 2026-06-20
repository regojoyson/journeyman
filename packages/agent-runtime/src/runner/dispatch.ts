import { spawn } from "node:child_process";
import type { CodingCliLogFn, ICodingCLI } from "@journeyman/core";
import type { RunnerResponse } from "./runner-types.ts";

function gitClone(
  url: string,
  dir: string,
  branch?: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const args = ["clone", ...(branch ? ["--branch", branch] : []), url, dir];
    const child = spawn("git", args, { cwd: "/workspace" });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    child.on("error", (e) => resolve({ ok: false, error: e.message }));
    child.on("close", (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: stderr.trim() }));
    signal?.addEventListener("abort", () => {
      child.kill();
      resolve({ ok: false, error: "clone aborted" });
    }, { once: true });
  });
}

/**
 * Map an operation name to the matching ICodingCLI method and normalize the
 * outcome into a JSON-serializable RunnerResponse. Used both in-process
 * (operation-runner) and via the CLI (run-cli).
 */
export async function dispatchOperation(
  provider: ICodingCLI,
  op: string,
  opts: Record<string, unknown>,
  hooks: { onLog?: CodingCliLogFn; signal?: AbortSignal } = {},
): Promise<RunnerResponse> {
  // `opts` is JSON (no functions); merge runtime-only hooks here.
  const base = {
    ...opts,
    ...(hooks.signal ? { signal: hooks.signal } : {}),
  } as Record<string, unknown>;

  switch (op) {
    case "custom-prompt": {
      const r = await provider.runCustomPrompt({
        ...base,
        ...(hooks.onLog ? { onLog: hooks.onLog } : {}),
      } as Parameters<ICodingCLI["runCustomPrompt"]>[0]);
      if (r.error) return { ok: false, error: r.error };
      return { ok: true, structured: r.structured, result: r.result };
    }
    case "scan-repos": {
      const r = await provider.scanRepos(base as Parameters<ICodingCLI["scanRepos"]>[0]);
      return r.error ? { ok: false, error: r.error } : { ok: true, structured: r };
    }
    case "checkout-repo": {
      const r = await provider.checkoutRepo(base as Parameters<ICodingCLI["checkoutRepo"]>[0]);
      return r.error ? { ok: false, error: r.error } : { ok: true, structured: r };
    }
    case "clone": {
      const url = String((opts as { repoUrl?: string; url?: string }).repoUrl ?? (opts as { url?: string }).url ?? "");
      const dir = String((opts as { dir?: string }).dir ?? "repo");
      const branch = (opts as { branch?: string }).branch;
      if (!url) return { ok: false, error: "clone requires repoUrl" };
      const r = await gitClone(url, dir, branch, hooks.signal);
      return r.ok ? { ok: true, structured: { dir } } : { ok: false, error: r.error };
    }
    default:
      return { ok: false, error: `unknown op '${op}'` };
  }
}
