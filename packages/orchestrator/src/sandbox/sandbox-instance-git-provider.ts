import { toRepoEntries } from "@journeyman/core";
import type {
  CloneReposOptions, CloneReposResult, CloneResult, ExecOp, ExecResult, IGitProvider,
} from "@journeyman/core";

type ExecFn = (op: ExecOp) => Promise<ExecResult>;

function folderName(url: string): string {
  return url.replace(/\.git$/, "").split("/").filter(Boolean).pop() ?? "repo";
}

/** Connection auth used to build a token-embedded clone URL that authenticates in-container. */
export interface SandboxGitAuth {
  provider: string; // "github" | "gitlab"
  token: string;
  baseUrl?: string;
}

/**
 * Rewrite a repo identifier ("owner/repo", a full https URL, or "host/group/repo")
 * into a token-embedded https clone URL so `git clone` authenticates inside the sandbox.
 */
export function buildAuthCloneUrl(repo: string, auth: SandboxGitAuth): string {
  const isGitlab = auth.provider === "gitlab";
  const defaultHost = isGitlab ? (auth.baseUrl ?? "https://gitlab.com") : "https://github.com";
  let host: string;
  let path: string;
  if (/^https?:\/\//.test(repo)) {
    const u = new URL(repo);
    host = u.host;
    path = u.pathname.replace(/^\/+/, "");
  } else {
    host = defaultHost.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    path = repo.replace(/^\/+/, "");
  }
  path = path.replace(/\.git$/, "");
  const userinfo = isGitlab ? `oauth2:${encodeURIComponent(auth.token)}` : `x-access-token:${auth.token}`;
  return `https://${userinfo}@${host}/${path}.git`;
}

/**
 * An IGitProvider.cloneRepos that runs `git clone` INSIDE the run's sandbox (via
 * env.exec op "clone"). Only cloneRepos is sandbox-routed; other IGitProvider
 * methods (PRs, etc.) are remote REST and never reach this provider.
 *
 * When `auth` is supplied (from a git Connection), each repo is cloned via a
 * token-embedded URL so private clones authenticate in-container. The cleartext
 * url (no token) is what's reported back in the result.
 */
export class SandboxInstanceGitProvider implements Pick<IGitProvider, "cloneRepos"> {
  constructor(private exec: ExecFn, private auth?: SandboxGitAuth) {}

  async cloneRepos(opts: CloneReposOptions): Promise<CloneReposResult> {
    const entries = toRepoEntries(opts.repos, opts.branch);
    const workspaceDir = opts.workspaceDir ?? "/workspace";
    const results: CloneResult[] = [];
    for (const entry of entries) {
      const dir = folderName(entry.url);
      const cloneUrl = this.auth ? buildAuthCloneUrl(entry.url, this.auth) : entry.url;
      const r = await this.exec({
        op: "clone",
        stdin: { repoUrl: cloneUrl, dir, ...(entry.branch ? { branch: entry.branch } : {}) },
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.onLog ? { onLog: opts.onLog } : {}),
      });
      results.push({
        folderName: dir,
        repoDir: `${workspaceDir}/${dir}`,
        url: entry.url,
        branch: entry.branch ?? "",
        ...(r.ok ? {} : { error: r.error }),
      });
    }
    const firstError = results.find((x) => x.error)?.error;
    return { repos: results, ...(firstError ? { error: firstError } : {}) };
  }
}
