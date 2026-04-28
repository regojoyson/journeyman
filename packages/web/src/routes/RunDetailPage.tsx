import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { RunViewer } from "@journeyman/run-viewer";
import type { RunEvent } from "@journeyman/core";
import { getRun, openRunEventStream } from "../api/runs.ts";
import { getFlowVersionById } from "../api/flow-versions.ts";
import { useRunActions } from "../hooks/useRunActions.ts";

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [liveEvents, setLiveEvents] = useState<RunEvent[]>([]);
  const actions = useRunActions(id);

  const detailQ = useQuery({
    queryKey: ["run-detail", id],
    queryFn: () => getRun(id!),
    enabled: !!id,
  });

  const versionId = detailQ.data?.run.flowVersionId;
  const isViewer = detailQ.data?.run.effectiveRole === "viewer";
  const versionQ = useQuery({
    queryKey: ["flow-version-by-id", versionId],
    queryFn: () => getFlowVersionById(versionId!),
    enabled: !!versionId,
  });

  useEffect(() => {
    if (!id || !detailQ.data) return;
    const lastId = detailQ.data.events.at(-1)?.id ?? 0;
    const close = openRunEventStream({
      runId: id, sinceId: lastId,
      onEvent: (ev) => setLiveEvents(prev => [...prev, ev]),
    });
    return close;
  }, [id, detailQ.data]);

  const allEvents = useMemo(() => [
    ...(detailQ.data?.events ?? []),
    ...liveEvents,
  ], [detailQ.data?.events, liveEvents]);

  if (!id) { navigate("/runs"); return null; }
  if (detailQ.isLoading) return <div style={{ padding: 24, color: "#888" }}>Loading run…</div>;
  if (detailQ.isError || !detailQ.data) return <div style={{ padding: 24, color: "#ff7675" }}>Run not found.</div>;
  if (versionQ.isLoading || !versionQ.data) {
    return <div style={{ padding: 24, color: "#888" }}>Loading flow definition…</div>;
  }

  const busy = actions.cancel.isPending || actions.pause.isPending || actions.resume.isPending
    || actions.retry.isPending || actions.rerun.isPending || actions.fork.isPending;

  return (
    <div style={{ height: "100%" }}>
      {isViewer && (
        <div style={{
          padding: "8px 16px",
          margin: "0 0 8px",
          background: "#2a2a3a",
          borderLeft: "3px solid #6c8eff",
          color: "#cfd6e4",
          fontSize: 13,
        }}>
          You're viewing this run as an org peer. Only the run's owner or an org admin can pause, retry, or cancel.
        </div>
      )}
      <RunViewer
        flow={versionQ.data.definition}
        flowName={`Flow v${versionQ.data.versionNumber}`}
        run={detailQ.data.run}
        events={allEvents}
        executions={detailQ.data.executions}
        onCancel={isViewer ? undefined : () => actions.cancel.mutate()}
        onPause={isViewer ? undefined : () => actions.pause.mutate()}
        onResume={isViewer ? undefined : () => actions.resume.mutate()}
        onExport={isViewer ? undefined : actions.exportRun}
        onRetryStep={isViewer ? undefined : (nodeId) => actions.retry.mutate(nodeId)}
        onRerun={isViewer ? undefined : () => actions.rerun.mutate()}
        onFork={isViewer ? undefined : () => actions.fork.mutate()}
      />
      {busy && (
        <div style={{ position: "fixed", bottom: 16, left: 16, color: "#888", fontSize: 11 }}>
          working…
        </div>
      )}
    </div>
  );
}
