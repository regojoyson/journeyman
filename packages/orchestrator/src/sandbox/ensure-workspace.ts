import type {
  IExecutionEnvironment, IExecutionEnvironmentRegistry, ProvisionedEnv, ResolvedSandbox, SandboxType,
} from "@journeyman/core";

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
    id: string;
    type: string;
    config: Record<string, unknown>;
    imageState?: string;
    imageFingerprint?: string | null;
    imageRef?: string | null;
    imageError?: string | null;
  }>;
  /** The per-process backend registry — selects/gates/provisions/tears down. */
  registry: IExecutionEnvironmentRegistry;
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

  // Run-gating is a backend concern (docker checks managed-image readiness).
  // Called AFTER the active/provisioning early-returns (so reconnect skips it),
  // and BEFORE claim/provision so a not-ready throw still triggers Conductor retry.
  const resolved: ResolvedSandbox = {
    id: worker.id,
    type: worker.type as SandboxType,
    executionMode: "shared",
    config: worker.config,
    ...(worker.imageState ? { imageState: worker.imageState as ResolvedSandbox["imageState"] } : {}),
    imageFingerprint: worker.imageFingerprint ?? null,
    imageRef: worker.imageRef ?? null,
    imageError: worker.imageError ?? null,
  };
  const backend = deps.registry.get(resolved.type);
  if (backend.checkRunnable) await backend.checkRunnable(resolved, log);

  const won = await deps.claim({ runId: args.runId, type: worker.type, owner: args.orgId });
  if (!won) {
    // Another worker claimed it between our getSandboxInstance() and claim() calls.
    log("Waiting for workspace…");
    const active = await deps.waitActive(args.runId, PROVISION_WAIT_MS);
    log("Workspace ready");
    return connect(deps, { runId: args.runId, type: worker.type, ...active });
  }

  // We are the builder. One path for every backend type.
  log(`Provisioning ${worker.type} workspace…`);
  try {
    const env = backend.create(resolved);
    const provisioned = await env.provision(args.runId, {});
    await deps.markActive(args.runId, {
      handle: provisioned.handle,
      volume: provisioned.volume ?? null,
      imageRef: provisioned.imageRef ?? null,
      connection: (worker.config as Record<string, unknown>)["connection"],
    });
    if (args.verbose && provisioned.imageRef) log(`Workspace image: ${provisioned.imageRef}`);
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
  // Rebuild the env from the recorded connection + handle (no new unit). For
  // docker the backend short-circuits on __existingHandle; for local the
  // idempotent mkdir makes reprovision safe.
  const env = deps.registry.get(sb.type as SandboxType).create({
    id: sb.runId,
    type: sb.type as SandboxType,
    executionMode: "shared",
    config: {
      connection: sb.connection,
      __existingHandle: sb.handle,
      __existingVolume: sb.volume,
    },
  });
  const provisioned = await env.provision(sb.runId, {});
  return { env, provisioned };
}
