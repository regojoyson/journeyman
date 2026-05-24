// React-free step config validators. Backend (api-server) imports this
// transitively via "@journeyman/steps/catalog" — never via the React-aware
// barrel. Pure dependency on @journeyman/core types and the catalog entry shape.
import type { StepConfigValidator } from "@journeyman/core";

interface ZodLikeSchema {
  safeParse: (v: unknown) => {
    success: boolean;
    error?: { issues?: Array<{ path?: (string | number)[]; message?: string }> };
  };
}

interface CatalogLikeEntry {
  stepType: string;
  configSchema?: ZodLikeSchema;
}

export function buildStepConfigValidators(
  entries: CatalogLikeEntry[],
): Map<string, StepConfigValidator> {
  const map = new Map<string, StepConfigValidator>();
  for (const entry of entries) {
    if (!entry.configSchema) continue;
    const schema = entry.configSchema;
    map.set(entry.stepType, (config: unknown) => {
      const r = schema.safeParse(config);
      if (r.success) return [];
      return (r.error?.issues ?? []).map((i) => ({
        path: i.path ?? [],
        message: i.message ?? "Invalid value",
      }));
    });
  }
  return map;
}
