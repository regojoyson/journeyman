import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CreateFlowWizard, type CreateFlowArgs } from "@journeyman/flow-editor";
import { createFlow } from "../api/flows.ts";
import { useAuth } from "../AuthContext.tsx";

export function NewFlowPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { role, isPlatformAdmin } = useAuth();

  const allowedScopes: ("user" | "org" | "global")[] = [
    "user",
    ...(role === "admin" || isPlatformAdmin ? (["org"] as const) : []),
    ...(isPlatformAdmin ? (["global"] as const) : []),
  ];

  const m = useMutation({
    mutationFn: (args: CreateFlowArgs) => createFlow(args),
    onSuccess: ({ workflow }, args) => {
      qc.invalidateQueries({ queryKey: ["flows"] });
      qc.setQueryData(["flow-graph", workflow.id], args.definition);
      navigate(`/workflows/${workflow.id}/edit`);
    },
  });

  return (
    <CreateFlowWizard
      mode="create"
      allowedScopes={allowedScopes}
      busy={m.isPending}
      error={m.isError ? (m.error as Error).message : null}
      onCreate={(args) => m.mutate(args)}
      onCancel={() => navigate("/workflows")}
    />
  );
}
