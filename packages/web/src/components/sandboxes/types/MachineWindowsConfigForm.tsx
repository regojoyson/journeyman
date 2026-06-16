import type { FC } from "react";
import { Server, Network, KeyRound, FolderOpen } from "lucide-react";
import { inputCls } from "../../../routes/admin-styles.ts";
import { Field, Code } from "./form-controls.tsx";
import type { SandboxTypeForm } from "./LocalConfigForm.tsx";

interface WinState { host: string; port: string; certDir: string; workspaceRoot: string }

const MachineWindowsConfigForm: FC<{ state: Record<string, unknown>; onChange: (s: Record<string, unknown>) => void; editing: boolean }> =
  ({ state, onChange }) => {
    const s = state as unknown as WinState;
    const set = (patch: Partial<WinState>) => onChange({ ...s, ...patch } as unknown as Record<string, unknown>);
    return (
      <>
        <Field icon={Server} label="Agent host"
          hint={<>Hostname/IP of the Windows box running <Code>journeyman-agent</Code>. Must be reachable from the orchestrator.</>}>
          <input className={inputCls} placeholder="win-box.internal" value={s.host} onChange={(e) => set({ host: e.target.value })} />
        </Field>
        <Field icon={Network} label="Agent port" hint={<>The agent's gRPC port (default <Code>50051</Code>). Open it in the box's firewall.</>}>
          <input className={inputCls} placeholder="50051" value={s.port} onChange={(e) => set({ port: e.target.value })} />
        </Field>
        <Field icon={KeyRound} label="mTLS cert folder"
          hint={<>Folder on the orchestrator host with <Code>ca.pem</Code>, <Code>client.pem</Code>, <Code>client-key.pem</Code>.</>}>
          <input className={inputCls} placeholder="/etc/journeyman/win-certs" value={s.certDir} onChange={(e) => set({ certDir: e.target.value })} />
        </Field>
        <Field icon={FolderOpen} label="Workspace root (optional)"
          hint={<>Where per-run folders are created on the box. Blank = <Code>C:\jm-runs</Code>.</>}>
          <input className={inputCls} placeholder="C:\jm-runs" value={s.workspaceRoot} onChange={(e) => set({ workspaceRoot: e.target.value })} />
        </Field>
        <p className="text-xs text-zinc-500 mt-1">
          Prerequisites on the box: Node 22, Git for Windows, the agent + runner, certs, an open firewall port.
          Supported AI providers: Claude and OpenCode (AISDK is not supported on Windows).
        </p>
      </>
    );
  };

export const machineWindowsTypeForm: SandboxTypeForm = {
  icon: Server,
  readConfig: (raw) => {
    const conn = (raw.connection ?? {}) as { host?: string; port?: number; certDir?: string };
    return {
      host: String(conn.host ?? ""), port: String(conn.port ?? "50051"),
      certDir: String(conn.certDir ?? ""), workspaceRoot: String((raw.workspaceRoot as string) ?? ""),
    };
  },
  buildConfig: (state) => {
    const s = state as unknown as WinState;
    return {
      connection: { host: s.host, port: Number(s.port) || 50051, certDir: s.certDir },
      ...(s.workspaceRoot ? { workspaceRoot: s.workspaceRoot } : {}),
    };
  },
  validate: (state) => {
    const s = state as unknown as WinState;
    if (!s.host?.trim()) return "Agent host is required";
    if (!s.certDir?.trim()) return "mTLS cert folder is required";
    if (!(Number(s.port) > 0)) return "Agent port must be a number";
    return null;
  },
  ConfigForm: MachineWindowsConfigForm,
  testConnection: true,
};
