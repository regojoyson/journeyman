// packages/flow-editor/src/properties-panel/ConfigTab.tsx
import type { FlowNode } from "@journeyman/core";
import type { McpCatalog } from "../types.ts";
import { usePhaseRegistry } from "../state/phase-registry-context.tsx";
import { ExecutorBlock } from "./ExecutorBlock.tsx";
import { SchemaForm } from "./SchemaForm.tsx";
import { defaultProviderFor } from "../executor-common-config.ts";

export interface ConfigTabProps {
  node: FlowNode;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
  mcpCatalog?: McpCatalog;
}

export function ConfigTab({ node, onChange, readOnly, mcpCatalog }: ConfigTabProps) {
  const registry = usePhaseRegistry();
  const definition = registry.get(node.phaseType);
  const config = (node.config ?? {}) as Record<string, unknown>;
  const executorConfig = node.executorConfig ?? {};

  return (
    <div>
      <div className="je-props__field">
        <label>Phase type</label>
        <select
          value={node.phaseType ?? ""}
          disabled={readOnly}
          onChange={e => {
            const nextType = e.target.value;
            const nextDef = registry.get(nextType);
            const nextProvider = nextDef ? defaultProviderFor(nextDef.executor.kind) : undefined;
            onChange({
              ...node,
              phaseType: nextType,
              config: nextDef ? { ...(nextDef.defaultConfig as Record<string, unknown>) } : node.config,
              executorConfig: nextProvider ? { provider: nextProvider } : undefined,
            });
          }}
        >
          {registry.list().map(d => (
            <option key={d.phaseType} value={d.phaseType}>{d.label}</option>
          ))}
        </select>
      </div>

      <div className="je-props__field">
        <label>Display name</label>
        <input
          type="text"
          value={node.displayName ?? ""}
          disabled={readOnly}
          onChange={e => onChange({ ...node, displayName: e.target.value })}
        />
      </div>

      {definition && (
        <ExecutorBlock
          kind={definition.executor.kind}
          value={executorConfig}
          onChange={next => onChange({ ...node, executorConfig: next })}
          readOnly={readOnly}
        />
      )}

      {definition?.ConfigForm && (
        <definition.ConfigForm
          config={config as never}
          onChange={next => onChange({ ...node, config: next as Record<string, unknown> })}
          readOnly={readOnly}
          catalogs={{ mcp: mcpCatalog }}
        />
      )}

      {definition?.configFields && (
        <SchemaForm
          config={config}
          fields={definition.configFields}
          schema={definition.configSchema}
          onChange={next => onChange({ ...node, config: next })}
          readOnly={readOnly}
        />
      )}

      {definition?.description && (
        <div style={{ fontSize: 11, color: "#888", marginTop: 8 }}>{definition.description}</div>
      )}
    </div>
  );
}
