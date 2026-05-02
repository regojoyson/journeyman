import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import type {
  CloneReposOptions,
  CloneReposResult,
  CloneResult,
  RepoEntry,
} from "@journeyman/core";
import { buildCloneUrl } from "./build-clone-url.ts";

const execFileP = promisify(execFile);

function normalizeEntries(opts: CloneReposOptions): RepoEntry[] {
  const raw = Array.isArray(opts.repos) ? opts.repos : [opts.repos];
  const defaultBranch = opts.branch ?? "main";
  return raw.map((r) =>
    typeof r === "string" ? { url: r, branch: defaultBranch } : r,
  );
}

function repoFolder(url: string): string {
  return url.split("/").pop()?.replace(/\.git$/, "") ?? "repo";
}

function scrubToken(s: string): string {
  return s.replace(/x-access-token:[^@\s]+@/g, "x-access-token:***@");
}

export async function cloneRepos(
  token: string,
  opts: CloneReposOptions,
): Promise<CloneReposResult> {
  const entries = normalizeEntries(opts);
  const workspaceDir = opts.workspaceDir ?? process.cwd();
  try {
    await mkdir(workspaceDir, { recursive: true });
  } catch (err) {
    return { repos: [], error: `failed to create workspaceDir: ${(err as Error).message}` };
  }

  const results: CloneResult[] = [];
  for (const entry of entries) {
    const folderName = repoFolder(entry.url);
    const repoDir = `${workspaceDir}/${folderName}`;
    if (opts.signal?.aborted) {
      results.push({ folderName, repoDir, url: entry.url, branch: entry.branch, error: "aborted" });
      continue;
    }
    let cloneUrl: string;
    try {
      cloneUrl = buildCloneUrl(entry.url, token);
    } catch (err) {
      results.push({ folderName, repoDir, url: entry.url, branch: entry.branch, error: (err as Error).message });
      continue;
    }
    try {
      await execFileP(
        "git",
        ["clone", "--branch", entry.branch, "--single-branch", cloneUrl, repoDir],
        { signal: opts.signal },
      );
      results.push({ folderName, repoDir, url: entry.url, branch: entry.branch });
    } catch (err) {
      const e = err as { stderr?: string; message: string };
      results.push({
        folderName, repoDir, url: entry.url, branch: entry.branch,
        error: scrubToken(e.stderr?.trim() || e.message),
      });
    }
  }

  return { repos: results };
}
