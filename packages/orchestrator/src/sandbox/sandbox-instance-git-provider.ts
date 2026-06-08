import { parseRepoList } from "@journeyman/core";
import type {
  CloneReposOptions, CloneReposResult, CloneResult, ExecOp, ExecResult, IGitProvider,
} from "@journeyman/core";

type ExecFn = (op: ExecOp) => Promise<ExecResult>;

function toUrls(repos: unknown): string[] {
  if (typeof repos === "string" || (Array.isArray(repos) && repos.every((r) => typeof r === "string"))) {
    return parseRepoList(repos as string | string[]);
  }
  if (Array.isArray(repos)) {
    return repos
      .map((r) => (typeof r === "string" ? r : (r as { url?: string })?.url))
      .filter((u): u is string => typeof u === "string")
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
  }
  return [];
}

function folderName(url: string): string {
  return url.replace(/\.git$/, "").split("/").filter(Boolean).pop() ?? "repo";
}

/**
 * An IGitProvider.cloneRepos that runs `git clone` INSIDE the run's sandbox (via
 * env.exec op "clone"). Only cloneRepos is sandbox-routed; other IGitProvider
 * methods (PRs, etc.) are remote REST and never reach this provider.
 */
export class SandboxGitProvider implements Pick<IGitProvider, "cloneRepos"> {
  constructor(private exec: ExecFn) {}

  async cloneRepos(opts: CloneReposOptions): Promise<CloneReposResult> {
    const urls = toUrls(opts.repos);
    const workspaceDir = opts.workspaceDir ?? "/workspace";
    const results: CloneResult[] = [];
    for (const url of urls) {
      const dir = folderName(url);
      const r = await this.exec({
        op: "clone",
        stdin: { repoUrl: url, dir, ...(opts.branch ? { branch: opts.branch } : {}) },
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.onLog ? { onLog: opts.onLog } : {}),
      });
      results.push({
        folderName: dir,
        repoDir: `${workspaceDir}/${dir}`,
        url,
        branch: opts.branch ?? "",
        ...(r.ok ? {} : { error: r.error }),
      });
    }
    const firstError = results.find((x) => x.error)?.error;
    return { repos: results, ...(firstError ? { error: firstError } : {}) };
  }
}
