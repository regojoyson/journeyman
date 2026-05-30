import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  cancelRun, pauseRun, resumeRun, retryStep, rerunRun, forkRun, exportRunUrl, resolveHumanTask,
} from "../api/runs.ts";

export function useRunActions(runId: string | undefined) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const invalidate = () => {
    if (!runId) return;
    qc.invalidateQueries({ queryKey: ["run-detail", runId] });
    qc.invalidateQueries({ queryKey: ["runs"] });
  };

  const cancel = useMutation({
    mutationFn: () => cancelRun(runId!),
    onSuccess: invalidate,
  });
  const pause = useMutation({
    mutationFn: () => pauseRun(runId!),
    onSuccess: invalidate,
  });
  const resume = useMutation({
    mutationFn: () => resumeRun(runId!),
    onSuccess: invalidate,
  });
  const retry = useMutation({
    mutationFn: (nodeId: string) => retryStep(runId!, nodeId),
    onSuccess: invalidate,
  });
  const rerun = useMutation({
    mutationFn: () => rerunRun(runId!),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      navigate(`/workflow-instances/${res.workflowInstanceId}`);
    },
  });
  const fork = useMutation({
    mutationFn: () => forkRun(runId!),
    onSuccess: ({ workflow }) => {
      qc.invalidateQueries({ queryKey: ["flows"] });
      navigate(`/workflows/${workflow.id}/edit`);
    },
  });

  const resolveHuman = useMutation({
    mutationFn: (input: { nodeId: string; values: Record<string, unknown>; comment?: string; data?: unknown }) =>
      resolveHumanTask(runId!, input.nodeId, { values: input.values, comment: input.comment, data: input.data }),
    onSuccess: invalidate,
  });

  const exportRun = () => {
    if (!runId) return;
    const a = document.createElement("a");
    a.href = exportRunUrl(runId);
    a.download = `run-${runId}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return { cancel, pause, resume, retry, rerun, fork, exportRun, resolveHuman };
}
