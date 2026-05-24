/**
 * Dry-run validator for a Journeyman flow JSON.
 *
 * Runs the same checks the api-server uses on save:
 *   1) ConductorJsonConverter.validateGraph (graph structure, ref reachability)
 *   2) Required-input check against @journeyman/steps catalog
 *   3) Ref-shape check (refs point at declared input/output fields)
 *
 * Also attempts a full toEngineJson() conversion to confirm the flow compiles
 * to a Conductor workflow definition.
 *
 * Usage:
 *   npx tsx scripts/dry-run-validate.ts examples/flows/end-to-end.flow.json
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConductorJsonConverter, parseRef } from "@journeyman/orchestrator";
import { stepCatalog } from "@journeyman/steps/catalog";
import type { WorkflowGraph } from "@journeyman/core";

const file = process.argv[2];
if (!file) {
  console.error("Usage: tsx scripts/dry-run-validate.ts <flow.json>");
  process.exit(2);
}
const raw = JSON.parse(readFileSync(resolve(file), "utf8")) as { definition: WorkflowGraph; name: string };
const def = raw.definition;

const errors: string[] = [];
const missing: string[] = [];
const warnings: string[] = [];

try {
  ConductorJsonConverter.validateGraph(def);
} catch (e) {
  errors.push(e instanceof Error ? e.message : String(e));
}

const outputsByStep = new Map(stepCatalog.map((p) => [p.stepType, p.outputSchema ?? {}]));
const inputsByStep  = new Map(stepCatalog.map((p) => [p.stepType, p.inputFields  ?? {}]));

for (const node of def.nodes) {
  if (node.type !== "step" || !node.stepType) continue;
  const declared = inputsByStep.get(node.stepType);
  if (!declared) {
    errors.push(`unknown step type '${node.stepType}' on node '${node.id}'`);
    continue;
  }
  const config = (node.config ?? {}) as Record<string, unknown>;
  const inputs = (node.inputs ?? {}) as Record<string, { kind?: string }>;
  for (const [field, m] of Object.entries(declared)) {
    if (!(m as { required?: boolean }).required) continue;
    const hasBinding = inputs[field]?.kind === "ref" || inputs[field]?.kind === "literal";
    const cv = config[field];
    const hasTyped = cv !== undefined && cv !== null && cv !== "";
    if (!hasBinding && !hasTyped) {
      missing.push(`'${node.id}' (${node.stepType}) missing required input '${field}'`);
    }
  }
}

for (const node of def.nodes) {
  for (const [field, v] of Object.entries(node.inputs ?? {})) {
    if (v.kind !== "ref") continue;
    const parsed = parseRef((v as { ref: string }).ref);
    if (!parsed || parsed.scope === "workflow.input") continue;
    const upstream = def.nodes.find((n) => n.id === parsed.source);
    if (!upstream?.stepType) continue;
    const declared = parsed.scope === "input"
      ? (inputsByStep.get(upstream.stepType) ?? {})
      : (outputsByStep.get(upstream.stepType) ?? {});
    if (!(parsed.field in declared)) {
      warnings.push(`'${node.id}.${field}' refs undeclared ${parsed.scope} field '${parsed.field}' on '${upstream.stepType}'`);
    }
  }
}

let compiledOk = false;
try {
  ConductorJsonConverter.prototype.toEngineJson.call(
    new ConductorJsonConverter(),
    def,
    { workflowName: raw.name, workflowVersion: 1 },
  );
  compiledOk = true;
} catch (e) {
  errors.push(`compile: ${e instanceof Error ? e.message : String(e)}`);
}

const ok = errors.length === 0 && missing.length === 0;
console.log(`\n=== Dry-run report for ${raw.name} ===`);
console.log(`graph valid:  ${errors.length === 0 ? "OK" : "FAIL"}`);
console.log(`required ins: ${missing.length === 0 ? "OK" : "FAIL"}`);
console.log(`compiled:     ${compiledOk ? "OK" : "FAIL"}`);
console.log(`warnings:     ${warnings.length}`);
if (errors.length)   { console.log("\nERRORS:");   for (const e of errors)   console.log("  -", e); }
if (missing.length)  { console.log("\nMISSING:");  for (const m of missing)  console.log("  -", m); }
if (warnings.length) { console.log("\nWARNINGS:"); for (const w of warnings) console.log("  -", w); }
console.log(ok ? "\nResult: OK\n" : "\nResult: FAIL\n");
process.exit(ok ? 0 : 1);
