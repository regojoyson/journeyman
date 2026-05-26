import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlowEditor } from "@journeyman/flow-editor";
import type { Workflow, WorkflowGraph } from "@journeyman/core";
import { getFlow, getCurrentWorkflowVersion, updateFlowDefinition, updateFlowMeta, validateFlowDefinition, publishFlow, unpublishFlow, type UnpublishWarning } from "../api/flows.ts";
import { getWorkflowTriggers, type TriggerSummary } from "../api/workflow-triggers.ts";
import { cloneFlow } from "../api/flow-grants.ts";
import { builtInSteps } from "@journeyman/steps";
import { useCustomStepPaletteEntries } from "../flow-editor-integration/useCustomStepPaletteEntries.ts";
import { defaultControlCatalog } from "../catalogs/built-in-control-catalog.ts";
import { defaultMcpCatalog } from "../catalogs/built-in-mcp-catalog.ts";
import { StatusToast } from "../components/StatusToast.tsx";
import { useAuth } from "../AuthContext.tsx";

function canEditFlow(
  flow: Workflow,
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
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [, setDirty] = useState(false);
  const [saveToast, setSaveToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [triggers, setTriggers] = useState<TriggerSummary[] | null>(null);
  const { user, activeOrgId, role, isPlatformAdmin } = useAuth();
  const customStepDefs = useCustomStepPaletteEntries(activeOrgId);

  const flowQ = useQuery({
    queryKey: ["flow", id],
    queryFn: async () => {
      // eslint-disable-next-line no-console
      console.log("[FlowEditorPage] fetching flow meta", { id });
      const result = await getFlow(id!);
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
      const result = await getCurrentWorkflowVersion(id!);
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
    mutationFn: (next: WorkflowGraph) => updateFlowDefinition(id!, next),
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

  if (!id) { navigate("/flows"); return null; }
  if (flowQ.isLoading || versionQ.isLoading || !graph) {
    // eslint-disable-next-line no-console
    console.log("[FlowEditorPage] still loading", {
      flowLoading: flowQ.isLoading, versionLoading: versionQ.isLoading,
      flowStatus: flowQ.status, versionStatus: versionQ.status,
      hasGraph: !!graph,
    });
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
    navigate(`/workflows/${newId}/edit`);
  };

  const onPublish = async () => {
    const res = await publishFlow(flow.id);
    if (res.ok) {
      qc.setQueryData(["flow", id], res.workflow);
      qc.invalidateQueries({ queryKey: ["flows"] });
      setSaveToast({ kind: "success", message: "Flow published." });
      return { ok: true as const };
    }
    return { ok: false as const, serverErrors: res.errors };
  };

  const onUnpublish = async (confirm: boolean): Promise<UnpublishWarning | null> => {
    const res = await unpublishFlow(flow.id, confirm);
    if (res.ok) {
      qc.setQueryData(["flow", id], res.workflow);
      qc.invalidateQueries({ queryKey: ["flows"] });
      setSaveToast({ kind: "success", message: "Flow moved to Draft." });
      return null;
    }
    return res.warning;
  };

  return (
    <>
      <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
        {triggers && triggers.length > 0 ? (
          <div className="jm-trigger-summary" style={{ padding: "6px 12px", fontSize: 12, color: "#666", flex: "0 0 auto" }}>
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
        {!editable && (
          <div style={{
            padding: "8px 12px", marginBottom: 12,
            background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 4,
          }}>
            This is a {flow.scope} template. <button onClick={onClone}>Clone to my flows</button> to make changes.
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0 }}>
          <FlowEditor
            flow={graph}
            flowName={flow.name}
            onRename={editable ? (next) => {
              const trimmed = next.trim();
              if (!trimmed || trimmed === flow.name) return;
              renameM.mutate(trimmed);
            } : undefined}
            orgId={activeOrgId}
            steps={[...builtInSteps, ...customStepDefs]}
            controlCatalog={defaultControlCatalog}
            mcpCatalog={defaultMcpCatalog}
            onChange={(next) => { setGraph(next); setDirty(true); }}
            onSave={editable ? async (next) => { await saveM.mutateAsync(next); } : undefined}
            onValidate={async (next) => await validateFlowDefinition(next)}
            busy={saveM.isPending}
            status={flow.status}
            onPublish={editable ? onPublish : undefined}
            onUnpublish={editable ? onUnpublish : undefined}
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
