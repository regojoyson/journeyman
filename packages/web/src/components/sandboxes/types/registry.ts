import type { ComputeTargetType } from "../../../api/computeTargets.ts";
import type { ComputeTargetTypeForm } from "./LocalConfigForm.tsx";
import { localTypeForm } from "./LocalConfigForm.tsx";
import { dockerTypeForm } from "./DockerConfigForm.tsx";

/** Drop-in point: add a new type's form descriptor here when its backend ships. */
export const computeTargetTypeForms: Partial<Record<ComputeTargetType, ComputeTargetTypeForm>> = {
  local: localTypeForm,
  docker: dockerTypeForm,
};
