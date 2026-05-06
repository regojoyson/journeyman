import { useEffect, useMemo, useState } from "react";
import type { CustomAiPhase, CanonicalTool } from "@journeyman/core";
import { toolsRequireWorkspace } from "@journeyman/core";
import { unsupportedTools, type ProviderId } from "@journeyman/coding-cli";
import { ToolsPicker } from "../components/custom-phases/ToolsPicker.tsx";

interface CustomAiNodeConfig {
  customPhaseId: string;
  provider?: ProviderId;
  mcpInstanceIds?: string[];
  skillIds?: string[];
  tools?: CanonicalTool[];
}

export function CustomAiNodeDrawer(props: {
  orgId: string;
  config: CustomAiNodeConfig;
  onChangeConfig: (next: CustomAiNodeConfig) => void;
}) {
  const { orgId, config } = props;
  const [phase, setPhase] = useState<CustomAiPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState<boolean>(config.tools !== undefined);

  useEffect(() => {
    if (!config.customPhaseId) return;
    let alive = true;
    fetch(`/api/orgs/${orgId}/users/me/custom-phases/${config.customPhaseId}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .catch(() =>
        fetch(`/api/orgs/${orgId}/custom-phases/${config.customPhaseId}`, { credentials: "include" })
          .then((r) => (r.ok ? r.json() : Promise.reject(r))),
      )
      .then((p) => { if (alive) setPhase(p as CustomAiPhase); })
      .catch((err) => { if (alive) setError(String(err)); });
    return () => { alive = false; };
  }, [orgId, config.customPhaseId]);

  const effectiveTools: CanonicalTool[] = useMemo(
    () => config.tools ?? phase?.defaultTools ?? [],
    [config.tools, phase?.defaultTools],
  );

  const effectiveProvider: ProviderId | undefined =
    (config.provider ?? (phase?.defaultProvider as ProviderId | undefined)) || undefined;

  const unsupported = useMemo(() => {
    if (!effectiveProvider) return new Set<CanonicalTool>();
    return new Set(unsupportedTools(effectiveProvider, effectiveTools));
  }, [effectiveProvider, effectiveTools]);

  if (error) return <div style={{ color: "red" }}>{error}</div>;
  if (!phase) return <div>Loading custom phase…</div>;

  const editHref = phase.scope === "user" ? "/me/custom-phases" : "/admin/custom-phases";
  const needsWs = toolsRequireWorkspace(effectiveTools);

  return (
    <div>
      <h3>{phase.name}</h3>
      <a href={editHref} target="_blank" rel="noreferrer">Edit definition →</a>

      <h4>Inputs</h4>
      {phase.inputFields.length === 0 && <p>(no inputs)</p>}
      {phase.inputFields.map((f) => (
        <div key={f.name} style={{ marginBottom: 8 }}>
          <label>
            {f.name} ({f.type}){f.required ? " *" : ""}
            {f.description ? <span style={{ color: "#666" }}> — {f.description}</span> : null}
          </label>
        </div>
      ))}
      {needsWs && (
        <p style={{ fontSize: 11, color: "#888" }}>
          Workspace tool selected — a <code>workspaceId</code> input must be wired.
        </p>
      )}

      <h4>Provider</h4>
      <select
        value={config.provider ?? ""}
        onChange={(e) =>
          props.onChangeConfig({
            ...config,
            provider: (e.target.value || undefined) as ProviderId | undefined,
          })
        }
      >
        <option value="">(default{phase.defaultProvider ? `: ${phase.defaultProvider}` : ""})</option>
        <option value="claude">Claude</option>
        <option value="gemini">Gemini</option>
        <option value="codex">Codex</option>
        <option value="opencode">OpenCode</option>
      </select>

      <h4>Tools</h4>
      <p style={{ fontSize: 12 }}>
        {config.tools === undefined
          ? <>Defaults from definition: <code>{phase.defaultTools.join(", ") || "(none)"}</code></>
          : <>Override: <code>{(config.tools).join(", ") || "(none)"}</code></>
        }
      </p>
      {!overrideOpen && (
        <button type="button" onClick={() => setOverrideOpen(true)}>
          {config.tools === undefined ? "Override…" : "Edit override…"}
        </button>
      )}
      {overrideOpen && (
        <div style={{ marginTop: 8 }}>
          <ToolsPicker
            value={effectiveTools}
            onChange={(next) => props.onChangeConfig({ ...config, tools: next })}
            unsupportedTools={unsupported}
          />
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => {
                const { tools: _t, ...rest } = config;
                props.onChangeConfig(rest);
                setOverrideOpen(false);
              }}
            >
              Use definition default
            </button>
            <button type="button" onClick={() => setOverrideOpen(false)}>Done</button>
          </div>
        </div>
      )}
      {unsupported.size > 0 && effectiveProvider && (
        <p style={{ color: "#c00", fontSize: 12 }}>
          Provider <code>{effectiveProvider}</code> does not support:{" "}
          <code>{Array.from(unsupported).join(", ")}</code>. Drop the tool or switch provider.
        </p>
      )}

      <h4>Output preview</h4>
      <pre style={{ background: "#f5f5f5", padding: 8, fontSize: 12 }}>
        {JSON.stringify(
          phase.outputMode === "structured"
            ? phase.outputSchema
            : phase.outputMode === "text"
              ? { result: "string" }
              : {},
          null,
          2,
        )}
      </pre>
    </div>
  );
}
