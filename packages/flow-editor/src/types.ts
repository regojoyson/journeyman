import type { WorkflowGraph, WorkflowNodeType, WorkflowSaveWarning, WorkflowStatus, McpTransport, PublishError, WorkflowVersionSummary } from "@journeyman/core";
import type { StepDefinition, StepRunState } from "./step-definition.ts";
import type { UnpublishWarning } from "./topbar/UnpublishDialog.tsx";

export interface ControlNodeCatalogEntry {
  nodeType: WorkflowNodeType;
  label: string;
  category: string;
  description?: string;
  color: string;
  icon: string;
  /** When true, this control node is shown in the palette's collapsible
   *  "Coming soon" panel and cannot be dragged onto the canvas. */
  comingSoon?: boolean;
}
export type ControlNodeCatalog = ControlNodeCatalogEntry[];

export interface McpCatalogEntry {
  id: string;
  label: string;
  source: "builtin" | "provided";
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  requiredEnv?: string[];
  description?: string;
  /** Optional grouping/filter key for the catalog picker (e.g. "git", "tickets", "design"). */
  category?: string;
}
export type McpCatalog = McpCatalogEntry[];

export interface FlowEditorProps {
  flow: WorkflowGraph;
  flowName: string;
  /** Active org id of the caller — used to scope visible-secret lookups. */
  orgId: string;
  /** Active workspace id of the caller — used to scope custom-step lookups. */
  wsId: string;
  /** Built-in or extension step definitions, used to power the palette, properties panel, and canvas. */
  steps: StepDefinition<any>[];
  controlCatalog?: ControlNodeCatalog;
  mcpCatalog?: McpCatalog;
  /** Optional runtime status keyed by node id. When undefined, no status badge is rendered. */
  stepRunStates?: Record<string, StepRunState>;
  onChange: (flow: WorkflowGraph) => void;
  onSave?: (flow: WorkflowGraph) => void | Promise<void>;
  onRun?: (flow: WorkflowGraph) => void | Promise<void>;
  /** Non-destructive preflight check. Returns a structured report. */
  onValidate?: (flow: WorkflowGraph) => Promise<{
    ok: boolean;
    errors: string[];
    missing: string[];
    warnings: string[];
    secretWarnings?: WorkflowSaveWarning[];
  }>;
  readOnly?: boolean;
  busy?: boolean;
  onRename?: (newName: string) => void;
  /** Lifecycle status of the flow. When "ready", the editor renders read-only and the topbar shows "Move to Draft". */
  status?: WorkflowStatus;
  /** Called when the user confirms publish in the modal. Returns ok + any server-side errors. */
  onPublish?: () => Promise<{ ok: boolean; serverErrors?: PublishError[]; warnings?: PublishError[] }>;
  /**
   * Called when the user confirms unpublish (with confirm=true) or when the editor first attempts unpublish (confirm=false).
   * Returns the warning shape if the server demanded confirmation; null when the flip succeeded.
   */
  onUnpublish?: (confirm: boolean) => Promise<UnpublishWarning | null>;
  /** Promoted version history, newest-or-any order. When provided, the history toolbar button appears. */
  versions?: WorkflowVersionSummary[];
  /** Restore (rollback) the live pointer to an existing version. When provided, Restore buttons show. */
  onRollback?: (versionId: string) => void | Promise<void>;
  /** When false the steps palette is hidden. Pass capabilities.showPalette from the host. Defaults to true. */
  showPalette?: boolean;
  /** When provided, a Delete button appears in the topbar. Only pass when the caller's capabilities.canDelete is true. */
  onDelete?: () => void;
  /** When false the View JSON export button is hidden. Pass capabilities.canExport from the host. Defaults to true. */
  exportEnabled?: boolean;
}
