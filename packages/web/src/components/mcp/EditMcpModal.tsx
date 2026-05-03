import { useState } from "react";
import { btnGhost, btnPrimary, card, codePill, inputCls } from "../../routes/admin-styles.ts";
import { mcpApi, type McpInstance } from "../../api/mcp.ts";
import { BindingsEditor, type Binding } from "./BindingsEditor.tsx";

export interface EditMcpModalProps {
  orgId: string;
  scope: "user" | "org";
  mcp: McpInstance;
  onClose: () => void;
  onSaved: () => void;
}

export function EditMcpModal(props: EditMcpModalProps) {
  const [description, setDescription] = useState(props.mcp.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(props.mcp.systemPrompt ?? "");
  const [command, setCommand] = useState(props.mcp.command ?? "");
  const [argsText, setArgsText] = useState((props.mcp.args ?? []).join("\n"));
  const [url, setUrl] = useState(props.mcp.url ?? "");
  const [bindings, setBindings] = useState<Binding[]>(props.mcp.bindings);
  const [enabled, setEnabled] = useState(props.mcp.enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const body: any = { description, systemPrompt, bindings, enabled };
    if (props.mcp.transport === "stdio") {
      body.command = command;
      body.args = argsText.split("\n").map((s) => s.trim()).filter(Boolean);
    } else {
      body.url = url;
    }
    try {
      if (props.scope === "user") await mcpApi.updateMy(props.orgId, props.mcp.id, body);
      else await mcpApi.updateOrg(props.orgId, props.mcp.id, body);
      props.onSaved();
      props.onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className={`${card} w-full max-w-xl max-h-[90vh] overflow-y-auto p-6`}>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">Edit MCP</h2>
        <div className="text-sm text-slate-400 mb-4">
          <code className={codePill}>{props.mcp.name}</code>
          <span className="ml-2">transport: <code className={codePill}>{props.mcp.transport}</code> (read-only)</span>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <input className={inputCls} placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} />
          <textarea className={inputCls} placeholder="System prompt" rows={3} value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} />

          {props.mcp.transport === "stdio" ? (
            <>
              <input className={inputCls} placeholder="Command" value={command} onChange={e => setCommand(e.target.value)} />
              <textarea className={inputCls} placeholder="Args (one per line)" rows={3} value={argsText} onChange={e => setArgsText(e.target.value)} />
            </>
          ) : (
            <input className={inputCls} placeholder="URL" value={url} onChange={e => setUrl(e.target.value)} />
          )}

          <div>
            <div className="text-sm text-slate-300 mb-2">Bindings</div>
            <BindingsEditor
              orgId={props.orgId}
              value={bindings}
              onChange={setBindings}
              scope={props.scope === "org" ? "org-and-global" : "all"}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            Enabled
          </label>

          {error && <div className="text-sm text-rose-400">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={props.onClose} className={btnGhost}>Cancel</button>
            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
