import { useEffect, useRef, useState } from "react";
import type { Agent, AgentUpdateInput, Connection, RepoSummary } from "@journeyman/core";
import { connectionsApi } from "../../../api/connections.ts";
import { CodingModelSelect } from "../../CodingModelSelect.tsx";
import { inputCls, btnSecondary } from "../../../routes/admin-styles.ts";
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
  const browseRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    connectionsApi.list(wsId, "git").then(setGitConnections).catch(() => setGitConnections([]));
  }, [wsId]);

  // Close the browsed-repos list on outside click or Escape.
  useEffect(() => {
    if (!browsedRepos) return;
    const onDown = (e: MouseEvent) => {
      if (browseRef.current && !browseRef.current.contains(e.target as Node)) setBrowsedRepos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBrowsedRepos(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [browsedRepos]);

  const addRepo = (fullName: string) => {
    if (a.repoSelections.some((r) => r.repo === fullName)) return;
    patch({
      repoSelections: [
        ...a.repoSelections,
        { repo: fullName, allowWrites: false, connectionId: repoConnectionId || undefined },
      ],
    });
  };

  const removeRepo = (fullName: string) => {
    patch({ repoSelections: a.repoSelections.filter((r) => r.repo !== fullName) });
  };

  const browse = async () => {
    if (browsedRepos) {
      setBrowsedRepos(null);
      return;
    }
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

      <div ref={browseRef}>
        <FieldLabel>Git connection</FieldLabel>
        <div className="flex gap-2">
          <select
            className={inputCls}
            disabled={locked}
            value={repoConnectionId}
            onChange={(e) => setRepoConnectionId(e.target.value)}
          >
            <option value="">— select a connection —</option>
            {gitConnections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.provider} · {c.label}
              </option>
            ))}
          </select>
          {!locked && (
            <button className={btnSecondary} disabled={!repoConnectionId} onClick={browse}>
              {browsedRepos ? "Hide" : "Browse repos"}
            </button>
          )}
        </div>
        {browseError && <div className="mt-1 text-xs text-destructive">{browseError}</div>}
        {browsedRepos && (
          <div className="mt-2 rounded-md border bg-card">
            <div className="flex items-center justify-between border-b px-3 py-1.5">
              <span className="text-xs text-muted-foreground">
                {browsedRepos.length} {browsedRepos.length === 1 ? "repository" : "repositories"}
              </span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close repository list"
                onClick={() => setBrowsedRepos(null)}
              >
                ×
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto divide-y">
              {browsedRepos.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted-foreground">No repositories found.</div>
              )}
              {browsedRepos.map((r) => {
                const added = a.repoSelections.some((s) => s.repo === r.fullName);
                return (
                  <button
                    key={r.fullName}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={locked || added}
                    onClick={() => addRepo(r.fullName)}
                  >
                    <span className="truncate">{r.fullName}</span>
                    <span className={`shrink-0 text-xs ${added ? "text-muted-foreground" : "text-primary"}`}>
                      {added ? "Added" : "+ Add"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div>
        <FieldLabel>Selected repositories</FieldLabel>
        {a.repoSelections.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {repoConnectionId
              ? "Use “Browse repos” above to add repositories."
              : "Select a git connection, then use “Browse repos” to add repositories."}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {a.repoSelections.map((r) => (
              <span
                key={r.repo}
                className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-sm"
              >
                {r.repo}
                {!locked && (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${r.repo}`}
                    onClick={() => removeRepo(r.repo)}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </SectionShell>
  );
}
