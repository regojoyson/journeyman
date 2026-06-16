import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import { agentServiceDef } from "@journeyman/agent-protocol";
import { createAgentServer } from "./server.ts";
import { loadServerCredentials } from "./credentials.ts";

const certDir = fileURLToPath(new URL("../spike/certs", import.meta.url));
const fixture = fileURLToPath(new URL("./__fixtures__/echo-runner.mjs", import.meta.url));
const hasCerts = existsSync(join(certDir, "server.pem"));

describe.skipIf(!hasCerts)("windows-agent loopback (mTLS)", () => {
  let server: grpc.Server;
  let client: grpc.Client & Record<string, (...a: unknown[]) => unknown>;
  let root: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "jm-agent-int-"));
    server = createAgentServer({
      config: { host: "127.0.0.1", port: 0, certDir, workspaceRoot: root, runnerCommand: process.execPath, runnerArgs: [fixture] },
      probe: async () => true,
    });
    const port = await new Promise<number>((res, rej) =>
      server.bindAsync("127.0.0.1:0", loadServerCredentials(certDir), (e, p) => (e ? rej(e) : res(p))));
    const creds = grpc.credentials.createSsl(
      readFileSync(join(certDir, "ca.pem")),
      readFileSync(join(certDir, "client-key.pem")),
      readFileSync(join(certDir, "client.pem")),
    );
    const Svc = agentServiceDef();
    client = new Svc(`127.0.0.1:${port}`, creds) as never;
  });
  afterAll(() => server?.forceShutdown());

  it("Provision → Exec(stream) → Destroy round-trips", async () => {
    const handle = await new Promise<{ workspace_dir: string }>((res, rej) =>
      client.Provision({ run_id: "r1" }, (e: unknown, r: unknown) => (e ? rej(e) : res(r as { workspace_dir: string }))));
    expect(handle.workspace_dir).toBe(join(root, "r1"));

    const logs: string[] = []; let final: { ok: boolean; structured_json: string } | null = null;
    await new Promise<void>((res, rej) => {
      const stream = client.Exec({ run_id: "r1", request_json: JSON.stringify({ op: "custom-prompt" }), env: {} }) as grpc.ClientReadableStream<{ log?: { line: string }; final?: { ok: boolean; structured_json: string } }>;
      stream.on("data", (ev) => { if (ev.log) logs.push(ev.log.line); if (ev.final) final = ev.final; });
      stream.on("end", res); stream.on("error", rej);
    });
    expect(logs).toContain("op=custom-prompt");
    expect(final!.ok).toBe(true);
    expect(JSON.parse(final!.structured_json)).toEqual({ op: "custom-prompt" });

    await new Promise<void>((res, rej) => client.Destroy({ run_id: "r1" }, (e: unknown) => (e ? rej(e) : res())));
  });

  it("Readiness returns a scorecard", async () => {
    const r = await new Promise<{ checks: Array<{ name: string }> }>((res, rej) =>
      client.Readiness({}, (e: unknown, x: unknown) => (e ? rej(e) : res(x as { checks: Array<{ name: string }> }))));
    expect(Array.isArray(r.checks)).toBe(true);
    expect(r.checks.some((c) => c.name === "workspace")).toBe(true);
  });
});
