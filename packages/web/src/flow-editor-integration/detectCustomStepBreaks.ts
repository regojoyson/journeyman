import type { CustomAiStep, CustomStepInputField } from "@journeyman/core";

export interface CustomStepDiff {
  inputErrors:   { fieldName: string; reason: "removed" | "type-changed" | "now-required" }[];
  inputWarnings: { fieldName: string; reason: "added-optional" }[];
  outputErrors:   { path: string; reason: "removed" }[];
  outputWarnings: { path: string; reason: "type-changed" }[];
}

export function diffCustomStep(
  prev: CustomAiStep,
  next: CustomAiStep,
  wired: { wiredInputs: string[]; wiredOutputPaths: string[] },
): CustomStepDiff {
  const out: CustomStepDiff = {
    inputErrors: [], inputWarnings: [], outputErrors: [], outputWarnings: [],
  };

  const prevByName = new Map(prev.inputFields.map((f) => [f.name, f]));
  const nextByName = new Map(next.inputFields.map((f) => [f.name, f]));

  for (const name of wired.wiredInputs) {
    const p = prevByName.get(name);
    const n = nextByName.get(name);
    if (p && !n) out.inputErrors.push({ fieldName: name, reason: "removed" });
    else if (p && n && !typesCompatible(p, n)) out.inputErrors.push({ fieldName: name, reason: "type-changed" });
  }
  for (const [name, n] of nextByName) {
    if (!prevByName.has(name) && n.required) out.inputErrors.push({ fieldName: name, reason: "now-required" });
    if (!prevByName.has(name) && !n.required) out.inputWarnings.push({ fieldName: name, reason: "added-optional" });
  }

  if (prev.outputMode === "structured" && next.outputMode === "structured") {
    const prevPaths = collectPaths(prev.outputSchema);
    const nextPaths = collectPaths(next.outputSchema);
    for (const path of wired.wiredOutputPaths) {
      const pType = prevPaths.get(path);
      const nType = nextPaths.get(path);
      if (pType && !nType) out.outputErrors.push({ path, reason: "removed" });
      else if (pType && nType && pType !== nType) out.outputWarnings.push({ path, reason: "type-changed" });
    }
  } else if (prev.outputMode !== next.outputMode) {
    for (const path of wired.wiredOutputPaths) out.outputErrors.push({ path, reason: "removed" });
  }
  return out;
}

function typesCompatible(a: CustomStepInputField, b: CustomStepInputField): boolean {
  return a.type === b.type;
}

function collectPaths(schema: unknown, base = ""): Map<string, string> {
  const m = new Map<string, string>();
  if (!schema || typeof schema !== "object") return m;
  const props = (schema as any).properties;
  if (!props || typeof props !== "object") return m;
  for (const [key, val] of Object.entries(props)) {
    const path = base ? `${base}.${key}` : key;
    const t = (val as any)?.type ?? "unknown";
    m.set(path, typeof t === "string" ? t : "unknown");
    if (t === "object") {
      for (const [k, v] of collectPaths(val, path)) m.set(k, v);
    }
  }
  return m;
}

export async function detectCustomStepBreaks(
  orgId: string,
  nodes: Array<{
    id: string;
    stepType: string;
    config: { customStepId?: string };
    snapshot?: { step: CustomAiStep };
    wiredInputs: string[];
    wiredOutputPaths: string[];
  }>,
): Promise<Map<string, CustomStepDiff>> {
  const out = new Map<string, CustomStepDiff>();
  for (const n of nodes) {
    if (n.stepType !== "custom-ai" || !n.config.customStepId) continue;
    const r = await fetch(
      `/api/orgs/${orgId}/custom-steps/${n.config.customStepId}`,
      { credentials: "include" },
    );
    if (!r.ok) continue;
    const next = (await r.json()) as CustomAiStep;
    const prev = n.snapshot?.step ?? next;
    out.set(
      n.id,
      diffCustomStep(prev, next, {
        wiredInputs: n.wiredInputs,
        wiredOutputPaths: n.wiredOutputPaths,
      }),
    );
  }
  return out;
}
