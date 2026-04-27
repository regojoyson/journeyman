import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlowEditor } from "@journeyman/flow-editor";
import type { FlowGraph } from "@journeyman/core";
import { getFlow, getCurrentFlowVersion, runFlow, updateFlowDefinition } from "../api/flows.ts";
import { builtInPhaseCatalog } from "../catalogs/built-in-phase-catalog.ts";
import { RunSubmittedToast } from "../components/RunSubmittedToast.tsx";

export function FlowEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [graph, setGraph] = useState<FlowGraph | null>(null);
  const [, setDirty] = useState(false);
  const [toast, setToast] = useState<{ runId: string; engineWorkflowId: string } | null>(null);

  const flowQ = useQuery({
    queryKey: ["flow", id],
    queryFn: () => getFlow(id!),
    enabled: !!id,
  });

  const versionQ = useQuery({
    queryKey: ["flow-version-current", id],
    queryFn: () => getCurrentFlowVersion(id!),
    enabled: !!id && !!flowQ.data,
  });

  useEffect(() => {
    if (!id || graph) return;
    const cached = qc.getQueryData<FlowGraph>(["flow-graph", id]);
    if (cached) { setGraph(cached); return; }
    if (versionQ.data) setGraph(versionQ.data.definition);
  }, [id, graph, qc, versionQ.data]);

  const saveM = useMutation({
    mutationFn: (next: FlowGraph) => updateFlowDefinition(id!, next),
    onSuccess: (_, next) => {
      qc.setQueryData(["flow-graph", id], next);
      qc.invalidateQueries({ queryKey: ["flow-version-current", id] });
      setDirty(false);
    },
  });

  const runM = useMutation({
    mutationFn: () => runFlow(id!, {}),
    onSuccess: (res) => setToast(res),
  });

  if (!id) { navigate("/flows"); return null; }
  if (flowQ.isLoading || versionQ.isLoading || !graph) {
    return <div style={{ padding: 24, color: "#888" }}>Loading editor…</div>;
  }
  if (flowQ.isError || !flowQ.data) {
    return <div style={{ padding: 24, color: "#ff7675" }}>Flow not found.</div>;
  }

  return (
    <>
      <div style={{ height: "100%" }}>
        <FlowEditor
          flow={graph}
          flowName={flowQ.data.name}
          phaseCatalog={builtInPhaseCatalog}
          onChange={(next) => { setGraph(next); setDirty(true); }}
          onSave={async (next) => { await saveM.mutateAsync(next); }}
          onRun={async () => { await runM.mutateAsync(); }}
          busy={saveM.isPending || runM.isPending}
        />
      </div>
      {toast && (
        <RunSubmittedToast
          runId={toast.runId}
          engineWorkflowId={toast.engineWorkflowId}
          onViewLive={() => navigate(`/runs/${toast.runId}`)}
          onDismiss={() => setToast(null)}
        />
      )}
    </>
  );
}
