import type { BuildPlan } from "@journeyman/core";
import { api, ApiError } from "./client.ts";
import { parseSseBuffer, type SseEvent } from "./sse-parse.ts";

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

export interface BuilderSession {
  id: string;
  name: string;
  status: "active" | "applied" | "archived";
  messages: { role: "user" | "assistant"; content: string }[];
  buildPlan: BuildPlan | null;
  appliedFlowId: string | null;
}

export async function createBuilderSession(orgId: string, name: string): Promise<BuilderSession> {
  return api<BuilderSession>(`/api/orgs/${orgId}/users/me/builder/sessions`, {
    method: "POST", body: JSON.stringify({ name }),
  });
}

export async function getBuilderSession(orgId: string, id: string): Promise<BuilderSession> {
  return api<BuilderSession>(`/api/orgs/${orgId}/users/me/builder/sessions/${id}`);
}

export async function applyBuilderPlan(orgId: string, id: string): Promise<{ workflowId: string; versionId: string }> {
  return api<{ workflowId: string; versionId: string }>(
    `/api/orgs/${orgId}/users/me/builder/sessions/${id}/apply`,
    { method: "POST", body: "{}" },
  );
}

/**
 * Stream a chat turn. The endpoint is a POST SSE, so we read the response body
 * as a stream (EventSource can't POST). Calls `onEvent` per parsed SSE event.
 */
export async function streamBuilderChat(args: {
  orgId: string;
  sessionId: string;
  message: string;
  onEvent: (ev: SseEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const res = await fetch(
    `${baseUrl}/api/orgs/${args.orgId}/users/me/builder/sessions/${args.sessionId}/messages`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: args.message }),
      signal: args.signal,
    },
  );
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseBuffer(buf);
    buf = rest;
    for (const ev of events) args.onEvent(ev);
  }
}
