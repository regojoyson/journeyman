import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { RunViewer } from "@journeyman/run-viewer";
import { PhaseRegistryProvider } from "@journeyman/flow-editor";
import { builtInPhases } from "@journeyman/phases";
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
      {detailQ.data?.webhookEvent && (
        <div style={{
          margin: "0 0 12px",
          padding: "12px 16px",
          background: "#1a1a2e",
          border: "1px solid #2a2a3e",
          borderRadius: 8,
          fontSize: 13,
          color: "#ccc",
        }}>
          <div style={{ fontWeight: 700, marginBottom: 10, color: "#fff", fontSize: 14 }}>Trigger</div>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {([
                ["Provider",  detailQ.data.webhookEvent.provider],
                ["Event",     detailQ.data.webhookEvent.eventType ?? "—"],
                ["Issue ref", detailQ.data.webhookEvent.issueRef ?? "—"],
                ["Delivery",  detailQ.data.webhookEvent.deliveryId ?? "—"],
                ["Received",  new Date(detailQ.data.webhookEvent.receivedAt).toUTCString()],
              ] as [string, string][]).map(([label, value]) => (
                <tr key={label}>
                  <td style={{ color: "#888", paddingRight: 16, paddingBottom: 4, whiteSpace: "nowrap" }}>{label}</td>
                  <td style={{ paddingBottom: 4 }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", color: "#6c5ce7", fontSize: 12 }}>Raw payload</summary>
            <pre style={{
              marginTop: 8, padding: 10, background: "#0f0f1e", borderRadius: 4,
              fontSize: 11, color: "#a0aec0", overflowX: "auto",
            }}>
              {JSON.stringify(detailQ.data.webhookEvent.rawPayload, null, 2)}
            </pre>
          </details>
        </div>
      )}
      <PhaseRegistryProvider phases={builtInPhases}>
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
      </PhaseRegistryProvider>
      {busy && (
        <div style={{ position: "fixed", bottom: 16, left: 16, color: "#888", fontSize: 11 }}>
          working…
        </div>
      )}
    </div>
  );
}
