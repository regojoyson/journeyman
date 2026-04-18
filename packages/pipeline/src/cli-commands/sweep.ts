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
