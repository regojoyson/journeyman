import { useState } from "react";
import { btnGhost, btnPrimary, card, inputCls } from "../../routes/admin-styles.ts";
import { mcpApi, type McpTransport, type UpsertBody } from "../../api/mcp.ts";
import { BindingsEditor, type Binding } from "./BindingsEditor.tsx";

export interface AddCustomModalProps {
  wsId: string;
  onClose: () => void;
  onCreated: () => void;
}

export function AddCustomModal(props: AddCustomModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [transport, setTransport] = useState<McpTransport>("stdio");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [url, setUrl] = useState("");
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const body: UpsertBody = {
      name,
      description: description || undefined,
      transport,
      bindings,
      systemPrompt: systemPrompt || undefined,
    };
    if (transport === "stdio") {
      body.command = command;
      body.args = argsText.split("\n").map((s) => s.trim()).filter(Boolean);
    } else {
      body.url = url;
    }
    try {
      await mcpApi.create(props.wsId, body);
      props.onCreated();
      props.onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6">
      <div className={`${card} w-full max-w-xl max-h-[90vh] overflow-y-auto p-6`}>
        <h2 className="text-lg font-semibold text-slate-100 mb-4">Add custom MCP</h2>
        <form onSubmit={submit} className="space-y-4">
          <input className={inputCls} placeholder="Name" required value={name} onChange={e => setName(e.target.value)} />
          <input className={inputCls} placeholder="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} />
          <textarea className={inputCls} placeholder="System prompt (optional)" rows={3} value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} />

          <div className="flex gap-4 text-sm text-slate-300">
            {(["stdio", "http", "sse"] as McpTransport[]).map((t) => (
              <label key={t} className="flex items-center gap-2">
                <input type="radio" name="transport" checked={transport === t} onChange={() => setTransport(t)} />
                {t}
              </label>
            ))}
          </div>

          {transport === "stdio" ? (
            <>
              <input className={inputCls} placeholder="Command (e.g. npx)" required value={command} onChange={e => setCommand(e.target.value)} />
              <textarea className={inputCls} placeholder="Args (one per line)" rows={3} value={argsText} onChange={e => setArgsText(e.target.value)} />
            </>
          ) : (
            <input className={inputCls} placeholder="URL" required value={url} onChange={e => setUrl(e.target.value)} />
          )}

          <div>
            <div className="text-sm text-slate-300 mb-2">Bindings</div>
            <BindingsEditor
              orgId=""
              value={bindings}
              onChange={setBindings}
              scope="org-and-global"
            />
          </div>

          {error && <div className="text-sm text-danger">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={props.onClose} className={btnGhost}>Cancel</button>
            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? "Creating…" : "Create MCP"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
