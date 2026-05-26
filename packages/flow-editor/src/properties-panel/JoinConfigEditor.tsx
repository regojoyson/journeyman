import type { WorkflowGraph, WorkflowNode, JoinMode } from "@journeyman/core";

interface Props {
  flow: WorkflowGraph;
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
}

interface DownstreamRow {
  ref: string;
  when: string;
}

interface ModeInfo {
  value: JoinMode;
  label: string;
  howItRuns: string;
  downstreamSees: DownstreamRow[];
  whenToUse: string;
}

const MODE_INFO: ModeInfo[] = [
  {
    value: "fail-fast",
    label: "Fail fast",
    howItRuns:
      "All branches run in parallel. If any branch fails, the workflow fails immediately and the other branches are cancelled. If all branches succeed, downstream runs.",
    downstreamSees: [
      { ref: "${branchNodeId.output.<field>}", when: "Always defined (all branches must succeed for downstream to run)" },
      { ref: "${joinId.output.*}", when: "Nothing — Join contributes no extra fields in this mode" },
    ],
    whenToUse: "Use when all branches must succeed and a single failure should abort the whole workflow.",
  },
  {
    value: "wait-all",
    label: "Wait for all",
    howItRuns:
      "All branches run to completion, even if some fail. Downstream runs after every branch has finished, regardless of which succeeded.",
    downstreamSees: [
      { ref: "${branchNodeId.output.<field>}", when: "Defined if that branch succeeded; undefined if it failed" },
      { ref: "${joinId.output.results}", when: "Full bag keyed by branch head node id, each { status, output, error? }" },
      { ref: "${joinId.output.results.<branchHeadId>.status}", when: 'Always defined — "success" | "error" | "cancelled"' },
    ],
    whenToUse: "Use when you want every branch's outcome (success or failure) and will react to it downstream.",
  },
  {
    value: "wait-all-strict",
    label: "Wait for all (strict)",
    howItRuns:
      "All branches run to completion. After the Join, if any branch failed, the workflow ends as failed and downstream does NOT run. Otherwise downstream runs normally.",
    downstreamSees: [
      { ref: "${branchNodeId.output.<field>}", when: "Always defined (downstream only runs if every branch succeeded)" },
      { ref: "${joinId.output.results}", when: "Full bag of branch results — all entries have status \"success\"" },
    ],
    whenToUse:
      "Use when each branch must complete (so partial state isn't lost), but any failure should still abort the rest of the workflow.",
  },
  {
    value: "first-wins",
    label: "First wins",
    howItRuns:
      "All branches start in parallel. The first branch to finish wins; the others are cancelled. v1 restriction: branches may contain only pause nodes (human-task, webhook-wait, timer).",
    downstreamSees: [
      { ref: "${joinId.output.winner}", when: "Always defined — the winning branch's head node id" },
      { ref: "${joinId.output.output.<field>}", when: "Always defined — the winner's output (whichever branch won)" },
      { ref: "${branchNodeId.output.<field>}", when: "Only defined if THIS branch won; undefined if it lost" },
      { ref: "${joinId.output.results}", when: "Contains only the winner's entry" },
    ],
    whenToUse: "Use when racing pauses (humans, webhooks, timers) and only the first response matters.",
  },
];

const MODE_INFO_BY_VALUE: Record<JoinMode, ModeInfo> =
  Object.fromEntries(MODE_INFO.map(m => [m.value, m])) as Record<JoinMode, ModeInfo>;

export function JoinConfigEditor({ flow, node, onChange, readOnly }: Props) {
  const cfg = (node.config ?? {}) as { mode?: JoinMode; description?: string };
  const mode: JoinMode = cfg.mode ?? "fail-fast";
  const info = MODE_INFO_BY_VALUE[mode];
  const incomingBranches = flow.edges.filter(e => e.target === node.id).length;

  const update = (patch: Partial<typeof cfg>) => onChange({ ...node, config: { ...cfg, ...patch } });

  return (
    <div className="je-tab je-tab--config">
      <div className="je-field">
        <label className="je-field__label">Mode</label>
        <select
          value={mode}
          disabled={readOnly}
          onChange={e => update({ mode: e.target.value as JoinMode })}
        >
          {MODE_INFO.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="je-join-mode-info">
        <div className="je-join-mode-info__section">
          <div className="je-join-mode-info__heading">How it runs</div>
          <p>{info.howItRuns}</p>
        </div>
        <div className="je-join-mode-info__section">
          <div className="je-join-mode-info__heading">Downstream sees</div>
          <table className="je-join-mode-info__table">
            <tbody>
              {info.downstreamSees.map(row => (
                <tr key={row.ref}>
                  <td><code>{row.ref}</code></td>
                  <td>{row.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="je-join-mode-info__section">
          <div className="je-join-mode-info__heading">When to use it</div>
          <p>{info.whenToUse}</p>
        </div>
      </div>

      {mode === "first-wins" && (
        <div className="je-field je-hint--warn">
          <strong>Branches can only contain things that wait:</strong> Human Task, Webhook Wait, or Timer.
          Regular steps aren't allowed here — the loser branches get cancelled mid-run, which could leave a step half-done.
          You'll see an error when you try to publish if any branch contains a step.
        </div>
      )}

      <div className="je-field">
        <label className="je-field__label">Description</label>
        <textarea
          rows={2}
          value={cfg.description ?? ""}
          disabled={readOnly}
          placeholder="What this join is waiting for."
          onChange={e => update({ description: e.target.value || undefined })}
        />
      </div>
      <div className="je-field">
        <label className="je-field__label">Incoming branches</label>
        <p className="je-hint">{incomingBranches} incoming branch{incomingBranches === 1 ? "" : "es"}.</p>
      </div>
      <div className="je-field">
        <label className="je-field__label">Output shape</label>
        <pre className="je-code-block">{outputShapeFor(mode)}</pre>
      </div>
    </div>
  );
}

function outputShapeFor(mode: JoinMode): string {
  if (mode === "fail-fast") return "// no Join-level output; reference branch nodes by id, e.g. stepA.field";
  if (mode === "first-wins") return JSON.stringify({ winner: "<branchHeadNodeId>", output: "<winning branch's last node output>" }, null, 2);
  return JSON.stringify({ results: { "<branchHeadNodeId>": { status: "success | error | cancelled", output: "<...>" } } }, null, 2);
}
