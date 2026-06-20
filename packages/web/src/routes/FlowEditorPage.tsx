import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlowEditor } from "@journeyman/flow-editor";
import type { Workflow, WorkflowGraph } from "@journeyman/core";
import { getFlow, getCurrentWorkflowVersion, updateFlowDefinition, updateFlowMeta, validateFlowDefinition, publishFlow, unpublishFlow, deleteFlow, type UnpublishWarning } from "../api/flows.ts";
import { workflowCapabilities } from "../lib/workflow-capabilities.ts";
import { getWorkflowTriggers, type TriggerSummary } from "../api/workflow-triggers.ts";
import { builtInSteps } from "@journeyman/steps";
import { useCustomStepPaletteEntries } from "../flow-editor-integration/useCustomStepPaletteEntries.ts";
import { defaultControlCatalog } from "../catalogs/built-in-control-catalog.ts";
import { defaultMcpCatalog } from "../catalogs/built-in-mcp-catalog.ts";
import { StatusToast } from "../components/StatusToast.tsx";
import { useAuth } from "../AuthContext.tsx";
import { useWorkspace } from "../WorkspaceContext.tsx";

export function FlowEditorPage() {
  const { id, wsId = "" } = useParams<{ id: string; wsId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [, setDirty] = useState(false);
  const [saveToast, setSaveToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [triggers, setTriggers] = useState<TriggerSummary[] | null>(null);
  const { activeOrgId } = useAuth();
  const { can } = useWorkspace();
  const customStepDefs = useCustomStepPaletteEntries(wsId);

  const flowQ = useQuery({
    queryKey: ["flow", id],
    queryFn: async () => {
      // eslint-disable-next-line no-console
      console.log("[FlowEditorPage] fetching flow meta", { id });
      const result = await getFlow(wsId, id!);
      if (!result) throw new Error(`Flow ${id} not found`);
      // eslint-disable-next-line no-console
      console.log("[FlowEditorPage] flow meta loaded", { id, name: result.name });
      return result;
    },
    enabled: !!id,
  });

  const versionQ = useQuery({
    queryKey: ["flow-version-current", id],
    queryFn: async () => {
      // eslint-disable-next-line no-console
      console.log("[FlowEditorPage] fetching current version", { id });
      const result = await getCurrentWorkflowVersion(wsId, id!);
      // eslint-disable-next-line no-console
      console.log("[FlowEditorPage] current version loaded", {
        id,
        nodes: result.definition?.nodes?.length,
        edges: result.definition?.edges?.length,
      });
      return result;
    },
    enabled: !!id && !!flowQ.data,
  });

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[FlowEditorPage] graph-init effect", {
      id, hasGraph: !!graph,
      versionLoaded: !!versionQ.data,
      flowLoaded: !!flowQ.data,
      flowLoading: flowQ.isLoading,
      versionLoading: versionQ.isLoading,
    });
    if (!id || graph) return;
    const cached = qc.getQueryData<WorkflowGraph>(["flow-graph", id]);
    if (cached) {
      // eslint-disable-next-line no-console
      console.log("[FlowEditorPage] restoring graph from query cache", { id });
      setGraph(cached);
      return;
    }
    if (versionQ.data) {
      // eslint-disable-next-line no-console
      console.log("[FlowEditorPage] setting graph from version data", { id });
      setGraph(versionQ.data.definition);
    }
  }, [id, graph, qc, versionQ.data]);

  useEffect(() => {
    if (!id) return;
    getWorkflowTriggers(id).then(setTriggers).catch(() => setTriggers([]));
  }, [id]);

  const saveM = useMutation({
    mutationFn: (next: WorkflowGraph) => updateFlowDefinition(wsId, id!, next),
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
    mutationFn: (name: string) => updateFlowMeta(wsId, id!, { name }),
    onSuccess: ({ workflow: updated }) => {
      qc.setQueryData(["flow", id], updated);
      qc.invalidateQueries({ queryKey: ["flows"] });
      setSaveToast({ kind: "success", message: "Flow renamed." });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Could not rename the flow.";
      setSaveToast({ kind: "error", message: msg });
    },
  });

  if (!id) { navigate(`/workspaces/${wsId}/workflows`); return null; }
  if (flowQ.isLoading || versionQ.isLoading || !graph) {
    // eslint-disable-next-line no-console
    console.log("[FlowEditorPage] still loading", {
      flowLoading: flowQ.isLoading, versionLoading: versionQ.isLoading,
      flowStatus: flowQ.status, versionStatus: versionQ.status,
      hasGraph: !!graph,
    });
    return <div style={{ padding: 24, color: "rgb(var(--color-text-muted) / 1)" }}>Loading editor…</div>;
  }
  if (flowQ.isError || !flowQ.data) {
    return <div style={{ padding: 24, color: "rgb(var(--color-danger) / 1)" }}>Flow not found.</div>;
  }

  const flow = flowQ.data;
  const caps = workflowCapabilities({ can, status: flow.status });

  const onPublish = async () => {
    const res = await publishFlow(wsId, flow.id);
    if (res.ok) {
      qc.setQueryData(["flow", id], res.workflow);
      qc.invalidateQueries({ queryKey: ["flows"] });
      setSaveToast({ kind: "success", message: "Flow published." });
      return { ok: true as const };
    }
    return { ok: false as const, serverErrors: res.errors };
  };

  const onUnpublish = async (confirm: boolean): Promise<UnpublishWarning | null> => {
    const res = await unpublishFlow(wsId, flow.id, confirm);
    if (res.ok) {
      qc.setQueryData(["flow", id], res.workflow);
      qc.invalidateQueries({ queryKey: ["flows"] });
      setSaveToast({ kind: "success", message: "Flow moved to Draft." });
      return null;
    }
    return res.warning;
  };

  const onDelete = async () => {
    try {
      await deleteFlow(wsId, flow.id);
      qc.invalidateQueries({ queryKey: ["flows"] });
      navigate(`/workspaces/${wsId}/workflows`);
    } catch (e) {
      setSaveToast({ kind: "error", message: `Delete failed: ${(e as Error).message}` });
    }
  };

  return (
    <>
      <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
        {triggers && triggers.length > 0 ? (
          <div className="jm-trigger-summary" style={{ padding: "6px 12px", fontSize: 12, color: "rgb(var(--color-border-strong) / 1)", flex: "0 0 auto" }}>
            Triggered by:{" "}
            {triggers.map((t, i) => (
              <span key={t.id}>
                {i > 0 ? ", " : ""}
                {t.type === "trigger-manual"
                  ? "Manual"
                  : t.type === "trigger-webhook"
                  ? `Webhook${t.webhook ? ` (${t.webhook.name})` : ""}`
                  : "Human form"}
              </span>
            ))}
          </div>
        ) : null}
        {caps.readOnly && flow.status === "draft" && (
          <div style={{
            padding: "8px 12px", marginBottom: 12,
            background: "rgb(var(--color-warning) / 0.18)", border: "1px solid rgb(var(--color-warning) / 1)", borderRadius: 4,
          }}>
            This flow is read-only. You do not have edit access to this workspace.
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0 }}>
          <FlowEditor
            flow={graph}
            flowName={flow.name}
            readOnly={caps.readOnly}
            onRename={caps.canEdit ? (next) => {
              const trimmed = next.trim();
              if (!trimmed || trimmed === flow.name) return;
              renameM.mutate(trimmed);
            } : undefined}
            orgId={activeOrgId}
            wsId={wsId}
            steps={[...builtInSteps, ...customStepDefs]}
            controlCatalog={defaultControlCatalog}
            mcpCatalog={defaultMcpCatalog}
            onChange={(next) => { setGraph(next); setDirty(true); }}
            onSave={caps.canEdit ? async (next) => { await saveM.mutateAsync(next); } : undefined}
            onValidate={async (next) => await validateFlowDefinition(wsId, next)}
            busy={saveM.isPending}
            status={flow.status}
            onPublish={caps.canPublish ? onPublish : undefined}
            onUnpublish={caps.canPublish ? onUnpublish : undefined}
            showPalette={caps.showPalette}
            onDelete={caps.canDelete ? onDelete : undefined}
            exportEnabled={caps.canExport}
          />
        </div>
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
