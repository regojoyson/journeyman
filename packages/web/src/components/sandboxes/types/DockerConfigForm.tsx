import type { FC } from "react";
import { Globe, Box, FileText, Network } from "lucide-react";
import { inputCls, selectCls } from "../../../routes/admin-styles.ts";
import { Field, Code } from "./form-controls.tsx";
import type { SandboxTypeForm } from "./LocalConfigForm.tsx";

type ImageKind = "ref" | "dockerfile";

interface DockerState {
  host: string;
  imageKind: ImageKind; imageRef: string; dockerfile: string;
  network: "full" | "none";
}

const DockerConfigForm: FC<{ state: Record<string, unknown>; onChange: (s: Record<string, unknown>) => void; editing: boolean }> =
  ({ state, onChange }) => {
    const s = state as unknown as DockerState;
    const set = (patch: Partial<DockerState>) => onChange({ ...s, ...patch } as unknown as Record<string, unknown>);
    return (
      <>
        <Field icon={Globe} label="Daemon host"
          hint={<>Docker daemon over TCP. In the bundled compose stack use <Code>tcp://docker:2375</Code>;
            for a remote daemon, e.g. <Code>tcp://build-host:2376</Code>.</>}>
          <input className={inputCls} placeholder="tcp://docker:2375" value={s.host}
            onChange={(e) => set({ host: e.target.value })} />
        </Field>
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

export const dockerTypeForm: SandboxTypeForm = {
  icon: Box,
  testConnection: true,
  readConfig: (raw) => {
    const connection = (raw.connection ?? {}) as { host?: string };
    const image = (raw.image ?? { kind: "ref", imageRef: "" }) as { kind?: ImageKind; imageRef?: string; content?: string };
    return {
      host: connection.host ?? "",
      imageKind: (image.kind ?? "ref"),
      imageRef: image.imageRef ?? "",
      dockerfile: image.content ?? "",
      network: (raw.network ?? "full"),
    };
  },
  buildConfig: (state) => {
    const s = state as unknown as DockerState;
    return {
      connection: { host: s.host },
      image: s.imageKind === "ref" ? { kind: "ref", imageRef: s.imageRef } : { kind: "dockerfile", content: s.dockerfile },
      network: s.network,
    };
  },
  ConfigForm: DockerConfigForm,
};
