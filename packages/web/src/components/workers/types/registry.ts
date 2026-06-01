import type { WorkerType } from "../../../api/workers.ts";
import type { WorkerTypeForm } from "./LocalConfigForm.tsx";
import { localTypeForm } from "./LocalConfigForm.tsx";
import { dockerTypeForm } from "./DockerConfigForm.tsx";

/** Drop-in point: add a new type's form descriptor here when its backend ships. */
export const workerTypeForms: Partial<Record<WorkerType, WorkerTypeForm>> = {
  local: localTypeForm,
  docker: dockerTypeForm,
};
