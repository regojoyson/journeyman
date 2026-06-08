import type { IExecutionEnvironment, ProvisionedEnv } from "@journeyman/core";

/** Image is still building/pending: a RETRYABLE provisioning error (Conductor backs off). */
class ImageNotReadyError extends Error {
  constructor(msg: string) { super(msg); this.name = "ImageNotReadyError"; }
}
/** A TERMINAL configuration error (worker-harness maps name==='ConfigurationError' to fail-fast). */
function configurationError(msg: string): Error {
  const e = new Error(msg) as Error & { name: string };
  e.name = "ConfigurationError";
  return e;
}

export interface EnsureWorkspaceDeps {
  getSandboxInstance(runId: string): Promise<{
    runId: string;
    type: string;
    status: string;
    handle: string;
    volume?: string | null;
    connection?: unknown;
  } | null>;
  claim(row: { runId: string; type: string; owner: string }): Promise<boolean>;
  markActive(
    runId: string,
    patch: {
      handle: string;
      volume?: string | null;
      imageRef?: string | null;
      connection?: unknown;
    },
  ): Promise<void>;
  waitActive(
    runId: string,
    timeoutMs: number,
  ): Promise<{ handle: string; volume?: string | null; connection?: unknown }>;
  resolveSandbox(
    sandboxId: string | undefined,
    ctx: { userId: string; orgId: string },
  ): Promise<{
    type: string;
    config: Record<string, unknown>;
    imageState?: string;
    imageFingerprint?: string | null;
    imageRef?: string | null;
    imageError?: string | null;
  }>;
  /** Re-enqueue a build when a ready image went missing (pruned). Optional. */
  onImagePending?(sandboxId: string): Promise<void>;
  /** Re-verify a ready image is still the latest; on drift the gate re-enqueues a build. Optional. */
  verifyImageFresh?(args: {
    sandboxId: string;
    config: Record<string, unknown>;
    storedFingerprint: string;
    storedImageRef: string;
  }): Promise<{ fresh: boolean; reason?: string }>;
  provisionDocker(
    runId: string,
    worker: { type: string; config: Record<string, unknown> },
  ): Promise<{
    env: IExecutionEnvironment;
    provisioned: ProvisionedEnv;
    imageRef?: string;
    connection?: unknown;
  }>;
  provisionLocal(runId: string): Promise<{ env: IExecutionEnvironment; provisioned: ProvisionedEnv }>;
}

export interface EnsureWorkspaceResult {
  env: IExecutionEnvironment;
  provisioned: ProvisionedEnv;
}

const PROVISION_WAIT_MS = Number(process.env["PROVISION_WAIT_MS"] ?? 300_000);

