import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CloneReposOptions, CloneReposResult, CloneResult, RepoEntry } from "@journeyman/core";

const execFileP = promisify(execFile);

function normalizeEntries(opts: CloneReposOptions): RepoEntry[] {
  const raw = Array.isArray(opts.repos) ? opts.repos : [opts.repos];
  const defaultBranch = opts.branch ?? "main";
  return raw.map((r) =>
    typeof r === "string" ? { url: r.trim(), branch: defaultBranch } : { ...r, url: (r.url ?? "").trim() },
  );
}

function repoFolder(url: string): string {
  return url.replace(/\.git$/, "").split("/").filter(Boolean).pop() ?? "repo";
}

/** https://oauth2:<token>@<host>/<group>/<repo>.git — from "group/repo", a full URL, or "host/group/repo". */
export function buildGitLabCloneUrl(repo: string, token: string, baseUrl: string): string {
  let host: string;
  let path: string;
  if (/^https?:\/\//.test(repo)) {
    const u = new URL(repo);
    host = u.host;
    path = u.pathname.replace(/^\/+/, "");
  } else {
    host = baseUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    path = repo.replace(/^\/+/, "");
  }
  path = path.replace(/\.git$/, "");
  return `https://oauth2:${encodeURIComponent(token)}@${host}/${path}.git`;
}

function scrubToken(s: string): string {
  return s.replace(/oauth2:[^@\s]+@/g, "oauth2:***@");
}

export async function cloneRepos(token: string, baseUrl: string, opts: CloneReposOptions): Promise<CloneReposResult> {
  const entries = normalizeEntries(opts);
  const workspaceDir = opts.workspaceDir ?? process.cwd();
  try {
    await mkdir(workspaceDir, { recursive: true });
  } catch (err) {
    return { repos: [], error: `failed to create workspaceDir: ${(err as Error).message}` };
  }
  const results: CloneResult[] = [];
  for (const entry of entries) {
    const folder = repoFolder(entry.url);
    const repoDir = join(workspaceDir, folder);
    try {
      const url = buildGitLabCloneUrl(entry.url, token, baseUrl);
      const args = ["clone", "--depth", "1", ...(entry.branch ? ["--branch", entry.branch] : []), url, repoDir];
      await execFileP("git", args, { signal: opts.signal });
      results.push({ folderName: folder, repoDir, url: entry.url, branch: entry.branch });
    } catch (err: any) {
      results.push({ folderName: folder, repoDir, url: entry.url, branch: entry.branch, error: scrubToken(String(err?.message ?? err)) });
    }
  }
  const firstError = results.find((x) => x.error)?.error;
  return { repos: results, ...(firstError ? { error: firstError } : {}) };
}
