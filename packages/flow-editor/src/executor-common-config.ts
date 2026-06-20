// packages/flow-editor/src/executor-common-config.ts
import {
  PROVIDER_CATALOG,
  implementedProvidersForKind,
  defaultProviderForKind,
} from "@journeyman/core";
import type { ExecutorKind } from "./step-definition.ts";

export interface ProviderOption {
  value: string;
  label: string;
  implemented: boolean;
}

export interface ExecutorKindCommonConfig {
  provider?: ProviderOption[];
}

function buildCommonConfig(): Record<ExecutorKind, ExecutorKindCommonConfig> {
  return {
    "coding-cli": {
      provider: PROVIDER_CATALOG
        .filter(p => p.kind === "coding-cli")
        .map(p => ({ value: p.value, label: p.label, implemented: p.implemented })),
    },
    // git, issue, and notification steps use connectionId — no provider dropdown
    "git-provider":  { provider: [] },
    "issue-provider": { provider: [] },
    "notification":  { provider: [] },
    "control":       {},
  };
}

export const executorCommonConfig: Record<ExecutorKind, ExecutorKindCommonConfig> = buildCommonConfig();

export function visibleProvidersFor(kind: ExecutorKind): ProviderOption[] {
  if (kind === "control") return [];
  return implementedProvidersForKind(kind).map(p => ({
    value: p.value,
    label: p.label,
    implemented: p.implemented,
  }));
}

export function defaultProviderFor(kind: ExecutorKind): string | undefined {
  if (kind === "control") return undefined;
  return defaultProviderForKind(kind)?.value;
}
