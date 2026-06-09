import type { Sandbox } from "@journeyman/core";
import type { Queryable } from "../db.ts";
import { claimPendingBuild, commitBuildResult, failBuild } from "../db.ts";
import { buildBoxImage, type BuildBoxImageResult } from "../backends/docker/build-image.ts";
import { makeDockerClient } from "../backends/docker/docker-client.ts";
import { ensureKitImage } from "../backends/docker/ensure-kit.ts";
import type { RegistryAuth } from "../backends/docker/registry-auth.ts";

export interface BuildTickDeps {
  db: Queryable;
  bundleRef: string;
  /** Optional registry auth for pulling the kit bundle. */
  kitAuth?: RegistryAuth;
  leaseMs: number;
  owner: string;
  log?: (line: string) => void;
  // Seams (overridable in tests):
  claim?: (db: Queryable, owner: string, leaseMs: number) => Promise<Sandbox | null>;
  makeClient?: (conn: unknown) => ReturnType<typeof makeDockerClient>;
  ensureKit?: (client: any, ref: string, auth?: RegistryAuth, log?: (l: string) => void) => Promise<void>;
  build?: (args: { image: unknown; client: any; bundleRef: string }) => Promise<BuildBoxImageResult>;
  commit?: (db: Queryable, id: string, fp: string, ref: string) => Promise<void>;
  fail?: (db: Queryable, id: string, fp: string, err: string) => Promise<void>;
}

/** Claim + build + commit one target. Returns false if nothing was claimable. */
export async function runBuildTick(deps: BuildTickDeps): Promise<boolean> {
  const claim = deps.claim ?? claimPendingBuild;
  const makeClient: (conn: unknown) => ReturnType<typeof makeDockerClient> =
    deps.makeClient ?? ((conn) => makeDockerClient(conn as Parameters<typeof makeDockerClient>[0]));
  const ensureKit = deps.ensureKit ?? ensureKitImage;
  const build = deps.build ?? ((a) => buildBoxImage(a as Parameters<typeof buildBoxImage>[0]));
  const commit = deps.commit ?? commitBuildResult;
  const fail = deps.fail ?? failBuild;
  const log = deps.log ?? (() => {});

  const target = await claim(deps.db, deps.owner, deps.leaseMs);
  if (!target) return false;

  const cfg = (target.config ?? {}) as Record<string, unknown>;
  let fingerprint = target.imageFingerprint ?? "";
  try {
    log(`building image for sandbox ${target.name} (${target.id})`);
    const client = makeClient(cfg["connection"] ?? { kind: "local" });
    // The box recipe grafts the kit via `COPY --from=<bundleRef>`; ensure that
    // kit image exists on this daemon first (pulled from the registry by digest).
    await ensureKit(client, deps.bundleRef, deps.kitAuth, log);
    const result = await build({ image: cfg["image"], client, bundleRef: deps.bundleRef });
    fingerprint = result.fingerprint;
    await commit(deps.db, target.id, result.fingerprint, result.imageRef);
    log(`image ready for ${target.id}: ${result.imageRef}`);
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    await fail(deps.db, target.id, fingerprint, message);
    log(`image build failed for ${target.id}: ${message}`);
  }
  return true;
}

export interface StartBuildLoopDeps extends Omit<BuildTickDeps, "owner"> {
  /** Poll interval; default 3000ms. */
  intervalMs?: number;
  owner?: string;
}

/** Start a polling build loop. Returns a stop function. */
export function startBuildLoop(deps: StartBuildLoopDeps): () => void {
  const owner = deps.owner ?? `worker-${process.pid}`;
  const intervalMs = deps.intervalMs ?? 3000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      // Drain: keep building while work remains, then back off to the interval.
      let did = true;
      while (did && !stopped) did = await runBuildTick({ ...deps, owner });
    } catch (err) {
      (deps.log ?? (() => {}))(`build loop tick error: ${(err as Error).message}`);
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  };
  timer = setTimeout(tick, intervalMs);
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
