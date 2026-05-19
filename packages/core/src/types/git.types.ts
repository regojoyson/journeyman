import type { SessionOptions, SessionResult } from "./session.types.ts";
import type { AgentLogLevel, CodingCliLogFn } from "./coding.types.ts";

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
  /** Optional per-message log callback. Receives a one-line summary plus the raw SDK message in `meta.sdkMessage`. */
  onLog?: CodingCliLogFn;
  /** Verbosity for SDK log lines emitted via `onLog`. Defaults to "all" when `onLog` is provided. */
  agentLogLevel?: AgentLogLevel;
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
