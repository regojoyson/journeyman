import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CreateFlowWizard, type CreateFlowArgs } from "@journeyman/flow-editor";
import { createFlow } from "../api/flows.ts";
import { useAuth } from "../AuthContext.tsx";

export function NewFlowPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { wsId = "" } = useParams<{ wsId: string }>();
  const { activeOrgId } = useAuth();

  const m = useMutation({
    mutationFn: (args: CreateFlowArgs) => createFlow(wsId, args),
    onSuccess: ({ workflow }, args) => {
      qc.invalidateQueries({ queryKey: ["flows"] });
      qc.setQueryData(["flow-graph", workflow.id], args.definition);
      navigate(`/workspaces/${wsId}/workflows/${workflow.id}/edit`);
    },
  });

  return (
    <CreateFlowWizard
      mode="create"
      orgId={activeOrgId || undefined}
      busy={m.isPending}
      error={m.isError ? (m.error as Error).message : null}
      onCreate={(args) => m.mutate(args)}
      onCancel={() => navigate(`/workspaces/${wsId}/workflows`)}
    />
  );
}
