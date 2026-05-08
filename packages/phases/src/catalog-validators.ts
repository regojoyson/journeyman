// React-free phase config validators. Backend (api-server) imports this
// transitively via "@journeyman/phases/catalog" — never via the React-aware
// barrel. Pure dependency on @journeyman/core types and the catalog entry shape.
import type { PhaseConfigValidator } from "@journeyman/core";

interface ZodLikeSchema {
  safeParse: (v: unknown) => {
    success: boolean;
    error?: { issues?: Array<{ path?: (string | number)[]; message?: string }> };
  };
}

interface CatalogLikeEntry {
  phaseType: string;
  configSchema?: ZodLikeSchema;
}

export function buildPhaseConfigValidators(
  entries: CatalogLikeEntry[],
): Map<string, PhaseConfigValidator> {
  const map = new Map<string, PhaseConfigValidator>();
  for (const entry of entries) {
    if (!entry.configSchema) continue;
    const schema = entry.configSchema;
    map.set(entry.phaseType, (config: unknown) => {
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
