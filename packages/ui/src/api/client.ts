import type { RunListResponse, RunDetail, RunListItem, LogLine, FlowDefinition, ProviderCategory } from '@/types/api.types';

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

function normalizeRun(raw: any): RunListItem {
  return {
    sessionId: raw.sessionId,
    productId: raw.productId,
    flowName: raw.flowName,
    ticketKey: raw.ticketKey,
    // title is buried in step output; fall back to ticketKey
    title: raw.steps?.[0]?.output?.ticket?.title ?? '',
    status: raw.status,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    endedAt: raw.endedAt ?? null,
  };
}

function normalizeRunDetail(raw: any): RunDetail {
  return {
    ...normalizeRun(raw),
    ticketShortKey: raw.ticketShortKey ?? '',
    currentStep: raw.currentStep ?? null,
    steps: raw.steps ?? [],
    artifacts: raw.artifacts ?? {},
    flowSnapshot: raw.flowSnapshot,
  };
}

export async function getHealth(): Promise<{ ok: boolean }> {
  return parseJson(await fetch('/api/health', { headers: headers() }));
}

export async function getRuns(params?: { limit?: number; offset?: number; status?: string; productId?: string; search?: string }): Promise<RunListResponse> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  if (params?.status) qs.set('status', params.status);
  if (params?.productId) qs.set('product', params.productId);
  if (params?.search) qs.set('search', params.search);
  const raw = await parseJson(await fetch(`/api/runs?${qs.toString()}`, { headers: headers() }));
  return { runs: (raw.runs ?? []).map(normalizeRun), total: raw.total };
}

export async function getRunDetail(sessionId: string): Promise<RunDetail> {
  const raw = await parseJson(await fetch(`/api/runs/${encodeURIComponent(sessionId)}`, { headers: headers() }));
  return normalizeRunDetail(raw);
}

export async function getRunLogs(sessionId: string, stepId: string, opts?: { tail?: number }): Promise<LogLine[]> {
  const qs = new URLSearchParams();
  qs.set('stepId', stepId);
  if (opts?.tail) qs.set('tail', String(opts.tail));
  const raw = await parseJson(await fetch(`/api/runs/${encodeURIComponent(sessionId)}/logs?${qs.toString()}`, { headers: headers() }));
  // API returns { lines: TraceLine[] } where TraceLine uses `ts` not `timestamp`
  return (raw.lines ?? []).map((l: any, i: number): LogLine => ({
    id: `${l.ts}-${i}`,
    timestamp: l.ts,
    level: (l.level ?? 'info').toUpperCase(),
    message: l.message,
    source: l.stepId ?? stepId,
  }));
}

export async function cancelRun(sessionId: string): Promise<void> {
  const res = await fetch(`/api/runs/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST', headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${res.statusText} — ${body.slice(0, 200)}`);
  }
}

export async function createRun(
  productId: string,
  body: { ticketKey: string; ticketShortKey?: string; flowName?: string },
): Promise<{ accepted: boolean }> {
  return parseJson(await fetch(`/api/trigger/${encodeURIComponent(productId)}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  }));
}

export async function deleteRun(sessionId: string, force = false): Promise<void> {
  const url = `/api/runs/${encodeURIComponent(sessionId)}${force ? '?force=true' : ''}`;
  const { 'Content-Type': _, ...noBodyHeaders } = headers();
  const res = await fetch(url, { method: 'DELETE', headers: noBodyHeaders });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${res.statusText} — ${body.slice(0, 200)}`);
  }
}

export async function resumeRun(
  sessionId: string,
  opts?: { ticketStatus?: string },
): Promise<void> {
  const res = await fetch(`/api/runs/${encodeURIComponent(sessionId)}/resume`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(opts ?? {}),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${res.statusText} — ${body.slice(0, 200)}`);
  }
}

export async function retryRun(sessionId: string): Promise<void> {
  const res = await fetch(`/api/runs/${encodeURIComponent(sessionId)}/retry`, {
    method: 'POST',
    headers: headers(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${res.statusText} — ${body.slice(0, 200)}`);
  }
}

export async function getProducts(): Promise<{ id: string; flow: string }[]> {
  return parseJson(await fetch('/api/products', { headers: headers() }));
}

export async function getFlows(): Promise<FlowDefinition[]> {
  return parseJson(await fetch('/api/flows', { headers: headers() }));
}

export async function getProviders(): Promise<ProviderCategory[]> {
  return parseJson(await fetch('/api/providers', { headers: headers() }));
}
