import type { SessionOptions, SessionResult } from "./session.types.ts";

// ---------------------------------------------------------------------------
// Git CLI operation types (used by coding-cli providers)
// ---------------------------------------------------------------------------

export type RepoEntry = { url: string; branch: string };
export type CheckoutEntry = { repoDir: string; branch: string };

export type CloneReposOptions = {
  repos: string | string[] | RepoEntry | RepoEntry[];
  branch?: string;
  workspaceDir?: string;
  signal?: AbortSignal;
};

export type CloneResult = {
  folderName: string;
  repoDir: string;
  url: string;
  branch: string;
  /** GitHub/GitLab owner or org parsed from the clone URL (e.g. "regojoyson"). */
  owner?: string;
  /** Bare repository name parsed from the clone URL (e.g. "agentic-ai-revolution"). */
  repoName?: string;
  error?: string;
};

export type CloneReposResult = {
  repos: CloneResult[];
  error?: string;
};

export type ScanReposOptions = SessionOptions & {
  parentDir: string;
  signal?: AbortSignal;
  model?: string;
};

export type RepoInfo = {
  folderName: string;
  repoDir: string;
  url?: string;
  branch?: string;
  isGitRepo: boolean;
};

export type ScanReposResult = SessionResult & {
  repos: RepoInfo[];
  error?: string;
};

export type CheckoutRepoOptions = SessionOptions & {
  repos: string | string[] | CheckoutEntry | CheckoutEntry[];
  branch?: string;
  issue?: { id: string; title: string };
  signal?: AbortSignal;
  model?: string;
};

export type CheckoutResult = {
  folderName: string;
  repoDir: string;
  baseBranch: string;
  newBranch: string;
  success: boolean;
  error?: string;
};

export type CheckoutRepoResult = SessionResult & {
  repos: CheckoutResult[];
  newBranch: string;
  error?: string;
};

export type CleanupEntry = {
  repoDir: string;
};

export type CleanupReposOptions = SessionOptions & {
  repos: string | string[] | CleanupEntry | CleanupEntry[];
  signal?: AbortSignal;
  model?: string;
};

export type CleanupRepoResult = {
  folderName: string;
  repoDir: string;
  success: boolean;
  error?: string;
};

export type CleanupReposResult = SessionResult & {
  repos: CleanupRepoResult[];
  error?: string;
};

export type CreateWorkspaceOptions = SessionOptions & {
  issueRef: string;
  baseDir: string;
  signal?: AbortSignal;
  model?: string;
};

export type CreateWorkspaceResult = SessionResult & {
  folderName: string;
  repoDir: string;
  error?: string;
};

// ---------------------------------------------------------------------------
// Git platform API types (used by git-provider providers)
// ---------------------------------------------------------------------------

export type GetRepoOptions = SessionOptions & {
  owner: string;
  repo: string;
};

export type GetRepoResult = SessionResult & {
  name: string;
  fullName: string;
  url: string;
  defaultBranch: string;
  error?: string;
};

export type CreatePROptions = SessionOptions & {
  owner: string;
  repo: string;
  title: string;
  body?: string;
  sourceBranch: string;
  targetBranch: string;
};

export type CreatePRResult = SessionResult & {
  id: string;
  url: string;
  number: number;
  error?: string;
};

export type ListPROptions = SessionOptions & {
  owner: string;
  repo: string;
  head?: string;                                   // "owner:branch" (GitHub format)
  state?: "open" | "closed" | "all";
};

export type ListPRItem = {
  id: string;
  url: string;
  number: number;
  head: string;
  state: string;
};

export type ListPRResult = SessionResult & {
  prs: ListPRItem[];
  error?: string;
};

// ---------------------------------------------------------------------------
// Commit + push operation types (used by coding-cli providers)
// ---------------------------------------------------------------------------

export type CommitPushEntry = {
  repoDir: string;
  issue?: string;   // per-repo override of top-level issue
  message?: string;  // full commit message; if set, skips AI generation
};

export type CommitPushReposOptions = SessionOptions & {
  repos: string | string[] | CommitPushEntry | CommitPushEntry[];
  issue?: string;                            // default issue applied to all entries
  pattern?: string;                           // default: "{issue} : {summary}"
  prSummaryStyle?: "brief" | "detailed";      // default: "detailed"
  signal?: AbortSignal;
  model?: string;
};

export type CommitPushResult = {
  folderName: string;
  repoDir: string;
  branch: string;        // current branch (committed + pushed to)
  commitSha: string;     // new HEAD SHA
  commitMessage: string; // final message used for git commit
  title: string;         // PR/MR title — e.g. "EV-123: Fix header alignment"
  description: string;   // PR/MR body — summary of code changes (markdown)
  filesChanged: string[];
  pushed: boolean;
  remoteUrl?: string;    // origin URL — useful for owner/repo parsing
  error?: string;
};

export type CommitPushReposResult = SessionResult & {
  repos: CommitPushResult[];
  error?: string;
};

// ---------------------------------------------------------------------------
// PR review comment listing (used by reviewLoop rework flows)
// ---------------------------------------------------------------------------

export type ListPRCommentsOptions = SessionOptions & {
  prUrl: string;
  /** ISO8601 — if set, only comments created at or after this time are returned. */
  sinceIso?: string;
};

export type PRComment = {
  author: string;
  body: string;
  path?: string;
  line?: number;
  createdAt: string;   // ISO 8601
};

export type ListPRCommentsResult = SessionResult & {
  comments: PRComment[];
  error?: string;
};