export async function ensureWorkspace(
  deps: EnsureWorkspaceDeps,
  args: {
    runId: string;
    sandboxId: string | undefined;
    userId: string | null;
    orgId: string | null;
    /** Optional progress sink (e.g. step.log). Additive — absent ⇒ no-op. */
    log?: (line: string) => void;
    /** Emit verbose detail lines (gated by the caller's agentLogLevel). */
    verbose?: boolean;
  },
): Promise<EnsureWorkspaceResult> {
  const log = args.log ?? (() => {});

  const existing = await deps.getSandboxInstance(args.runId);
  if (existing && existing.status === "active") {
    log("Using existing workspace");
    return connect(deps, existing);
  }

  // For provisioning state: someone else is already provisioning, skip to wait
  if (existing && existing.status === "provisioning") {
    log("Waiting for workspace…");
    const active = await deps.waitActive(args.runId, PROVISION_WAIT_MS);
    log("Workspace ready");
    return connect(deps, { runId: args.runId, type: existing.type, ...active });
  }

  if (!args.userId || !args.orgId) {
    const err = new Error("cannot resolve worker: run is missing user/org context") as Error & {
      name: string;
    };
    err.name = "ConfigurationError";
    throw err;
  }

  const worker = await deps.resolveSandbox(args.sandboxId, {
    userId: args.userId,
    orgId: args.orgId,
  });
  if (args.verbose) log(`Resolved worker: ${worker.type}`);

  // Run-gating: a docker target with a managed image must be 'ready' before we
  // provision. We never build inside the run (Spec B).
  if (worker.type === "docker") {
    const img = (worker.config as Record<string, unknown>)["image"] as
      { kind?: string; imageRef?: string; content?: string } | undefined;
    const hasRecipe =
      (img?.kind === "ref" && !!img.imageRef?.trim()) ||
      (img?.kind === "dockerfile" && !!img.content?.trim());
    if (hasRecipe) {
      const state = worker.imageState ?? "none";
      if (state === "failed") {
        throw configurationError(
          `sandbox image build failed: ${worker.imageError ?? "see build log"}`,
        );
      }
      if (state === "pending" || state === "building" || state === "none") {
        log("Preparing environment (building image)… this happens once.");
        throw new ImageNotReadyError("sandbox image is not ready yet");
      }
      if (state === "ready" && !worker.imageRef) {
        log("Environment image missing; rebuilding…");
        if (args.sandboxId && deps.onImagePending) await deps.onImagePending(args.sandboxId);
        throw new ImageNotReadyError("sandbox image was pruned; rebuilding");
      }
      // ready + imageRef: re-verify it's still the latest before using it.
      if (args.sandboxId && deps.verifyImageFresh) {
        const v = await deps.verifyImageFresh({
          sandboxId: args.sandboxId,
          config: worker.config,
          storedFingerprint: worker.imageFingerprint ?? "",
          storedImageRef: worker.imageRef ?? "",
        });
        if (!v.fresh) {
          log("Environment changed; rebuilding…");
          if (deps.onImagePending) await deps.onImagePending(args.sandboxId);
          throw new ImageNotReadyError(v.reason ?? "sandbox image is stale; rebuilding");
        }
      }
      // ready + fresh → fall through, passing imageRef to provisionDocker.
      (worker.config as Record<string, unknown>)["__imageRef"] = worker.imageRef;
    }
  }

  const won = await deps.claim({ runId: args.runId, type: worker.type, owner: args.orgId });
  if (!won) {
    // Another worker claimed it between our getSandboxInstance() and claim() calls.
    log("Waiting for workspace…");
    const active = await deps.waitActive(args.runId, PROVISION_WAIT_MS);
    log("Workspace ready");
    return connect(deps, { runId: args.runId, type: worker.type, ...active });
  }

  // We are the builder.
  if (worker.type === "local") {
    log("Provisioning local workspace…");
    try {
      const { env, provisioned } = await deps.provisionLocal(args.runId);
      await deps.markActive(args.runId, { handle: provisioned.handle });
      log("Workspace ready");
      return { env, provisioned };
    } catch (err) {
      log(`Workspace provisioning failed: ${(err as Error).message}`);
      throw err;
    }
  }

  log("Provisioning docker workspace…");
  try {
    const { env, provisioned, imageRef, connection } = await deps.provisionDocker(
      args.runId,
      worker,
    );
    if (args.verbose && imageRef) log(`Workspace image: ${imageRef}`);
    await deps.markActive(args.runId, {
      handle: provisioned.handle,
      volume: provisioned.volume ?? null,
      imageRef: imageRef ?? null,
      connection,
    });
    log("Workspace ready");
    return { env, provisioned };
  } catch (err) {
    log(`Workspace provisioning failed: ${(err as Error).message}`);
    throw err;
  }
}

async function connect(
  deps: EnsureWorkspaceDeps,
  sb: {
    runId: string;
    type: string;
    handle: string;
    volume?: string | null;
    connection?: unknown;
  },
): Promise<EnsureWorkspaceResult> {
  if (sb.type === "local") {
    // idempotent mkdir — reprovision is safe for local
    const { env, provisioned } = await deps.provisionLocal(sb.runId);
    return { env, provisioned };
  }
  // docker: rebuild env from the recorded connection + handle (no new container)
  const { env, provisioned } = await deps.provisionDocker(sb.runId, {
    type: "docker",
    config: {
      connection: sb.connection,
      __existingHandle: sb.handle,
      __existingVolume: sb.volume,
    },
  });
  return { env, provisioned };
}

export { ImageNotReadyError };
