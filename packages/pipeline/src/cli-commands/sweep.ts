/**
 * @file sweep.ts
 * Deletes old workspace run directories that exceed the configured retention period.
 *
 * Reads `config.workspaces.retentionDays` (default 14) and removes any run directory
 * whose mtime is older than the cutoff. When `keepFailed` is true (default), runs
 * whose state file records `status: "failed"` are preserved for post-mortem inspection.
 *
 * Only the `runs/` subdirectory is swept — the `artifacts/` directory is left intact
 * so durable output blobs survive beyond the retention window.
 *
 * Intended to be run as a cron job or the `journeyman sweep` CLI command.
 */

import { readdirSync, statSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPipelineConfig } from "../index.ts";

export async function sweep(configPath: string): Promise<number> {
  const config = loadPipelineConfig(configPath);
  const retention = config.workspaces?.retentionDays ?? 14;
  const keepFailed = config.workspaces?.keepFailed ?? true;
  const cutoff = Date.now() - retention * 86400_000;

  for (const [productId, p] of Object.entries(config.products)) {
    const runsDir = join(p.workspace, "runs");
    if (!existsSync(runsDir)) continue;
    for (const sid of readdirSync(runsDir)) {
      const dir = join(runsDir, sid);
      const st = statSync(dir);
      if (st.mtimeMs >= cutoff) continue;

      if (keepFailed) {
        const stateFile = join(p.workspace, "state", `${sid}.json`);
        try {
          const s = JSON.parse(readFileSync(stateFile, "utf8"));
          if (s.status === "failed") continue;
        } catch { /* no state — go ahead and remove */ }
      }
      console.log(`removing ${dir}`);
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return 0;
}
