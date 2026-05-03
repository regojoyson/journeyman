import { execSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";

export const SKILLS_CACHE_DIR =
  process.env.SKILLS_CACHE_DIR ?? join(homedir(), ".journeyman", "skills");

function packageCacheDir(name: string, gitUrl: string): string {
  const hash = createHash("sha256").update(gitUrl).digest("hex").slice(0, 8);
  return join(SKILLS_CACHE_DIR, `${name}-${hash}`);
}

export interface InstallResult {
  localPath: string;
  commitSha: string;
  discoveredSkills: string[];
}

export function clonePackage(name: string, gitUrl: string): InstallResult {
  const localPath = packageCacheDir(name, gitUrl);
  if (existsSync(localPath)) rmSync(localPath, { recursive: true, force: true });
  execSync(`git clone --depth 1 ${JSON.stringify(gitUrl)} ${JSON.stringify(localPath)}`, {
    stdio: "pipe",
  });
  const commitSha = execSync("git rev-parse HEAD", { cwd: localPath, stdio: "pipe" })
    .toString()
    .trim();
  const discoveredSkills = discoverSkills(localPath);
  return { localPath, commitSha, discoveredSkills };
}

export function refreshPackage(localPath: string, gitUrl: string): InstallResult {
  if (!existsSync(localPath)) {
    const name = localPath.split("/").pop() ?? "pkg";
    return clonePackage(name, gitUrl);
  }
  execSync("git fetch --depth 1 origin && git reset --hard FETCH_HEAD", {
    cwd: localPath,
    stdio: "pipe",
  });
  const commitSha = execSync("git rev-parse HEAD", { cwd: localPath, stdio: "pipe" })
    .toString()
    .trim();
  const discoveredSkills = discoverSkills(localPath);
  return { localPath, commitSha, discoveredSkills };
}

export function discoverSkills(localPath: string): string[] {
  // Skills can be subdirectories of `skills/` (superpowers style)
  // or .md files inside `.claude-plugin/skills/` (alternative layout).
  // Check both; return whichever is populated.
  const rootSkillsDir = join(localPath, "skills");
  const pluginSkillsDir = join(localPath, ".claude-plugin", "skills");

  for (const dir of [rootSkillsDir, pluginSkillsDir]) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      // Directories → each dir name is a skill (superpowers layout)
      const fromDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      // .md files → strip extension (flat layout)
      const fromFiles = entries
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => e.name.replace(/\.md$/, ""));
      const found = fromDirs.length > 0 ? fromDirs : fromFiles;
      if (found.length > 0) return found;
    } catch {
      // ignore unreadable dir, try next
    }
  }
  return [];
}

export async function runInstall(
  pool: import("pg").Pool,
  id: string,
  name: string,
  gitUrl: string,
  existingLocalPath: string | undefined,
): Promise<void> {
  const { updateSkillPackageStatus } = await import("./db.ts");
  await updateSkillPackageStatus(pool, id, { installStatus: "installing" });
  try {
    const result =
      existingLocalPath && existsSync(existingLocalPath)
        ? refreshPackage(existingLocalPath, gitUrl)
        : clonePackage(name, gitUrl);
    await updateSkillPackageStatus(pool, id, {
      installStatus: "ready",
      localPath: result.localPath,
      commitSha: result.commitSha,
    });
  } catch (err) {
    await updateSkillPackageStatus(pool, id, {
      installStatus: "error",
      installError: String(err),
    });
  }
}

export function ensureCloned(
  name: string,
  gitUrl: string,
  cachedLocalPath: string | undefined,
): string {
  if (cachedLocalPath && existsSync(cachedLocalPath)) return cachedLocalPath;
  const { localPath } = clonePackage(name, gitUrl);
  return localPath;
}
