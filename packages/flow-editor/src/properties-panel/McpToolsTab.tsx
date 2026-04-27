import type { FlowNode, McpServerConfig } from "@journeyman/core";
import type { McpCatalog } from "../types.ts";

export interface McpToolsTabProps {
  node: FlowNode;
  catalog: McpCatalog;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

function getServers(node: FlowNode): McpServerConfig[] {
  const cfg = (node.config ?? {}) as { mcp?: McpServerConfig[] };
  return cfg.mcp ?? [];
}
function getAllowedTools(node: FlowNode): string[] {
  const cfg = (node.config ?? {}) as { allowedTools?: string[] };
  return cfg.allowedTools ?? [];
}
function setMcp(node: FlowNode, servers: McpServerConfig[]): FlowNode {
  return { ...node, config: { ...(node.config ?? {}), mcp: servers } };
}
function setAllowedTools(node: FlowNode, tools: string[]): FlowNode {
  return { ...node, config: { ...(node.config ?? {}), allowedTools: tools } };
}

export function McpToolsTab({ node, catalog, onChange, readOnly }: McpToolsTabProps) {
  const servers = getServers(node);
  const tools = getAllowedTools(node);
  const enabledIds = new Set(servers.map(s => s.id));

  const toggle = (id: string) => {
    const entry = catalog.find(e => e.id === id);
    if (!entry) return;
    if (enabledIds.has(id)) {
      onChange(setMcp(node, servers.filter(s => s.id !== id)));
    } else {
      const cfg: McpServerConfig = {
        id: entry.id, label: entry.label, source: entry.source, transport: entry.transport,
        command: entry.command, args: entry.args, url: entry.url,
      };
      onChange(setMcp(node, [...servers, cfg]));
    }
  };

  return (
    <div>
      <div className="je-props__field">
        <label>MCP servers</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {catalog.map(c => (
            <label
              key={c.id}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "#1f1f2c", border: `1px solid ${enabledIds.has(c.id) ? "#4a9eff" : "#2a2a3a"}`,
                borderRadius: 6, padding: "6px 8px", cursor: readOnly ? "not-allowed" : "pointer",
                opacity: readOnly ? 0.6 : 1,
              }}
              title={c.description ?? ""}
            >
              <input
                type="checkbox"
                checked={enabledIds.has(c.id)}
                disabled={readOnly}
                onChange={() => toggle(c.id)}
              />
              <span style={{ flex: 1 }}>{c.label}</span>
              <span style={{ fontSize: 10, color: "#888" }}>{c.transport}</span>
            </label>
          ))}
        </div>
        <div style={{ fontSize: 10, color: "#888", marginTop: 6 }}>
          User-supplied custom MCP servers will land in Phase 7 (per-user vault).
        </div>
      </div>

      <div className="je-props__field">
        <label>Allowed tools (one per line)</label>
        <textarea
          value={tools.join("\n")}
          disabled={readOnly}
          placeholder="Bash&#10;Read&#10;mcp__jira__*"
          onChange={e => onChange(setAllowedTools(node, e.target.value.split("\n").map(s => s.trim()).filter(Boolean)))}
        />
      </div>
    </div>
  );
}
