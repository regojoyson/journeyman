import type { FC } from "react";
import { FolderOpen, Archive, type LucideIcon } from "lucide-react";
import { inputCls } from "../../../routes/admin-styles.ts";
import { Field, CheckField } from "./form-controls.tsx";

export interface SandboxTypeForm {
  icon: LucideIcon;
  readConfig: (raw: Record<string, unknown>) => Record<string, unknown>;
  buildConfig: (state: Record<string, unknown>) => Record<string, unknown>;
  validate?: (state: Record<string, unknown>) => string | null;
  ConfigForm: FC<{ state: Record<string, unknown>; onChange: (s: Record<string, unknown>) => void; editing: boolean }>;
  testConnection?: boolean;
}

interface LocalState { baseDir: string; retainWorkspace: boolean }

const LocalConfigForm: FC<{ state: Record<string, unknown>; onChange: (s: Record<string, unknown>) => void; editing: boolean }> =
  ({ state, onChange }) => {
    const s = state as unknown as LocalState;
    const set = (patch: Partial<LocalState>) => onChange({ ...s, ...patch } as unknown as Record<string, unknown>);
    return (
      <>
        <Field icon={FolderOpen} label="Base folder"
          hint={<>Parent directory where each run's workspace is created. Blank = system temp dir.</>}>
          <input className={inputCls} placeholder="(optional — defaults to a temp dir)" value={s.baseDir}
            onChange={(e) => set({ baseDir: e.target.value })} />
        </Field>
        <CheckField icon={Archive} label="Keep workspace folder after the run"
          hint={<>Leaves the cloned repo and edits on disk for debugging. Off = cleaned up when the run ends.</>}
          checked={s.retainWorkspace} onChange={(v) => set({ retainWorkspace: v })} />
      </>
    );
  };

export const localTypeForm: SandboxTypeForm = {
  icon: FolderOpen,
  readConfig: (raw) => ({
    baseDir: String((raw.baseDir as string) ?? ""),
    retainWorkspace: Boolean(raw.retainWorkspace),
  }),
  buildConfig: (state) => {
    const s = state as unknown as LocalState;
    return { ...(s.baseDir ? { baseDir: s.baseDir } : {}), ...(s.retainWorkspace ? { retainWorkspace: true } : {}) };
  },
  ConfigForm: LocalConfigForm,
};
