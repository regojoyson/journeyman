import type { Pool } from "pg";
import type { OverviewStats, AnalyticsWindow } from "@journeyman/core";
import { windowSince } from "../window.ts";
import { runVolume, outcomeSplit, durationStat, byTrigger, topFailures } from "./runs.ts";
import { tokenStat } from "./tokens.ts";
import { agentStats } from "./agents.ts";

export async function getOverviewStats(
  pool: Pool,
  wsId: string,
  window: AnalyticsWindow,
): Promise<OverviewStats> {
  const since = windowSince(window, new Date());
  const [runVol, outcome, duration, triggers, tokens, failures, agents] = await Promise.all([
    runVolume(pool, wsId, since),
    outcomeSplit(pool, wsId, since),
    durationStat(pool, wsId, since),
    byTrigger(pool, wsId, since),
    tokenStat(pool, wsId, since),
    topFailures(pool, wsId, since),
    agentStats(pool, wsId, since),
  ]);
  return {
    window,
    runVolume: runVol,
    outcomeSplit: outcome,
    duration,
    byTrigger: triggers,
    tokens,
    topFailures: failures,
    agents,
  };
}
