import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { Agent } from "@journeyman/core";
import { agentsApi } from "../api/agents.ts";
import { useWorkspace } from "../WorkspaceContext.tsx";
import { AgentDetail } from "../components/agents/AgentDetail.tsx";

export function AgentDetailPage() {
  const { wsId = "", agentId = "" } = useParams<{ wsId: string; agentId: string }>();
  const { workspaces, activeWorkspace } = useWorkspace();
  const orgId = workspaces.find((w) => w.id === wsId)?.orgId ?? activeWorkspace?.orgId ?? "";

  const [agent, setAgent] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!wsId || !agentId) return;
    agentsApi.get(wsId, agentId).then(setAgent).catch((e) => setError(e?.message ?? String(e)));
  }, [wsId, agentId]);

  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (!agent) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;

  return <AgentDetail wsId={wsId} orgId={orgId} initial={agent} />;
}
