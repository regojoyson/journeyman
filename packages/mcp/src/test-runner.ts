import type { Pool } from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  MissingMcpInstancesError,
  MissingSecretsError,
  type ResolvedMcpInstance,
} from "@journeyman/core";
import { resolveMcpInstances } from "./resolver.ts";
import { buildHeaders } from "./sdk-adapter.ts";

export type TestPhase = "resolve" | "connect" | "list" | "invoke";

export type TestAction =
  | { kind: "list" }
  | { kind: "invoke"; tool: string; args: Record<string, unknown> };

export interface ToolSummary {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export type TestOutcome =
  | { ok: true; tools: ToolSummary[] }
  | { ok: true; result: unknown }
  | { ok: false; error: string; phase: TestPhase };

const TEST_TIMEOUT_MS = 30_000;

export async function testMcpInstance(
  pool: Pool,
  ctx: { orgId: string; userId: string },
  instanceId: string,
  action: TestAction,
): Promise<TestOutcome> {
  let resolved: ResolvedMcpInstance;
  try {
    const out = await resolveMcpInstances(pool, ctx, [instanceId]);
    resolved = out[0]!;
  } catch (err) {
    if (err instanceof MissingMcpInstancesError || err instanceof MissingSecretsError) {
      return { ok: false, phase: "resolve", error: (err as Error).message };
    }
    return { ok: false, phase: "resolve", error: errMsg(err) };
  }

  let phase: TestPhase = "connect";
  const client = new Client({ name: "journeyman-test-client", version: "0.1.0" }, {});
  let transport: { close?: () => Promise<void> | void } | null = null;

  try {
    transport = buildTransport(resolved);
    await withTimeout(client.connect(transport as any), TEST_TIMEOUT_MS, () => phase);

    if (action.kind === "list") {
      phase = "list";
      const res: any = await withTimeout(client.listTools(), TEST_TIMEOUT_MS, () => phase);
      const tools: ToolSummary[] = (res?.tools ?? []).map((t: any) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      return { ok: true, tools };
    }

    phase = "invoke";
    const result = await withTimeout(
      client.callTool({ name: action.tool, arguments: action.args }),
      TEST_TIMEOUT_MS,
      () => phase,
    );
    return { ok: true, result };
  } catch (err) {
    return { ok: false, phase, error: errMsg(err) };
  } finally {
    try { await client.close(); } catch { /* ignore */ }
    if (transport && typeof transport.close === "function") {
      try { await transport.close(); } catch { /* ignore */ }
    }
  }
}

function buildTransport(inst: ResolvedMcpInstance) {
  if (inst.transport === "stdio") {
    return new StdioClientTransport({
      command: inst.command!,
      args: inst.args ?? [],
      env: inst.env,
    });
  }
  const headers = buildHeaders(inst.env);
  if (inst.transport === "sse") {
    // SSEClientTransport is deprecated by the SDK in favour of streamable HTTP,
    // but our instance schema still allows `sse` and some servers only speak it.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    // @ts-ignore deprecated but intentionally supported
    return new SSEClientTransport(new URL(inst.url!), { requestInit: { headers } });
  }
  return new StreamableHTTPClientTransport(new URL(inst.url!), { requestInit: { headers } });
}

function withTimeout<T>(p: Promise<T>, ms: number, getPhase: () => TestPhase): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms in phase:${getPhase()}`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}
