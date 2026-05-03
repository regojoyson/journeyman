import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlowEditor } from "@journeyman/flow-editor";
import type { Flow, FlowGraph } from "@journeyman/core";
import { getFlow, getCurrentFlowVersion, updateFlowDefinition, updateFlowMeta, validateFlowDefinition } from "../api/flows.ts";
import { cloneFlow } from "../api/flow-grants.ts";
import { builtInPhases } from "@journeyman/phases";
import { defaultControlCatalog } from "../catalogs/built-in-control-catalog.ts";
import { defaultMcpCatalog } from "../catalogs/built-in-mcp-catalog.ts";
import { StatusToast } from "../components/StatusToast.tsx";
import { useAuth } from "../AuthContext.tsx";

function canEditFlow(
  flow: Flow,
  ctx: { userId: string | null; orgId: string; role: string; isPlatformAdmin: boolean },
): boolean {
  if (ctx.isPlatformAdmin) return true;
  if (flow.scope === "global") return false;
  if (flow.scope === "org") return ctx.role === "admin" && flow.orgId === ctx.orgId;
  return flow.ownerUserId === ctx.userId;
}

export function FlowEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [graph, setGraph] = useState<FlowGraph | null>(null);
  const [, setDirty] = useState(false);
  const [saveToast, setSaveToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const { user, activeOrgId, role, isPlatformAdmin } = useAuth();

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
      setSaveToast({ kind: "success", message: "Flow saved." });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Could not save the flow.";
      setSaveToast({ kind: "error", message: msg });
    },
  });

  const renameM = useMutation({
    mutationFn: (name: string) => updateFlowMeta(id!, { name }),
    onSuccess: ({ flow: updated }) => {
      qc.setQueryData(["flow", id], updated);
      qc.invalidateQueries({ queryKey: ["flows"] });
      setSaveToast({ kind: "success", message: "Flow renamed." });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Could not rename the flow.";
      setSaveToast({ kind: "error", message: msg });
    },
  });

  if (!id) { navigate("/flows"); return null; }
  if (flowQ.isLoading || versionQ.isLoading || !graph) {
    return <div style={{ padding: 24, color: "#888" }}>Loading editor…</div>;
  }
  if (flowQ.isError || !flowQ.data) {
    return <div style={{ padding: 24, color: "#ff7675" }}>Flow not found.</div>;
  }

  const flow = flowQ.data;
  const editable = canEditFlow(flow, {
    userId: user?.id ?? null,
    orgId: activeOrgId,
    role,
    isPlatformAdmin,
  });

  const onClone = async () => {
    const { id: newId } = await cloneFlow(flow.id);
    navigate(`/flows/${newId}/edit`);
  };

  return (
    <>
      <div style={{ height: "100%" }}>
        {!editable && (
          <div style={{
            padding: "8px 12px", marginBottom: 12,
            background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 4,
          }}>
            This is a {flow.scope} template. <button onClick={onClone}>Clone to my flows</button> to make changes.
          </div>
        )}
        <FlowEditor
          flow={graph}
          flowName={flow.name}
          onRename={editable ? (next) => {
            const trimmed = next.trim();
            if (!trimmed || trimmed === flow.name) return;
            renameM.mutate(trimmed);
          } : undefined}
          orgId={activeOrgId}
          phases={builtInPhases}
          controlCatalog={defaultControlCatalog}
          mcpCatalog={defaultMcpCatalog}
          onChange={(next) => { setGraph(next); setDirty(true); }}
          onSave={editable ? async (next) => { await saveM.mutateAsync(next); } : undefined}
          onValidate={async (next) => await validateFlowDefinition(next)}
          busy={saveM.isPending}
        />
      </div>
      {saveToast && (
        <StatusToast
          kind={saveToast.kind}
          message={saveToast.message}
          onDismiss={() => setSaveToast(null)}
        />
      )}
    </>
  );
}
