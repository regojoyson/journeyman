import { describe, it, expect, vi } from "vitest";
import { listDockerSandboxConnections } from "./db.ts";

function fakeDb(rows: any[]) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe("listDockerSandboxConnections", () => {
  it("returns the connection objects that have a host", async () => {
    const db = fakeDb([
      { connection: { host: "tcp://docker:2375" } },
      { connection: { host: "tcp://build:2376", certDir: "/certs" } },
    ]);
    expect(await listDockerSandboxConnections(db)).toEqual([
      { host: "tcp://docker:2375" },
      { host: "tcp://build:2376", certDir: "/certs" },
    ]);
    expect(db.query.mock.calls[0][0]).toMatch(/from jm_sandboxes/i);
    expect(db.query.mock.calls[0][0]).toMatch(/type = 'docker'/i);
  });

  it("filters out rows with no connection or no host", async () => {
    const db = fakeDb([
      { connection: null },
      { connection: { certDir: "/x" } }, // no host
      { connection: { host: "tcp://ok:2375" } },
    ]);
    expect(await listDockerSandboxConnections(db)).toEqual([{ host: "tcp://ok:2375" }]);
  });
});
