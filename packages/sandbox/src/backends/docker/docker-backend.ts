import type {
  Connectivity, ExecutionEnvironmentBackend, ExecutionMode,
  IExecutionEnvironment, ResolvedSandbox, SandboxType,
} from "@journeyman/core";
import type { IDockerClient } from "./docker-client.ts";
import { DockerExecutionEnvironment } from "./docker-execution-environment.ts";

/** Image still building/pending — retryable (Conductor backs off). */
export class ImageNotReadyError extends Error {
  constructor(msg: string) { super(msg); this.name = "ImageNotReadyError"; }
}
function configurationError(msg: string): Error {
  const e = new Error(msg) as Error & { name: string };
  e.name = "ConfigurationError";
  return e;
}

export interface DockerBackendDeps {
  /** Build a docker client from a sandbox connection (per-connection, per-process). */
  makeClient: (connection: unknown) => IDockerClient;
  /** Default/base runner image when no recipe image is resolved. */
  defaultImage: string;
  runnerCmd?: string[];
  /** Resolve the image ref to provision with (kit base or pre-built), ensuring it's present. */
  resolveImageRef?: (config: Record<string, unknown>, client: IDockerClient) => Promise<string>;
  /** Re-enqueue a build when a ready image went missing. Optional (gating only). */
  onImagePending?: (sandboxId: string) => Promise<void>;
  /** Re-verify a ready image is still the latest. Optional (gating only). */
  verifyImageFresh?: (args: {
    sandboxId: string; config: Record<string, unknown>;
    storedFingerprint: string; storedImageRef: string;
  }) => Promise<{ fresh: boolean; reason?: string }>;
}

export class DockerBackend implements ExecutionEnvironmentBackend {
  readonly type: SandboxType = "docker";
  readonly supportedModes: ExecutionMode[] = ["per-instance"];
  readonly supportedConnectivity: Connectivity[] = ["push"];

  constructor(private deps: DockerBackendDeps) {}

  validateConfig(config: unknown): void {
    if (config == null) return;
    if (typeof config !== "object") throw new Error("docker worker config must be an object");
    const c = config as Record<string, unknown>;
    if (c.image !== undefined) {
      const image = c.image as { kind?: string };
      if (image.kind !== "ref" && image.kind !== "dockerfile") {
        throw new Error("docker worker config.image.kind must be 'ref' or 'dockerfile'");
      }
    }
    if (c.network !== undefined && c.network !== "full" && c.network !== "none") {
      throw new Error("docker worker config.network must be 'full' or 'none'");
    }
  }

  async checkRunnable(worker: ResolvedSandbox): Promise<void> {
    const config = (worker.config ?? {}) as Record<string, unknown>;
    const img = config["image"] as { kind?: string; imageRef?: string; content?: string } | undefined;
    const hasRecipe =
      (img?.kind === "ref" && !!img.imageRef?.trim()) ||
      (img?.kind === "dockerfile" && !!img.content?.trim());
    if (!hasRecipe) return;

    const state = worker.imageState ?? "none";
    if (state === "failed") {
      throw configurationError(`sandbox image build failed: ${worker.imageError ?? "see build log"}`);
    }
    if (state === "pending" || state === "building" || state === "none") {
      throw new ImageNotReadyError("sandbox image is not ready yet");
    }
    if (state === "ready" && !worker.imageRef) {
      if (this.deps.onImagePending) await this.deps.onImagePending(worker.id);
      throw new ImageNotReadyError("sandbox image was pruned; rebuilding");
    }
    if (this.deps.verifyImageFresh) {
      const v = await this.deps.verifyImageFresh({
        sandboxId: worker.id,
        config,
        storedFingerprint: worker.imageFingerprint ?? "",
        storedImageRef: worker.imageRef ?? "",
      });
      if (!v.fresh) {
        if (this.deps.onImagePending) await this.deps.onImagePending(worker.id);
        throw new ImageNotReadyError(v.reason ?? "sandbox image is stale; rebuilding");
      }
    }
    // ready + fresh → stamp the resolved ref so provision uses it.
    config["__imageRef"] = worker.imageRef;
  }

  create(worker: ResolvedSandbox): IExecutionEnvironment {
    this.validateConfig(worker.config);
    const config = (worker.config ?? {}) as Record<string, unknown>;
    const client = this.deps.makeClient(config["connection"]);
    return new DockerExecutionEnvironment({
      client,
      defaultImage: this.deps.defaultImage,
      config,
      ...(this.deps.runnerCmd ? { runnerCmd: this.deps.runnerCmd } : {}),
      ...(this.deps.resolveImageRef ? { resolveImageRef: this.deps.resolveImageRef } : {}),
    });
  }
}
