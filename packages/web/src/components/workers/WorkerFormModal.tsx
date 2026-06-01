import { useState } from "react";
import { btnGhost, btnPrimary, card, inputCls, selectCls } from "../../routes/admin-styles.ts";
import { workersApi, type Worker, type WorkerType, type WorkerUpsertBody } from "../../api/workers.ts";

export interface WorkerFormModalProps {
  orgId: string;
  scope: "user" | "org";
  /** Present ⇒ edit; absent ⇒ create. */
  worker?: Worker;
  onClose: () => void;
  onSaved: () => void;
}

type ConnKind = "local" | "remote";
type ImageKind = "ref" | "dockerfile";

function readDockerConfig(cfg: Record<string, unknown>) {
  const connection = (cfg.connection ?? { kind: "local" }) as { kind?: ConnKind; host?: string; socketPath?: string };
  const image = (cfg.image ?? { kind: "ref", imageRef: "" }) as
    { kind?: ImageKind; imageRef?: string; content?: string };
  return {
    connKind: (connection.kind ?? "local") as ConnKind,
    host: connection.host ?? "",
    socketPath: connection.socketPath ?? "",
    imageKind: (image.kind ?? "ref") as ImageKind,
    imageRef: image.imageRef ?? "",
    dockerfile: image.content ?? "",
    network: (cfg.network ?? "full") as "full" | "none",
  };
}

export function WorkerFormModal(props: WorkerFormModalProps) {
  const editing = Boolean(props.worker);
  const [name, setName] = useState(props.worker?.name ?? "");
  const [type, setType] = useState<WorkerType>(props.worker?.type ?? "local");
  const [isDefault, setIsDefault] = useState(props.worker?.isDefault ?? false);

  // local config
  const [baseDir, setBaseDir] = useState(String((props.worker?.config?.baseDir as string) ?? ""));
  const [retainWorkspace, setRetainWorkspace] = useState(Boolean(props.worker?.config?.retainWorkspace));

  // docker config
  const d = readDockerConfig(props.worker?.config ?? {});
  const [connKind, setConnKind] = useState<ConnKind>(d.connKind);
  const [host, setHost] = useState(d.host);
  const [socketPath, setSocketPath] = useState(d.socketPath);
  const [imageKind, setImageKind] = useState<ImageKind>(d.imageKind);
  const [imageRef, setImageRef] = useState(d.imageRef);
  const [dockerfile, setDockerfile] = useState(d.dockerfile);
  const [network, setNetwork] = useState<"full" | "none">(d.network);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildConfig(): Record<string, unknown> {
    if (type === "local") {
      return { ...(baseDir ? { baseDir } : {}), ...(retainWorkspace ? { retainWorkspace: true } : {}) };
    }
    // docker
    return {
      connection: connKind === "remote"
        ? { kind: "remote", host }
        : { kind: "local", ...(socketPath ? { socketPath } : {}) },
      image: imageKind === "ref" ? { kind: "ref", imageRef } : { kind: "dockerfile", content: dockerfile },
      network,
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: WorkerUpsertBody = {
      name,
      type,
      executionMode: type === "docker" ? "per-instance" : "shared",
      connectivity: type === "docker" ? "push" : null,
      config: buildConfig(),
      isDefault,
    };
    try {
      if (editing) {
        const patch: Partial<WorkerUpsertBody> = {
          name: body.name, executionMode: body.executionMode, connectivity: body.connectivity,
          config: body.config, isDefault: body.isDefault,
        };
        if (props.scope === "user") await workersApi.updateMy(props.orgId, props.worker!.id, patch);
        else await workersApi.updateOrg(props.orgId, props.worker!.id, patch);
      } else if (props.scope === "user") {
        await workersApi.createMy(props.orgId, body);
      } else {
        await workersApi.createOrg(props.orgId, body);
      }
      props.onSaved();
      props.onClose();
    } catch (e2) {
      setError((e2 as Error)?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className={`${card} w-full max-w-xl max-h-[90vh] overflow-y-auto p-6`}>
        <h2 className="text-lg font-semibold text-slate-100 mb-4">{editing ? "Edit worker" : "New worker"}</h2>
        <form onSubmit={submit} className="space-y-4">
          <input className={inputCls} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />

          <label className="block text-sm text-slate-300">
            Type
            <select className={`${selectCls} block mt-1`} value={type}
              disabled={editing} onChange={(e) => setType(e.target.value as WorkerType)}>
              <option value="local">Local (no isolation)</option>
              <option value="docker">Docker (per-instance)</option>
            </select>
          </label>

          {type === "local" && (
            <>
              <input className={inputCls} placeholder="Base folder (optional)" value={baseDir}
                onChange={(e) => setBaseDir(e.target.value)} />
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={retainWorkspace} onChange={(e) => setRetainWorkspace(e.target.checked)} />
                Keep workspace folder after the run
              </label>
            </>
          )}

          {type === "docker" && (
            <>
              <label className="block text-sm text-slate-300">
                Connection
                <select className={`${selectCls} block mt-1`} value={connKind}
                  onChange={(e) => setConnKind(e.target.value as ConnKind)}>
                  <option value="local">Local socket</option>
                  <option value="remote">Remote daemon</option>
                </select>
              </label>
              {connKind === "local" && (
                <input className={inputCls} placeholder="Socket path (optional — blank = host default / DOCKER_HOST)"
                  value={socketPath} onChange={(e) => setSocketPath(e.target.value)} />
              )}
              {connKind === "remote" && (
                <input className={inputCls} placeholder="tcp://host:2376" value={host}
                  onChange={(e) => setHost(e.target.value)} />
              )}

              <label className="block text-sm text-slate-300">
                Image
                <select className={`${selectCls} block mt-1`} value={imageKind}
                  onChange={(e) => setImageKind(e.target.value as ImageKind)}>
                  <option value="ref">Prebuilt image ref</option>
                  <option value="dockerfile">Dockerfile</option>
                </select>
              </label>
              {imageKind === "ref" ? (
                <input className={inputCls} placeholder="myorg/jm-runner:java21" value={imageRef}
                  onChange={(e) => setImageRef(e.target.value)} />
              ) : (
                <textarea className={inputCls} rows={6} placeholder="FROM ..." value={dockerfile}
                  onChange={(e) => setDockerfile(e.target.value)} />
              )}

              <label className="block text-sm text-slate-300">
                Network
                <select className={`${selectCls} block mt-1`} value={network}
                  onChange={(e) => setNetwork(e.target.value as "full" | "none")}>
                  <option value="full">Full (internet)</option>
                  <option value="none">None (offline)</option>
                </select>
              </label>
            </>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Set as default worker
          </label>

          {error && <div className="text-sm text-rose-400">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={props.onClose} className={btnGhost}>Cancel</button>
            <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
