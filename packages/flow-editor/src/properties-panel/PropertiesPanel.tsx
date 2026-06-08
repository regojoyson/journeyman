// packages/flow-editor/src/properties-panel/PropertiesPanel.tsx
import { useState } from "react";
import type { WorkflowGraph, WorkflowNode } from "@journeyman/core";

function NodeIdButton({ id }: { id: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const onClick = (): void => {
    try {
      void navigator.clipboard?.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard unavailable (insecure context). Falls back to selectable text.
    }
  };
  return (
    <button
      type="button"
      className={`je-props__id${copied ? " je-props__id--copied" : ""}`}
      onClick={onClick}
      title="Click to copy node ID"
    >
      {copied ? "Copied" : id}
    </button>
  );
}

function PanelHeader({
  node, onClose,
}: { node: { id: string; type: string; displayName?: string }; onClose?: () => void }): JSX.Element {
  return (
    <div className="je-props__header">
      <div className="je-props__title-block">
        <div className="je-props__title">{node.displayName ?? node.type}</div>
        <NodeIdButton id={node.id} />
      </div>
      {onClose ? (
        <button type="button" className="je-props__close" onClick={onClose} aria-label="Close">×</button>
      ) : null}
    </div>
  );
}

function EndNodeConfig({ node, onChange, readOnly }: { node: WorkflowNode; onChange: (next: WorkflowNode) => void; readOnly?: boolean }) {
  return (
    <div>
      <div className="je-props__field">
        <label>Display name</label>
        <input
          type="text"
          value={node.displayName ?? ""}
          disabled={readOnly}
          placeholder="End"
          onChange={e => onChange({ ...node, displayName: e.target.value })}
        />
      </div>
      <div className="je-props__field">
        <label>Outcome label</label>
        <input
          type="text"
          value={node.outcome ?? ""}
          disabled={readOnly}
          placeholder="success"
          onChange={e => onChange({ ...node, outcome: e.target.value })}
        />
        <div className="je-props__field-help">
          Surfaced as the run's outcome when this end node is reached. Examples: <code>success</code>, <code>failed</code>, <code>cancelled</code>, <code>code-rejected</code>. Multiple end nodes per flow are allowed; the first one reached wins.
        </div>
      </div>
    </div>
  );
}

import type { McpCatalog } from "../types.ts";
import { TabsShell, type TabId, type TabsVisibility } from "./tabs-shell.tsx";
import { ConfigTab } from "./ConfigTab.tsx";
import { McpToolsTab } from "./McpToolsTab.tsx";
import { SandboxTab } from "./SandboxTab.tsx";
import { SkillsTab } from "./SkillsTab.tsx";
import { RequiredSecretsTab } from "./RequiredSecretsTab.tsx";
import { RetryTab } from "./RetryTab.tsx";
import { IoTab } from "./IoTab.tsx";
import { FlowSettingsView } from "./FlowSettingsView.tsx";
import { ControlNodeConfigTab } from "./ControlNodeConfigTab.tsx";
import { TriggerManualPanel } from "./trigger-manual-panel.tsx";
import { TriggerWebhookPanel } from "./trigger-webhook-panel.tsx";
import { TriggerHumanPanel } from "./trigger-human-panel.tsx";
import { useWebhooksForPicker } from "./useWebhooksForPicker.ts";
import { useStepRegistry } from "../state/step-registry-context.tsx";
import type { TriggerWebhookConfig } from "@journeyman/core";

// FlowSettingsView is retained for back-compat but no longer the trigger router.
void FlowSettingsView;

function TriggerWebhookPanelWrapper(props: {
  node: WorkflowNode;
  graph: WorkflowGraph;
  onPatchConfig: (patch: Partial<TriggerWebhookConfig>) => void;
  readOnly?: boolean;
}): JSX.Element {
  const { webhooks } = useWebhooksForPicker();
  return (
    <TriggerWebhookPanel
      node={props.node}
      graph={props.graph}
      webhooks={webhooks.map((w) => ({
        id: w.id,
        name: w.name,
        knownEventTypes: w.knownEventTypes,
        payloadSchema: w.payloadSchema,
      }))}
      onPatchConfig={props.onPatchConfig}
      readOnly={props.readOnly}
    />
  );
}

export interface PropertiesPanelProps {
  flow: WorkflowGraph;
  node: WorkflowNode | null;
  mcpCatalog: McpCatalog;
  orgId: string;
  onChange: (next: WorkflowNode) => void;
  /** Optional — when provided, a close button is rendered in the panel header. */
  onClose?: () => void;
  readOnly?: boolean;
}

const DEFAULT_VISIBILITY: TabsVisibility = {
  io:              "shown",
  requiredSecrets: "shown",
  mcp:             "shown",
  skills:          "hidden",
  retry:           "shown",
  worker:          "shown",
};

export function PropertiesPanel(props: PropertiesPanelProps) {
  const { flow, node, mcpCatalog, orgId, onChange, onClose, readOnly } = props;
  const registry = useStepRegistry();
  const [active, setActive] = useState<TabId>("config");

  if (!node) {
    return (
      <aside className="je-editor__props">
        <div className="je-empty">Select a node to configure it.</div>
      </aside>
    );
  }

  if (node.type === "trigger-manual" || node.type === "trigger-webhook" || node.type === "trigger-human") {
    const patchCfg = (patch: object): void => {
      const nextCfg = { ...(node.config ?? {}), ...patch } as Record<string, unknown>;
      onChange({ ...node, config: nextCfg });
    };
    return (
      <aside className="je-editor__props">
        <PanelHeader node={node} onClose={onClose} />
        {node.type === "trigger-manual" ? (
          <TriggerManualPanel node={node} graph={flow} />
        ) : node.type === "trigger-webhook" ? (
          <TriggerWebhookPanelWrapper
            node={node}
            graph={flow}
            onPatchConfig={(p) => { if (!readOnly) patchCfg(p); }}
            readOnly={readOnly}
          />
        ) : (
          <TriggerHumanPanel
            node={node}
            graph={flow}
            onPatchConfig={(p) => { if (!readOnly) patchCfg(p); }}
          />
        )}
      </aside>
    );
  }

  const isStep = node.type === "step";
  const definition = isStep ? registry.get(node.stepType) : undefined;
  const visibility: TabsVisibility = definition
    ? {
        io: definition.tabs.io,
        requiredSecrets: definition.tabs.requiredSecrets ?? "shown",
        mcp: definition.tabs.mcp,
        skills: definition.tabs.skills ?? "hidden",
        retry: definition.tabs.retry,
      }
    : DEFAULT_VISIBILITY;

  // "required + empty" indicators
  const requiredEmpty = {
    io: !((node as { inputs?: unknown[] }).inputs?.length || (node as { outputs?: unknown[] }).outputs?.length),
    requiredSecrets: !(node.secretBindings && Object.keys(node.secretBindings).length),
    mcp: !(((node.config as { mcpInstanceIds?: unknown[] } | undefined)?.mcpInstanceIds?.length ?? 0) > 0),
    skills: !(((node.config as { skillPackageIds?: unknown[] } | undefined)?.skillPackageIds?.length ?? 0) > 0),
    retry: !node.retry,
  };

  // If the active tab gets hidden due to definition change, fall back to config.
  const effectiveActive: TabId =
    active !== "config" && visibility[active] === "hidden" ? "config" : active;

  return (
    <aside className="je-editor__props">
      <PanelHeader node={node} onClose={onClose} />
      {isStep ? (
        <TabsShell
          active={effectiveActive}
          onChange={setActive}
          visibility={visibility}
          requiredEmpty={requiredEmpty}
        >
          {effectiveActive === "config"          && <ConfigTab          flow={flow} node={node} onChange={onChange} readOnly={readOnly} mcpCatalog={mcpCatalog} flowDefaults={flow.defaults} />}
          {effectiveActive === "mcp"             && <McpToolsTab        node={node} orgId={orgId} onChange={onChange} readOnly={readOnly} />}
          {effectiveActive === "skills"          && <SkillsTab          node={node} orgId={orgId} onChange={onChange} readOnly={readOnly} />}
          {effectiveActive === "requiredSecrets" && <RequiredSecretsTab flow={flow} node={node} orgId={orgId} onChange={onChange} readOnly={readOnly} />}
          {effectiveActive === "retry"           && <RetryTab           node={node} onChange={onChange} readOnly={readOnly} flowDefaults={flow.defaults} />}
          {effectiveActive === "worker"          && <SandboxTab          node={node} orgId={orgId} onChange={onChange} readOnly={readOnly} />}
          {effectiveActive === "io"              && <IoTab              flow={flow} node={node} onChange={onChange} readOnly={readOnly} />}
        </TabsShell>
      ) : node.type === "loop" || node.type === "timer" || node.type === "human-task" || node.type === "webhook-wait" || node.type === "gateway-and" || node.type === "join" ? (
        <ControlNodeConfigTab flow={flow} node={node} onChange={onChange} readOnly={readOnly} />
      ) : node.type === "end" ? (
        <EndNodeConfig node={node} onChange={onChange} readOnly={readOnly} />
      ) : (
        <div className="je-empty">Control nodes have no per-tab config in v0.</div>
      )}
    </aside>
  );
}
