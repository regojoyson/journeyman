import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// Mock node:fs/promises so we can track rm calls without touching the real FS.
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

// Mock node:child_process so we can control execFile without running git.
vi.mock("node:child_process", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:child_process")>();
  return {
    ...orig,
    execFile: vi.fn((_cmd: string, _args: string[], _opts: object, cb: (err: null, stdout: string, stderr: string) => void) => {
      cb(null, "", "");
    }),
  };
});

import { rm, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { cloneRepos } from "./clone-repos.ts";

const rmMock = vi.mocked(rm);
// execFile has many overloads; cast through unknown so mockImplementation accepts a simple callback impl.
type ExecFileCb = (err: null, stdout: string, stderr: string) => void;
type SimpleExecFile = Mock<(cmd: string, args: string[], opts: object, cb: ExecFileCb) => void>;
const execFileMock = vi.mocked(execFile) as unknown as SimpleExecFile;
const mkdirMock = vi.mocked(mkdir);

beforeEach(() => {
  vi.clearAllMocks();
  mkdirMock.mockResolvedValue(undefined);
  rmMock.mockResolvedValue(undefined);
  execFileMock.mockImplementation(
    (_cmd, _args, _opts, cb) => { cb(null, "", ""); },
  );
});

describe("cloneRepos", () => {
  it("removes an existing repoDir before cloning (idempotent retry)", async () => {
    const callOrder: string[] = [];
    rmMock.mockImplementation(async () => { callOrder.push("rm"); });
    execFileMock.mockImplementation(
      (_cmd, _args, _opts, cb) => {
        callOrder.push("git-clone");
        cb(null, "", "");
      },
    );

    const result = await cloneRepos("tok", {
      repos: "https://github.com/org/repo",
      workspaceDir: "/tmp/ws",
    });

    // rm should have been called before git clone
    expect(callOrder).toEqual(["rm", "git-clone"]);
    // rm called with the expected repoDir and options
    expect(rmMock).toHaveBeenCalledWith("/tmp/ws/repo", { recursive: true, force: true });
    // clone still succeeds
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].error).toBeUndefined();
  });

  it("succeeds even when called twice (second call rm cleans up the first clone)", async () => {
    const result1 = await cloneRepos("tok", {
      repos: "https://github.com/org/myrepo",
      workspaceDir: "/tmp/ws",
    });
    const result2 = await cloneRepos("tok", {
      repos: "https://github.com/org/myrepo",
      workspaceDir: "/tmp/ws",
    });
    expect(result1.repos[0].error).toBeUndefined();
    expect(result2.repos[0].error).toBeUndefined();
    // rm was called once per cloneRepos invocation
    expect(rmMock).toHaveBeenCalledTimes(2);
  });
});
