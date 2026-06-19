export type SkillInstallStatus = 'pending' | 'installing' | 'ready' | 'error';
export type SkillCliType = 'claude' | 'opencode' | 'codex';

export interface SkillPackage {
  id: string;
  workspaceId: string;
  gitUrl: string;
  name: string;
  localPath?: string;
  commitSha?: string;
  installStatus: SkillInstallStatus;
  installError?: string;
  enabledSkills: string[];
  cliType: SkillCliType;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedSkillPackage {
  id: string;
  name: string;
  localPath: string;
  enabledSkills: string[];
  cliType: SkillCliType;
}

export interface SkillCatalogEntry {
  name: string;
  description: string;
  gitUrl: string;
  author: string;
}
