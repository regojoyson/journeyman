// packages/ui/src/api/client.ts

import { RunListResponse, RunDetail, LogLine, FlowDefinition, ProviderCategory } from '@/types/api.types';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const TOKEN = import.meta.env.VITE_API_TOKEN;

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (TOKEN) h['Authorization'] = `Bearer ${TOKEN}`;
  return h;
}

async function parseJson(res: Response): Promise<any> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${res.statusText} — ${body.slice(0, 200)}`);
  }
  return res.json();
}

export async function getRuns(params?: { limit?: number; offset?: number; status?: string; productId?: string; search?: string }): Promise<RunListResponse> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  if (params?.status) qs.set('status', params.status);
  if (params?.productId) qs.set('productId', params.productId);
  if (params?.search) qs.set('search', params.search);
  const url = `${BASE_URL}/api/runs?${qs.toString()}`;
  return parseJson(await fetch(url, { headers: headers() })) as Promise<RunListResponse>;
}

export async function getRunDetail(sessionId: string): Promise<RunDetail> {
  const url = `${BASE_URL}/api/runs/${encodeURIComponent(sessionId)}`;
  return parseJson(await fetch(url, { headers: headers() })) as Promise<RunDetail>;
}

export async function getRunLogs(sessionId: string, stepId: string, opts?: { tail?: number }): Promise<LogLine[]> {
  const qs = new URLSearchParams();
  qs.set('stepId', stepId);
  if (opts?.tail) qs.set('tail', String(opts.tail));
  const url = `${BASE_URL}/api/runs/${encodeURIComponent(sessionId)}/logs?${qs.toString()}`;
  return parseJson(await fetch(url, { headers: headers() })) as Promise<LogLine[]>;
}

export async function cancelRun(sessionId: string): Promise<void> {
  const url = `${BASE_URL}/api/runs/${encodeURIComponent(sessionId)}/cancel`;
  const res = await fetch(url, { method: 'POST', headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${res.statusText} — ${body.slice(0, 200)}`);
  }
}

export async function getFlows(): Promise<FlowDefinition[]> {
  const url = `${BASE_URL}/api/flows`;
  return parseJson(await fetch(url, { headers: headers() })) as Promise<FlowDefinition[]>;
}

export async function getProviders(): Promise<ProviderCategory[]> {
  const url = `${BASE_URL}/api/providers`;
  return parseJson(await fetch(url, { headers: headers() })) as Promise<ProviderCategory[]>;
}

export { BASE_URL };
