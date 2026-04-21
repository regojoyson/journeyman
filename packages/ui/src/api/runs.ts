import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { getRuns, getRunDetail, getRunLogs, cancelRun, getFlows, getProviders, getHealth, createRun, deleteRun, resumeRun, getProducts } from './client';
import { FilterStatus, FlowDefinition, LogLine, ProviderCategory, RunDetail, RunListResponse } from '@/types/api.types';

export const RUNS_QUERY_KEY = ['runs'] as const;
const DETAIL_KEY = (id: string) => ['runDetail', id] as const;
const LOGS_KEY = (sessionId: string, stepId: string) => ['runLogs', sessionId, stepId] as const;
const PRODUCTS_QUERY_KEY = ['products'] as const;
const FLOWS_QUERY_KEY = ['flows'] as const;
const PROVIDERS_QUERY_KEY = ['providers'] as const;
const HEALTH_QUERY_KEY = ['health'] as const;

export function useRuns(
  filter: { status?: FilterStatus; productId?: string; search?: string; limit?: number },
  intervalSecs: number,
) {
  const ms = intervalSecs * 1000;
  return useQuery<RunListResponse>({
    // Include filter in key so different filter combos get separate cache slots.
    queryKey: [...RUNS_QUERY_KEY, filter],
    queryFn: () => getRuns(filter),
    refetchInterval: (query: any) => {
      const data = query?.state?.data;
      if (ms <= 10000 && data?.runs?.some((r: { status: string }) => r.status === 'running')) {
        return 5000;
      }
      return ms;
    },
  });
}

export function useRunDetail(sessionId: string) {
  return useQuery<RunDetail>({
    queryKey: DETAIL_KEY(sessionId),
    queryFn: () => getRunDetail(sessionId),
    enabled: !!sessionId,
    refetchInterval: (query: any) => {
      const data = query?.state?.data;
      return data?.status === 'running' ? 5000 : false;
    },
  });
}

export function useLogs(sessionId: string, stepId: string | null) {
  return useQuery<LogLine[]>({
    queryKey: LOGS_KEY(sessionId, stepId ?? ''),
    queryFn: () => getRunLogs(sessionId, stepId!, { tail: 100 }),
    enabled: !!sessionId && !!stepId,
  });
}

export function useCancelRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => cancelRun(sessionId),
    onSuccess: (_data, sessionId) => {
      queryClient.invalidateQueries({ queryKey: RUNS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: DETAIL_KEY(sessionId) });
    },
  });
}

export function useCreateRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, ...body }: { productId: string; ticketKey: string; ticketShortKey?: string; flowName?: string }) =>
      createRun(productId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RUNS_QUERY_KEY });
    },
  });
}

export function useDeleteRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, force }: { sessionId: string; force?: boolean }) =>
      deleteRun(sessionId, force),
    onSuccess: (_data, { sessionId }) => {
      queryClient.invalidateQueries({ queryKey: RUNS_QUERY_KEY });
      queryClient.removeQueries({ queryKey: DETAIL_KEY(sessionId) });
    },
  });
}

export function useResumeRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, ticketStatus }: { sessionId: string; ticketStatus?: string }) =>
      resumeRun(sessionId, { ticketStatus }),
    onSuccess: (_data, { sessionId }) => {
      queryClient.invalidateQueries({ queryKey: RUNS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: DETAIL_KEY(sessionId) });
    },
  });
}

export function useProducts() {
  return useQuery<string[]>({
    queryKey: PRODUCTS_QUERY_KEY,
    queryFn: getProducts,
  });
}

export function useFlows() {
  return useQuery<FlowDefinition[]>({
    queryKey: FLOWS_QUERY_KEY,
    queryFn: getFlows,
  });
}

export function useProviders() {
  return useQuery<ProviderCategory[]>({
    queryKey: PROVIDERS_QUERY_KEY,
    queryFn: getProviders,
  });
}

export function useHealth(intervalSecs: number) {
  return useQuery<{ ok: boolean }>({
    queryKey: HEALTH_QUERY_KEY,
    queryFn: getHealth,
    refetchInterval: intervalSecs * 1000,
    retry: 1,
  });
}
