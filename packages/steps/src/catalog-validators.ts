// React-free step config validators. Backend (api-server) imports this
// transitively via "@journeyman/steps/catalog" — never via the React-aware
// barrel. Pure dependency on @journeyman/core types and the catalog entry shape.
import type { StepConfigValidator } from "@journeyman/core";

interface ZodLikeSchema {
  safeParse: (v: unknown) => {
    success: boolean;
    error?: { issues?: Array<{ path?: PropertyKey[]; message?: string }> };
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
        // zod 4.4 types issue paths as PropertyKey[]; config-schema paths are
        // always string/number at runtime, so drop any symbol to satisfy
        // StepConfigIssue's (string | number)[] path.
        path: (i.path ?? []).filter(
          (p): p is string | number => typeof p === "string" || typeof p === "number",
        ),
        message: i.message ?? "Invalid value",
      }));
    });
  }
  return map;
}
