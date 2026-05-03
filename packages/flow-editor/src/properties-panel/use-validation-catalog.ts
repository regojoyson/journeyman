import { useMemo } from "react";
import type { ValidationCatalog } from "@journeyman/core";
import { usePhaseCatalog } from "../catalogs/use-phase-catalog.ts";

/**
 * Adapter: presents the editor's phase catalog as a ValidationCatalog
 * for the @journeyman/core flow-validator. Pure passthrough today.
 */
export function useValidationCatalog(): ValidationCatalog {
  const catalog = usePhaseCatalog();
  return useMemo(() => {
    const out: ValidationCatalog = {};
    for (const [phaseType, entry] of Object.entries(catalog)) {
      out[phaseType] = {
        inputFields: entry.inputFields,
        outputSchema: entry.outputSchema,
      };
    }
    return out;
  }, [catalog]);
}
