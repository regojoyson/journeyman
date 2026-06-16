import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { WorkflowInstanceViewer as RunViewer } from "@journeyman/run-viewer";
import { StepRegistryProvider, OrgIdProvider } from "@journeyman/flow-editor";
import { builtInSteps } from "@journeyman/steps";
import type { WorkflowInstanceEvent } from "@journeyman/core";
import { getRun, openWorkflowInstanceEventStream } from "../api/runs.ts";
import { useRunActions } from "../hooks/useRunActions.ts";
import { useAuth } from "../AuthContext.tsx";

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeOrgId } = useAuth();
  const [liveEvents, setLiveEvents] = useState<WorkflowInstanceEvent[]>([]);
  const actions = useRunActions(id);

  const detailQ = useQuery({
    queryKey: ["run-detail", id],
    queryFn: () => getRun(id!),
    enabled: !!id,
  });

  const isViewer = detailQ.data?.workflowInstance.effectiveRole === "viewer";

  useEffect(() => {
    if (!id || !detailQ.data) return;
    const lastId = detailQ.data.events.at(-1)?.id ?? 0;
    const close = openWorkflowInstanceEventStream({
      runId: id, sinceId: lastId,
      onEvent: (ev) => setLiveEvents(prev => [...prev, ev]),
    });
    return close;
  }, [id, detailQ.data]);

  // Dedupe by event id: detailQ refetches (or initial load after SSE has
  // already pushed events) can return events that are also in liveEvents,
  // causing the run-viewer to render duplicate log lines. Order is preserved
  // by id ascending — events are append-only and ids are monotonic.
  const allEvents = useMemo(() => {
    const byId = new Map<number, WorkflowInstanceEvent>();
    for (const e of detailQ.data?.events ?? []) byId.set(e.id, e);
    for (const e of liveEvents) byId.set(e.id, e);
    return Array.from(byId.values()).sort((a, b) => a.id - b.id);
  }, [detailQ.data?.events, liveEvents]);

  if (!id) { navigate("/workflow-instances"); return null; }
  if (detailQ.isLoading) return <div style={{ padding: 24, color: "rgb(var(--color-text-muted) / 1)" }}>Loading run…</div>;
  if (detailQ.isError || !detailQ.data) return <div style={{ padding: 24, color: "rgb(var(--color-danger) / 1)" }}>Run not found.</div>;

  const busy = actions.cancel.isPending || actions.pause.isPending || actions.resume.isPending
    || actions.retry.isPending || actions.rerun.isPending || actions.fork.isPending
    || actions.resolveHuman.isPending;

  return (
    <div style={{ height: "100%" }}>
      {isViewer && (
        <div style={{
          padding: "8px 16px",
          margin: "0 0 8px",
          background: "rgb(var(--color-surface-raised) / 1)",
          borderLeft: "3px solid rgb(var(--color-info) / 1)",
          color: "rgb(var(--color-text) / 1)",
          fontSize: 13,
        }}>
          You're viewing this run as an org peer. Only the run's owner or an org admin can pause, retry, or cancel.
        </div>
      )}
      <OrgIdProvider orgId={activeOrgId ?? ""}>
      <StepRegistryProvider steps={builtInSteps}>
      <RunViewer
        workflow={detailQ.data.workflowInstance.definitionSnapshot}
        workflowName={
          detailQ.data.workflowInstance.workflowNameSnapshot
          + (detailQ.data.workflowInstance.workflowVersionId ? "" : " (workflow deleted)")
        }
        workflowInstance={detailQ.data.workflowInstance}
        events={allEvents}
        executions={detailQ.data.executions}
        triggerEvent={detailQ.data.webhookEvent ?? null}
        pendingHumanTask={detailQ.data.pendingHumanTask ?? null}
        humanTaskHistory={detailQ.data.humanTaskHistory ?? []}
        onResolveHumanTask={isViewer ? undefined : (input) => actions.resolveHuman.mutateAsync(input)}
        onCancel={isViewer ? undefined : () => actions.cancel.mutate()}
        onPause={isViewer ? undefined : () => actions.pause.mutate()}
        onResume={isViewer ? undefined : () => actions.resume.mutate()}
        onExport={isViewer ? undefined : actions.exportRun}
        onRetryStep={isViewer ? undefined : (nodeId: string) => actions.retry.mutate(nodeId)}
        onRerun={isViewer ? undefined : () => actions.rerun.mutate()}
        onFork={isViewer ? undefined : () => actions.fork.mutate()}
        onRefresh={() => { setLiveEvents([]); detailQ.refetch(); }}
      />
      </StepRegistryProvider>
      </OrgIdProvider>
      {busy && (
        <div style={{ position: "fixed", bottom: 16, left: 16, color: "rgb(var(--color-text-muted) / 1)", fontSize: 11 }}>
          working…
        </div>
      )}
    </div>
  );
}
