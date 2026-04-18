import type { SessionOptions, SessionResult } from "./session.types.ts";

// ---------------------------------------------------------------------------
// Git CLI operation types (used by coding-cli providers)
// ---------------------------------------------------------------------------

export type RepoEntry = { url: string; branch: string };
export type ResetEntry = { dirPath: string; branch: string };

export type CloneReposOptions = SessionOptions & {
  repos: string | string[] | RepoEntry | RepoEntry[];
  branch?: string;
  targetDir?: string;
};

export type CloneResult = {
  folderName: string;
  dirPath: string;
  url: string;
  branch: string;
  error?: string;
};

export type CloneReposResult = SessionResult & {
  repos: CloneResult[];
  error?: string;
};

export type ScanReposOptions = SessionOptions & {
  parentDir: string;
};

export type RepoInfo = {
  folderName: string;
  dirPath: string;
  url?: string;
  branch?: string;
  isGitRepo: boolean;
};

export type ScanReposResult = SessionResult & {
  repos: RepoInfo[];
  error?: string;
};

export type ResetReposOptions = SessionOptions & {
  repos: string | string[] | ResetEntry | ResetEntry[];
  branch?: string;
};

export type ResetResult = {
  folderName: string;
  dirPath: string;
  branch: string;
  success: boolean;
  error?: string;
};

export type ResetReposResult = SessionResult & {
  repos: ResetResult[];
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

// ---------------------------------------------------------------------------
// Commit + push operation types (used by coding-cli providers)
// ---------------------------------------------------------------------------

export type CommitPushEntry = {
  dirPath: string;
  ticket?: string;   // per-repo override of top-level ticket
  message?: string;  // full commit message; if set, skips AI generation
};

export type CommitPushReposOptions = SessionOptions & {
  repos: string | string[] | CommitPushEntry | CommitPushEntry[];
  ticket?: string;                            // default ticket applied to all entries
  pattern?: string;                           // default: "{ticket} : {summary}"
  prSummaryStyle?: "brief" | "detailed";      // default: "detailed"
};

export type CommitPushResult = {
  folderName: string;
  dirPath: string;
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
