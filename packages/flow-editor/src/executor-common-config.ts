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

const EDITOR_KINDS = ["coding-cli", "git-provider", "issue-provider", "notification"] as const;

function buildCommonConfig(): Record<ExecutorKind, ExecutorKindCommonConfig> {
  const out: Record<ExecutorKind, ExecutorKindCommonConfig> = {
    "coding-cli": {},
    "git-provider": {},
    "issue-provider": {},
    "notification": {},
    "control": {},
  };
  for (const kind of EDITOR_KINDS) {
    out[kind] = {
      provider: PROVIDER_CATALOG
        .filter(p => p.kind === kind)
        .map(p => ({ value: p.value, label: p.label, implemented: p.implemented })),
    };
  }
  return out;
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
