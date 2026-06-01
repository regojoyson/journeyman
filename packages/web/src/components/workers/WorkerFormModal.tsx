import { useState, type ReactNode } from "react";
import {
  Info, Tag, Server, FolderOpen, Archive, Plug, Terminal, Globe,
  Box, FileText, Network, Star, type LucideIcon,
} from "lucide-react";
import { btnGhost, btnPrimary, card, codePill, inputCls, selectCls } from "../../routes/admin-styles.ts";
import { workersApi, type Worker, type WorkerType, type WorkerUpsertBody } from "../../api/workers.ts";

/** Inline code/example chip. */
function Code({ children }: { children: ReactNode }) {
  return <code className={codePill}>{children}</code>;
}

/** Labeled field: icon + label on top, control, then a muted hint line. */
function Field({ icon: Icon, label, hint, children }: {
  icon: LucideIcon; label: string; hint?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-200">
        <Icon size={14} className="text-indigo-400 shrink-0" aria-hidden />
        {label}
      </div>
      {children}
      {hint && <p className="text-xs leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}

/** Checkbox row with an icon, label, and hint underneath. */
function CheckField({ icon: Icon, label, hint, checked, onChange }: {
  icon: LucideIcon; label: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <Icon size={14} className="text-indigo-400 shrink-0" aria-hidden />
        {label}
      </label>
      {hint && <p className="ml-6 text-xs leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}

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
        <h2 className="text-lg font-semibold text-slate-100 mb-1">{editing ? "Edit worker" : "New worker"}</h2>
        <div className="flex gap-2 rounded-lg border border-indigo-900/40 bg-indigo-950/30 p-3 mb-4 text-xs leading-relaxed text-slate-300">
          <Info size={16} className="mt-0.5 shrink-0 text-indigo-400" aria-hidden />
          <span>
            A <b>worker</b> is where a workflow's steps actually run. <b>Local</b> runs in-process on this
            host with a shared workspace (fast, no isolation). <b>Docker</b> gives every run its own
            throwaway container (isolated, reproducible).
          </span>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field icon={Tag} label="Name"
            hint={<>A label you'll recognize in the worker picker. e.g. <Code>Local Docker</Code> or <Code>EU build host</Code>.</>}>
            <input className={inputCls} placeholder="Local Docker" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <Field icon={Server} label="Type"
            hint={type === "local"
              ? <>Steps run in the API/worker process on this machine — no container. Best for quick local dev.</>
              : <>Each run gets its own container and volume, torn down afterward. Best for isolation and clean, reproducible environments.</>}>
            <select className={`${selectCls} block mt-1 w-full`} value={type}
              disabled={editing} onChange={(e) => setType(e.target.value as WorkerType)}>
              <option value="local">Local (no isolation)</option>
              <option value="docker">Docker (per-instance)</option>
            </select>
          </Field>

          {type === "local" && (
            <>
              <Field icon={FolderOpen} label="Base folder"
                hint={<>Parent directory where each run's workspace is created. Blank = system temp dir. e.g. <Code>/Users/me/jm-workspaces</Code>.</>}>
                <input className={inputCls} placeholder="(optional — defaults to a temp dir)" value={baseDir}
                  onChange={(e) => setBaseDir(e.target.value)} />
              </Field>
              <CheckField icon={Archive} label="Keep workspace folder after the run"
                hint={<>Leaves the cloned repo and edits on disk for debugging. Off = the folder is cleaned up when the run ends.</>}
                checked={retainWorkspace} onChange={setRetainWorkspace} />
            </>
          )}

          {type === "docker" && (
            <>
              <Field icon={Plug} label="Connection"
                hint={connKind === "local"
                  ? <>Talk to the Docker daemon on this machine via its Unix socket.</>
                  : <>Connect to a remote Docker daemon over TCP (optionally TLS).</>}>
                <select className={`${selectCls} block mt-1 w-full`} value={connKind}
                  onChange={(e) => setConnKind(e.target.value as ConnKind)}>
                  <option value="local">Local socket</option>
                  <option value="remote">Remote daemon</option>
                </select>
              </Field>
              {connKind === "local" && (
                <Field icon={Terminal} label="Socket path"
                  hint={<>Blank = host default / <Code>DOCKER_HOST</Code>. Docker Desktop usually needs nothing.
                    Rancher Desktop: <Code>~/.rd/docker.sock</Code> · Colima: <Code>~/.colima/default/docker.sock</Code>.
                    The <Code>unix://</Code> prefix is optional — it's stripped automatically.</>}>
                  <input className={inputCls} placeholder="/Users/you/.rd/docker.sock"
                    value={socketPath} onChange={(e) => setSocketPath(e.target.value)} />
                </Field>
              )}
              {connKind === "remote" && (
                <Field icon={Globe} label="Daemon host"
                  hint={<>Address of the remote daemon, e.g. <Code>tcp://build-host:2376</Code>. TLS certs (if any) are read from the configured cert dir.</>}>
                  <input className={inputCls} placeholder="tcp://build-host:2376" value={host}
                    onChange={(e) => setHost(e.target.value)} />
                </Field>
              )}

              <Field icon={Box} label="Image source"
                hint={imageKind === "ref"
                  ? <>Pull a ready-made runner image from a registry.</>
                  : <>Build the image from a Dockerfile snippet (built &amp; cached on first run; the runner bundle — git/ssh/certs — is auto-added).</>}>
                <select className={`${selectCls} block mt-1 w-full`} value={imageKind}
                  onChange={(e) => setImageKind(e.target.value as ImageKind)}>
                  <option value="ref">Prebuilt image ref</option>
                  <option value="dockerfile">Dockerfile</option>
                </select>
              </Field>
              {imageKind === "ref" ? (
                <Field icon={Box} label="Image reference"
                  hint={<>Registry image and tag. e.g. <Code>node:22-bookworm</Code>, <Code>python:3.12-slim</Code>, or <Code>myorg/jm-runner:java21</Code>.</>}>
                  <input className={inputCls} placeholder="myorg/jm-runner:java21" value={imageRef}
                    onChange={(e) => setImageRef(e.target.value)} />
                </Field>
              ) : (
                <Field icon={FileText} label="Dockerfile"
                  hint={<>Standard Dockerfile. Start from a base that has the toolchain your steps need, e.g. <Code>FROM node:22-bookworm</Code>.</>}>
                  <textarea className={inputCls} rows={6} placeholder={"FROM debian:stable-slim\nRUN apt-get update && apt-get install -y python3"}
                    value={dockerfile} onChange={(e) => setDockerfile(e.target.value)} />
                </Field>
              )}

              <Field icon={Network} label="Network"
                hint={network === "full"
                  ? <>Container can reach the internet — needed for <Code>git clone</Code>, <Code>npm install</Code>, API calls, etc.</>
                  : <>No network at all. Use for untrusted code or fully offline, pre-provisioned runs.</>}>
                <select className={`${selectCls} block mt-1 w-full`} value={network}
                  onChange={(e) => setNetwork(e.target.value as "full" | "none")}>
                  <option value="full">Full (internet)</option>
                  <option value="none">None (offline)</option>
                </select>
              </Field>
            </>
          )}

          <CheckField icon={Star} label="Set as default worker"
            hint={<>New workflows run on this worker unless they pick a different one. Only one default applies per scope.</>}
            checked={isDefault} onChange={setIsDefault} />

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
