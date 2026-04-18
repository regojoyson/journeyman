// ---------------------------------------------------------------------------
// Git CLI operation types (used by coding-cli providers)
// ---------------------------------------------------------------------------

export type RepoEntry = { url: string; branch: string };
export type ResetEntry = { dirPath: string; branch: string };

export type CloneReposOptions = {
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

export type CloneReposResult = {
  repos: CloneResult[];
  error?: string;
};

export type ScanReposOptions = {
  parentDir: string;
};

export type RepoInfo = {
  folderName: string;
  dirPath: string;
  url?: string;
  branch?: string;
  isGitRepo: boolean;
};

export type ScanReposResult = {
  repos: RepoInfo[];
  error?: string;
};

export type ResetReposOptions = {
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

export type ResetReposResult = {
  repos: ResetResult[];
  error?: string;
};

// ---------------------------------------------------------------------------
// Git platform API types (used by git-provider providers)
// ---------------------------------------------------------------------------

export type GetRepoOptions = {
  owner: string;
  repo: string;
};

export type GetRepoResult = {
  name: string;
  fullName: string;
  url: string;
  defaultBranch: string;
  error?: string;
};

export type CreatePROptions = {
  owner: string;
  repo: string;
  title: string;
  body?: string;
  sourceBranch: string;
  targetBranch: string;
};

export type CreatePRResult = {
  id: string;
  url: string;
  number: number;
  error?: string;
};
