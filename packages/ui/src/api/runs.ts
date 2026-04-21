// packages/ui/src/api/runs.ts
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { getRuns, getRunDetail, getRunLogs, cancelRun, getFlows, getProviders } from './client';
import { FilterStatus, FlowDefinition, LogLine, ProviderCategory, RunDetail, RunListResponse } from '@/types/api.types';

const RUNS_QUERY_KEY = ['runs'] as const;
const DETAIL_KEY = (id: string) => ['runDetail', id] as const;
const LOGS_KEY = (sessionId: string, stepId: string) => ['runLogs', sessionId, stepId] as const;

export function useRuns(filter: { status?: FilterStatus; productId?: string; search?: string; limit?: number }, intervalMs: number) {
  return useQuery<RunListResponse>({
    queryKey: RUNS_QUERY_KEY,
    queryFn: () => getRuns(filter),
    refetchInterval: (query: any) => {
      const data = query?.state?.data;
      if (intervalMs < 10000 && data?.runs?.some((r: { status: string }) => r.status === 'running')) {
        return 5000;
      }
      return intervalMs;
    },
  });
}

export function useRunDetail(sessionId: string, _intervalMs: number) {
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

export function useLogs(sessionId: string, stepId: string) {
  return useQuery<LogLine[]>({
    queryKey: LOGS_KEY(sessionId, stepId),
    queryFn: () => getRunLogs(sessionId, stepId, { tail: 100 }),
  });
}

export function useCancelRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => cancelRun(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RUNS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: DETAIL_KEY('') });
    },
  });
}

export function useFlows() {
  return useQuery<FlowDefinition[]>({
    queryKey: ['flows'],
    queryFn: getFlows,
  });
}

export function useProviders() {
  return useQuery<ProviderCategory[]>({
    queryKey: ['providers'],
    queryFn: getProviders,
  });
}
