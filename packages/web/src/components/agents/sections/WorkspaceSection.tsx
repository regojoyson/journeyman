import { useEffect, useState } from "react";
import type { Agent, AgentUpdateInput, Connection, RepoSummary } from "@journeyman/core";
import { connectionsApi } from "../../../api/connections.ts";
import { CodingModelSelect } from "../../CodingModelSelect.tsx";
import { inputCls, btnGhost } from "../../../routes/admin-styles.ts";
import { SectionShell, FieldLabel } from "./SectionShell.tsx";

export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
  wsId: string;
}

export function WorkspaceSection({ a, patch, locked, wsId }: SectionProps) {
  const [gitConnections, setGitConnections] = useState<Connection[]>([]);
  const [repoConnectionId, setRepoConnectionId] = useState<string>(a.repoSelections[0]?.connectionId ?? "");
  const [browsedRepos, setBrowsedRepos] = useState<RepoSummary[] | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);

  useEffect(() => {
    connectionsApi.list(wsId, "git").then(setGitConnections).catch(() => setGitConnections([]));
  }, [wsId]);

  const addRepo = (fullName: string) => {
    if (a.repoSelections.some((r) => r.repo === fullName)) return;
    patch({
      repoSelections: [
        ...a.repoSelections,
        { repo: fullName, allowWrites: false, connectionId: repoConnectionId || undefined },
      ],
    });
  };

  const browse = async () => {
    setBrowseError(null);
    if (!repoConnectionId) {
      setBrowseError("Pick a git connection first");
      return;
    }
    try {
      const res = await connectionsApi.repos(wsId, repoConnectionId);
      if (res.error) setBrowseError(res.error);
      setBrowsedRepos(res.repos);
    } catch (e: any) {
      setBrowseError(e?.message ?? String(e));
    }
  };

  return (
    <SectionShell title="Workspace & Model" description="Where the agent runs and which model it uses.">
      <div>
        <FieldLabel>Provider</FieldLabel>
        <select
          className={inputCls}
          disabled={locked}
          value={a.provider}
          onChange={(e) => patch({ provider: e.target.value, model: undefined })}
        >
          <option value="claude">Claude</option>
          <option value="opencode">OpenCode</option>
          <option value="aisdk">AI-SDK</option>
        </select>
      </div>

      <div>
        <FieldLabel>Model</FieldLabel>
        <CodingModelSelect provider={a.provider} value={a.model} onChange={(m) => patch({ model: m })} disabled={locked} />
      </div>

      <div>
        <FieldLabel>Git connection</FieldLabel>
        <div className="flex gap-2">
          <select
            className={inputCls}
            disabled={locked}
            value={repoConnectionId}
            onChange={(e) => setRepoConnectionId(e.target.value)}
          >
            <option value="">— none (paste repos below) —</option>
            {gitConnections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.provider} · {c.label}
              </option>
            ))}
          </select>
          {!locked && (
            <button className={btnGhost} disabled={!repoConnectionId} onClick={browse}>
              Browse repos
            </button>
          )}
        </div>
        {browseError && <div className="mt-1 text-xs text-destructive">{browseError}</div>}
        {browsedRepos && (
          <div className="mt-2 max-h-40 overflow-y-auto border rounded-md p-2 space-y-1">
            {browsedRepos.map((r) => (
              <button
                key={r.fullName}
                className="block text-left text-sm hover:underline"
                disabled={locked}
                onClick={() => addRepo(r.fullName)}
              >
                + {r.fullName}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <FieldLabel>Repositories (one owner/repo or URL per line)</FieldLabel>
        <textarea
          className={`${inputCls} min-h-[100px]`}
          disabled={locked}
          value={a.repoSelections.map((r) => r.repo).join("\n")}
          onChange={(e) =>
            patch({
              repoSelections: e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((repo) => ({ repo, allowWrites: false, connectionId: repoConnectionId || undefined })),
            })
          }
        />
      </div>
    </SectionShell>
  );
}
