import type { SandboxType } from "../../../api/sandboxes.ts";
import type { SandboxTypeForm } from "./LocalConfigForm.tsx";
import { localTypeForm } from "./LocalConfigForm.tsx";
import { dockerTypeForm } from "./DockerConfigForm.tsx";

/** Drop-in point: add a new type's form descriptor here when its backend ships. */
export const sandboxTypeForms: Partial<Record<SandboxType, SandboxTypeForm>> = {
  local: localTypeForm,
  docker: dockerTypeForm,
};
