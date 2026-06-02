import Docker from "dockerode";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";

/** How to reach a Docker daemon. Persisted on the sandbox row so any process can rebuild the client. */
export interface DockerConnection {
  kind: "local" | "remote";
  /** Local only: override the daemon socket (blank ⇒ DOCKER_HOST, then the dockerode default). */
  socketPath?: string;
  /** e.g. "tcp://build-host:2376" or "build-host:2376" (remote only). */
  host?: string;
  /** Optional TLS cert dir containing ca.pem/cert.pem/key.pem (remote only). */
  certDir?: string;
}

/** Minimal Docker operations the execution environment needs. Faked in unit tests. */
export interface IDockerClient {
  /** Round-trip the daemon; throws if unreachable. */
  ping(): Promise<void>;
  createVolume(name: string): Promise<void>;
  removeVolume(name: string): Promise<void>;
  runIdle(o: {
    image: string; volume: string; mountPath: string; labels: Record<string, string>;
    env?: Record<string, string>; cpus?: number; memoryMb?: number; network?: "none" | "full";
  }): Promise<string>;
  exec(containerId: string, o: {
    cmd: string[]; env?: Record<string, string>; stdin?: string;
    onStderr?: (line: string) => void; signal?: AbortSignal;
  }): Promise<{ stdout: string; exitCode: number }>;
  removeContainer(id: string): Promise<void>;
  listByLabel(labelKey: string, labelValue?: string): Promise<Array<{ id: string; runId: string }>>;
  imageExists(tag: string): Promise<boolean>;
  buildImage(o: { contextDir: string; dockerfileName: string; tag: string }): Promise<void>;
  putArchive(containerId: string, tar: import("node:stream").Readable | Buffer, opts: { path: string }): Promise<void>;
}

