import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DockerCommandRunner } from "./docker-command-runner.ts";
import { wrapDockerfile } from "./dockerfile-wrap.ts";

export interface BuildDockerfileImageDeps {
  content: string;
  docker: DockerCommandRunner;
  bundleRef: string;
  tagPrefix?: string;
}

/** Build (or reuse) an image from a user Dockerfile, auto-wrapped with the runner bundle. */
export async function buildDockerfileImage(deps: BuildDockerfileImageDeps): Promise<string> {
  const effective = wrapDockerfile(deps.content, deps.bundleRef);
  const hash = createHash("sha256").update(effective).digest("hex").slice(0, 16);
  const tag = `${deps.tagPrefix ?? "journeyman/jm-built"}:${hash}`;

  const exists = await deps.docker(["image", "inspect", tag]);
  if (exists.exitCode === 0) return tag;

  const dir = await mkdtemp(join(tmpdir(), "jm-build-"));
  try {
    const dockerfilePath = join(dir, "Dockerfile");
    await writeFile(dockerfilePath, effective, "utf8");
    // Empty build context (v1 Dockerfiles don't COPY local files; COPY --from uses an image).
    const r = await deps.docker(["build", "-t", tag, "-f", dockerfilePath, dir]);
    if (r.exitCode !== 0) throw new Error(`docker build failed: ${r.stderr.trim()}`);
    return tag;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
