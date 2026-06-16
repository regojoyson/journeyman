import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

const DEFAULT_WINDOWS_CANDIDATES = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
];

/** Locate a usable bash. On Windows that's Git Bash; on POSIX, `bash` on PATH. */
export function findGitBash(opts: { candidates?: string[] } = {}): string | null {
  const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const candidates = opts.candidates ?? [
    ...DEFAULT_WINDOWS_CANDIDATES,
    ...pathDirs.map((d) => join(d, "bash")),
    ...pathDirs.map((d) => join(d, "bash.exe")),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}