/** Parse a Docker host string into { host, port }. Scheme (tcp://, https://) is stripped. */
export function parseDockerHost(host: string): { host: string; port: number } {
  const stripped = host.replace(/^[a-z]+:\/\//i, "");
  const [h, p] = stripped.split(":");
  return { host: h, port: p ? Number(p) : 2375 };
}

/**
 * Normalize a configured Unix socket path. dockerode's `socketPath` wants a bare
 * filesystem path, but users naturally paste the `unix://…` form shown by
 * `docker context ls` / DOCKER_HOST. Strip the scheme so either form works.
 */
export function normalizeSocketPath(socketPath: string): string {
  return socketPath.replace(/^unix:\/\//i, "");
}

function toEnvList(env?: Record<string, string>): string[] | undefined {
  return env ? Object.entries(env).map(([k, v]) => `${k}=${v}`) : undefined;
}

class DockerodeClient implements IDockerClient {
  constructor(private docker: Docker) {}

  async ping(): Promise<void> {
    await this.docker.ping();
  }

  async createVolume(name: string): Promise<void> {
    await this.docker.createVolume({ Name: name });
  }

  async removeVolume(name: string): Promise<void> {
    await this.docker.getVolume(name).remove();
  }

  async runIdle(o: Parameters<IDockerClient["runIdle"]>[0]): Promise<string> {
    const c = await this.docker.createContainer({
      Image: o.image,
      Entrypoint: ["sleep"],
      Cmd: ["infinity"],
      Labels: o.labels,
      ...(toEnvList(o.env) ? { Env: toEnvList(o.env) } : {}),
      HostConfig: {
        Binds: [`${o.volume}:${o.mountPath}`],
        ...(o.cpus ? { NanoCpus: Math.round(o.cpus * 1e9) } : {}),
        ...(o.memoryMb ? { Memory: o.memoryMb * 1024 * 1024 } : {}),
        ...(o.network === "none" ? { NetworkMode: "none" } : {}),
      },
    });
    await c.start();
    return c.id;
  }

  async exec(containerId: string, o: Parameters<IDockerClient["exec"]>[1]): Promise<{ stdout: string; exitCode: number }> {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: o.cmd,
      ...(toEnvList(o.env) ? { Env: toEnvList(o.env) } : {}),
      AttachStdin: o.stdin !== undefined,
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({ hijack: true, stdin: true });

    let stdout = "";
    let stderrBuf = "";
    const stdoutW = new Writable({ write(chunk, _enc, cb) { stdout += chunk.toString("utf8"); cb(); } });
    const stderrW = new Writable({
      write(chunk, _enc, cb) {
        const text = chunk.toString("utf8");
        if (o.onStderr) {
          stderrBuf += text;
          const parts = stderrBuf.split("\n");
          stderrBuf = parts.pop() ?? "";
          for (const line of parts) o.onStderr(line);
        }
        cb();
      },
    });
    this.docker.modem.demuxStream(stream, stdoutW, stderrW);

    if (o.stdin !== undefined) stream.write(o.stdin);
    stream.end();

    await new Promise<void>((resolve, reject) => {
      stream.on("end", () => resolve());
      stream.on("error", reject);
      o.signal?.addEventListener("abort", () => { stream.destroy(); resolve(); }, { once: true });
    });
    if (o.onStderr && stderrBuf.length) o.onStderr(stderrBuf);

    const info = await exec.inspect();
    return { stdout, exitCode: info.ExitCode ?? -1 };
  }

  async removeContainer(id: string): Promise<void> {
    await this.docker.getContainer(id).remove({ force: true });
  }

  async listByLabel(labelKey: string, labelValue?: string): Promise<Array<{ id: string; runId: string }>> {
    const list = await this.docker.listContainers({
      all: true,
      filters: { label: [labelValue ? `${labelKey}=${labelValue}` : labelKey] },
    });
    return list.map((c) => ({ id: c.Id, runId: c.Labels?.[labelKey] ?? "" }));
  }

  async imageExists(tag: string): Promise<boolean> {
    try {
      await this.docker.getImage(tag).inspect();
      return true;
    } catch {
      return false;
    }
  }

  async buildImage(o: { contextDir: string; dockerfileName: string; tag: string }): Promise<void> {
    const stream = await this.docker.buildImage(
      { context: o.contextDir, src: [o.dockerfileName] },
      { t: o.tag, dockerfile: o.dockerfileName },
    );
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err: Error | null) => (err ? reject(err) : resolve()));
    });
  }

  async putArchive(
    containerId: string,
    tar: import("node:stream").Readable | Buffer,
    opts: { path: string },
  ): Promise<void> {
    const c = this.docker.getContainer(containerId);
    await c.putArchive(tar, { path: opts.path });
  }
}

/** Build an IDockerClient for the given connection (default: local socket, honoring DOCKER_HOST). */
export function makeDockerClient(connection?: DockerConnection): IDockerClient {
  if (!connection || connection.kind === "local" || !connection.host) {
    // Precedence: explicit socketPath → DOCKER_HOST → dockerode default.
    if (connection?.socketPath) return new DockerodeClient(new Docker({ socketPath: normalizeSocketPath(connection.socketPath) }));
    // Honor DOCKER_HOST (Rancher Desktop / colima / rootless use non-default sockets).
    const dh = process.env.DOCKER_HOST;
    if (dh?.startsWith("unix://")) return new DockerodeClient(new Docker({ socketPath: dh.slice("unix://".length) }));
    if (dh) { const { host, port } = parseDockerHost(dh); return new DockerodeClient(new Docker({ host, port })); }
    return new DockerodeClient(new Docker());
  }
  const { host, port } = parseDockerHost(connection.host);
  const opts: Docker.DockerOptions = { host, port };
  if (connection.certDir) {
    opts.ca = readFileSync(join(connection.certDir, "ca.pem"));
    opts.cert = readFileSync(join(connection.certDir, "cert.pem"));
    opts.key = readFileSync(join(connection.certDir, "key.pem"));
  }
  return new DockerodeClient(new Docker(opts));
}
