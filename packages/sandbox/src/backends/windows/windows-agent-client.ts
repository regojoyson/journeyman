import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as grpc from "@grpc/grpc-js";
import { agentServiceDef } from "@journeyman/agent-protocol";
import type {
  ProvisionRequest, ProvisionReply, ExecRequest, ExecEvent, FileChunk,
  MaterializeReply, DestroyRequest, DestroyReply, ListRequest, ListReply, ReadinessReply,
} from "@journeyman/agent-protocol";

export interface WindowsAgentConnection { host: string; port: number; certDir: string; }

/** Typed surface of the dynamically-built gRPC client. */
export interface AgentClient {
  Provision(req: ProvisionRequest, cb: (e: Error | null, r: ProvisionReply) => void): void;
  Destroy(req: DestroyRequest, cb: (e: Error | null, r: DestroyReply) => void): void;
  List(req: ListRequest, cb: (e: Error | null, r: ListReply) => void): void;
  Readiness(req: Record<string, never>, cb: (e: Error | null, r: ReadinessReply) => void): void;
  Exec(req: ExecRequest): grpc.ClientReadableStream<ExecEvent>;
  Materialize(cb: (e: Error | null, r: MaterializeReply) => void): grpc.ClientWritableStream<FileChunk>;
  close(): void;
}

/** Build a per-connection mTLS gRPC client for the Windows agent. */
export function makeWindowsAgentClient(conn: WindowsAgentConnection): AgentClient {
  if (!conn?.host || !conn?.port) {
    throw new Error("windows agent connection needs an explicit host and port");
  }
  let ca: Buffer, cert: Buffer, key: Buffer;
  try {
    ca = readFileSync(join(conn.certDir, "ca.pem"));
    cert = readFileSync(join(conn.certDir, "client.pem"));
    key = readFileSync(join(conn.certDir, "client-key.pem"));
  } catch (e) {
    throw new Error(`failed to read mTLS client certs from ${conn.certDir} (need ca.pem/client.pem/client-key.pem): ${(e as Error).message}`);
  }
  const creds = grpc.credentials.createSsl(ca, key, cert);
  const Svc = agentServiceDef();
  return new Svc(`${conn.host}:${conn.port}`, creds, {
    "grpc.keepalive_time_ms": 30_000,
    "grpc.keepalive_timeout_ms": 10_000,
    "grpc.keepalive_permit_without_calls": 1,
  }) as unknown as AgentClient;
}
