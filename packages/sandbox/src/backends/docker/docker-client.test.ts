import { describe, it, expect, vi, afterEach } from "vitest";
import { parseDockerHost, DockerodeClient, makeDockerClient } from "./docker-client.ts";

describe("DockerodeClient.pullImage", () => {
  it("pulls the ref and waits for completion via followProgress", async () => {
    const followProgress = vi.fn((_stream: unknown, cb: (e: Error | null, o?: unknown[]) => void) => cb(null, []));
    const pull = vi.fn().mockResolvedValue("stream");
    const client = new DockerodeClient({ pull, modem: { followProgress } } as any);
    await client.pullImage("node:20");
    expect(pull).toHaveBeenCalledWith("node:20", {});
    expect(followProgress).toHaveBeenCalled();
  });

  it("rejects when the pull stream reports an error event", async () => {
    const followProgress = vi.fn((_stream: unknown, cb: (e: Error | null, o?: unknown[]) => void) => cb(null, [{ error: "denied" }]));
    const client = new DockerodeClient({ pull: vi.fn().mockResolvedValue("s"), modem: { followProgress } } as any);
    await expect(client.pullImage("private/x:1")).rejects.toThrow(/denied/);
  });
});

describe("DockerodeClient.buildImage pull flag", () => {
  it("forwards pull:true into the dockerode build options", async () => {
    const buildImage = vi.fn().mockResolvedValue("stream");
    const followProgress = vi.fn((_stream: unknown, cb: (e: Error | null, o?: unknown[]) => void) => cb(null, []));
    const client = new DockerodeClient({ buildImage, modem: { followProgress } } as any);
    await client.buildImage({ contextDir: "/c", dockerfileName: "Dockerfile", tag: "t:1", pull: true });
    expect(buildImage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pull: true }),
    );
  });

  it("omits pull when not requested", async () => {
    const buildImage = vi.fn().mockResolvedValue("stream");
    const followProgress = vi.fn((_stream: unknown, cb: (e: Error | null, o?: unknown[]) => void) => cb(null, []));
    const client = new DockerodeClient({ buildImage, modem: { followProgress } } as any);
    await client.buildImage({ contextDir: "/c", dockerfileName: "Dockerfile", tag: "t:1" });
    const opts = buildImage.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(opts.pull).toBeUndefined();
  });
});

describe("DockerodeClient.listImageTags / removeImage", () => {
  it("lists repo tags and skips dangling <none>:<none>", async () => {
    const listImages = vi.fn().mockResolvedValue([
      { RepoTags: ["a:1", "b:2"] },
      { RepoTags: ["<none>:<none>"] },
      { RepoTags: null },
    ]);
    const client = new DockerodeClient({ listImages } as any);
    expect(await client.listImageTags()).toEqual(["a:1", "b:2"]);
  });

  it("removes an image by tag", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const getImage = vi.fn().mockReturnValue({ remove });
    const client = new DockerodeClient({ getImage } as any);
    await client.removeImage("journeyman/jm-built:fp");
    expect(getImage).toHaveBeenCalledWith("journeyman/jm-built:fp");
    expect(remove).toHaveBeenCalled();
  });
});

describe("parseDockerHost", () => {
  it("parses tcp://host:port", () => {
    expect(parseDockerHost("tcp://build-host:2376")).toEqual({ host: "build-host", port: 2376 });
  });
  it("parses host:port without a scheme", () => {
    expect(parseDockerHost("build-host:2375")).toEqual({ host: "build-host", port: 2375 });
  });
  it("defaults the port when omitted", () => {
    expect(parseDockerHost("build-host")).toEqual({ host: "build-host", port: 2375 });
  });
  it("strips an https scheme", () => {
    expect(parseDockerHost("https://h:2376")).toEqual({ host: "h", port: 2376 });
  });
});

describe("makeDockerClient socket resolution", () => {
  const savedDockerHost = process.env.DOCKER_HOST;
  afterEach(() => {
    if (savedDockerHost === undefined) delete process.env.DOCKER_HOST;
    else process.env.DOCKER_HOST = savedDockerHost;
  });

  it("throws a clear error when an explicit local socket path does not exist", () => {
    expect(() => makeDockerClient({ kind: "local", socketPath: "/no/such/docker.sock" }))
      .toThrow(/Docker socket not found at '\/no\/such\/docker\.sock'/);
  });

  it("throws when DOCKER_HOST points at a missing unix socket", () => {
    process.env.DOCKER_HOST = "unix:///no/such/from-env.sock";
    expect(() => makeDockerClient({ kind: "local" }))
      .toThrow(/Docker socket not found at '\/no\/such\/from-env\.sock'/);
  });

  it("does NOT do an existence check for a tcp:// DOCKER_HOST (connects lazily)", () => {
    process.env.DOCKER_HOST = "tcp://build-host:2376";
    expect(() => makeDockerClient({ kind: "local" })).not.toThrow();
  });

  it("does NOT do an existence check for a remote daemon connection", () => {
    expect(() => makeDockerClient({ kind: "remote", host: "tcp://remote:2376" })).not.toThrow();
  });
});
