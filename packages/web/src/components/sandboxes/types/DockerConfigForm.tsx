import type { FC } from "react";
import { Plug, Terminal, Globe, Box, FileText, Network } from "lucide-react";
import { inputCls, selectCls } from "../../../routes/admin-styles.ts";
import { Field, Code } from "./form-controls.tsx";
import type { ComputeTargetTypeForm } from "./LocalConfigForm.tsx";

type ConnKind = "local" | "remote";
type ImageKind = "ref" | "dockerfile";

interface DockerState {
  connKind: ConnKind; host: string; socketPath: string;
  imageKind: ImageKind; imageRef: string; dockerfile: string;
  network: "full" | "none";
}

const DockerConfigForm: FC<{ state: Record<string, unknown>; onChange: (s: Record<string, unknown>) => void; editing: boolean }> =
  ({ state, onChange }) => {
    const s = state as unknown as DockerState;
    const set = (patch: Partial<DockerState>) => onChange({ ...s, ...patch } as unknown as Record<string, unknown>);
    return (
      <>
        <Field icon={Plug} label="Connection"
          hint={s.connKind === "local"
            ? <>Talk to the Docker daemon on this machine via its Unix socket.</>
            : <>Connect to a remote Docker daemon over TCP (optionally TLS).</>}>
          <select className={`${selectCls} block mt-1 w-full`} value={s.connKind}
            onChange={(e) => set({ connKind: e.target.value as ConnKind })}>
            <option value="local">Local socket</option>
            <option value="remote">Remote daemon</option>
          </select>
        </Field>
        {s.connKind === "local" && (
          <Field icon={Terminal} label="Socket path"
            hint={<>Blank = host default / <Code>DOCKER_HOST</Code>. Rancher Desktop: <Code>~/.rd/docker.sock</Code> ·
              Colima: <Code>~/.colima/default/docker.sock</Code>. The <Code>unix://</Code> prefix is optional.</>}>
            <input className={inputCls} placeholder="/Users/you/.rd/docker.sock" value={s.socketPath}
              onChange={(e) => set({ socketPath: e.target.value })} />
          </Field>
        )}
        {s.connKind === "remote" && (
          <Field icon={Globe} label="Daemon host"
            hint={<>Address of the remote daemon, e.g. <Code>tcp://build-host:2376</Code>.</>}>
            <input className={inputCls} placeholder="tcp://build-host:2376" value={s.host}
              onChange={(e) => set({ host: e.target.value })} />
          </Field>
        )}
        <Field icon={Box} label="Image source"
          hint={s.imageKind === "ref"
            ? <>Pull a ready-made runner image from a registry.</>
            : <>Build from a Dockerfile snippet (cached on first run; the runner bundle is auto-added).</>}>
          <select className={`${selectCls} block mt-1 w-full`} value={s.imageKind}
            onChange={(e) => set({ imageKind: e.target.value as ImageKind })}>
            <option value="ref">Prebuilt image ref</option>
            <option value="dockerfile">Dockerfile</option>
          </select>
        </Field>
        {s.imageKind === "ref" ? (
          <Field icon={Box} label="Image reference"
            hint={<>e.g. <Code>node:22-bookworm</Code>, <Code>python:3.12-slim</Code>, or <Code>myorg/jm-runner:java21</Code>.</>}>
            <input className={inputCls} placeholder="myorg/jm-runner:java21" value={s.imageRef}
              onChange={(e) => set({ imageRef: e.target.value })} />
          </Field>
        ) : (
          <Field icon={FileText} label="Dockerfile"
            hint={<>Standard Dockerfile. Start from a base with your toolchain, e.g. <Code>FROM node:22-bookworm</Code>.</>}>
            <textarea className={inputCls} rows={6} placeholder={"FROM debian:stable-slim\nRUN apt-get update && apt-get install -y python3"}
              value={s.dockerfile} onChange={(e) => set({ dockerfile: e.target.value })} />
          </Field>
        )}
        <Field icon={Network} label="Network"
          hint={s.network === "full"
            ? <>Container can reach the internet — needed for <Code>git clone</Code>, <Code>npm install</Code>, API calls.</>
            : <>No network at all. Use for untrusted code or fully offline runs.</>}>
          <select className={`${selectCls} block mt-1 w-full`} value={s.network}
            onChange={(e) => set({ network: e.target.value as "full" | "none" })}>
            <option value="full">Full (internet)</option>
            <option value="none">None (offline)</option>
          </select>
        </Field>
      </>
    );
  };

export const dockerTypeForm: ComputeTargetTypeForm = {
  icon: Box,
  testConnection: true,
  readConfig: (raw) => {
    const connection = (raw.connection ?? { kind: "local" }) as { kind?: ConnKind; host?: string; socketPath?: string };
    const image = (raw.image ?? { kind: "ref", imageRef: "" }) as { kind?: ImageKind; imageRef?: string; content?: string };
    return {
      connKind: (connection.kind ?? "local"),
      host: connection.host ?? "",
      socketPath: connection.socketPath ?? "",
      imageKind: (image.kind ?? "ref"),
      imageRef: image.imageRef ?? "",
      dockerfile: image.content ?? "",
      network: (raw.network ?? "full"),
    };
  },
  buildConfig: (state) => {
    const s = state as unknown as DockerState;
    return {
      connection: s.connKind === "remote"
        ? { kind: "remote", host: s.host }
        : { kind: "local", ...(s.socketPath ? { socketPath: s.socketPath } : {}) },
      image: s.imageKind === "ref" ? { kind: "ref", imageRef: s.imageRef } : { kind: "dockerfile", content: s.dockerfile },
      network: s.network,
    };
  },
  ConfigForm: DockerConfigForm,
};
