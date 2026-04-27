import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RunViewer } from "@journeyman/run-viewer";
import type { FlowGraph, RunEvent } from "@journeyman/core";
import { getRun, openRunEventStream } from "../api/runs.ts";
import { getCurrentFlowVersion, listFlows, runFlow } from "../api/flows.ts";

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [liveEvents, setLiveEvents] = useState<RunEvent[]>([]);

  const detailQ = useQuery({
    queryKey: ["run-detail", id],
    queryFn: () => getRun(id!),
    enabled: !!id,
  });

  const versionId = detailQ.data?.run.flowVersionId;

  // Phase 3 stand-in: walk GET /flows to find the parent flow id for this version,
  // then fetch the version's definition. Phase 6 introduces /flow_versions/:id and
  // removes both helpers.
  const flowResolutionQ = useQuery({
    queryKey: ["run-flow-resolution", versionId],
    queryFn: async (): Promise<{ flowId: string; flowName: string; graph: FlowGraph } | null> => {
      if (!versionId) return null;
      const flows = await listFlows();
      const owner = flows.find(f => f.currentVersionId === versionId);
      if (!owner) return null;
      const v = await getCurrentFlowVersion(owner.id);
      if (v.id !== versionId) return null;
      qc.setQueryData(["flow-version-graph", versionId], v.definition);
      return { flowId: owner.id, flowName: owner.name, graph: v.definition };
    },
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

  const rerunM = useMutation({
    mutationFn: async () => {
      if (!flowResolutionQ.data) throw new Error("Cannot resolve flow id for run");
      return await runFlow(flowResolutionQ.data.flowId, detailQ.data?.run.inputs ?? {});
    },
    onSuccess: (res) => navigate(`/runs/${res.runId}`),
  });

  if (!id) { navigate("/runs"); return null; }
  if (detailQ.isLoading) return <div style={{ padding: 24, color: "#888" }}>Loading run…</div>;
  if (detailQ.isError || !detailQ.data) return <div style={{ padding: 24, color: "#ff7675" }}>Run not found.</div>;
  if (flowResolutionQ.isLoading || !flowResolutionQ.data) {
    return <div style={{ padding: 24, color: "#888" }}>Loading flow definition…</div>;
  }

  return (
    <div style={{ height: "100%" }}>
      <RunViewer
        flow={flowResolutionQ.data.graph}
        flowName={flowResolutionQ.data.flowName}
        run={detailQ.data.run}
        events={allEvents}
        executions={detailQ.data.executions}
        onRerun={() => rerunM.mutate()}
      />
    </div>
  );
}
