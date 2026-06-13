/** Minimal structural inputs — the api-server maps real records to these. */
export interface CatalogStepSummary {
  stepType: string;
  label: string;
  category: string;
  inputs: string[];
  outputs: string[];
}
export interface ProviderSummary { kind: string; value: string; label: string; }
export interface InventorySummary {
  customSteps: { id: string; name: string; description?: string }[];
  mcps: { id: string; name: string }[];
  skills: { id: string; name: string }[];
  sandboxes: { id: string; name: string; type: string; tags?: string[] }[];
  webhooks: { id: string; name: string; preset?: string }[];
}

/** The built-in step catalog (only step types the assembler may use). */
export function serializeStepCatalog(steps: CatalogStepSummary[]): string {
  const lines = steps.map((s) => {
    const io = `inputs: [${s.inputs.join(", ")}] · outputs: [${s.outputs.join(", ")}]`;
    return `- ${s.stepType} (${s.label}, ${s.category}) — ${io}`;
  });
  return `Available step types:\n${lines.join("\n")}`;
}

/** Implemented providers, grouped by executor kind. */
export function serializeProviders(implemented: ProviderSummary[]): string {
  const byKind = new Map<string, ProviderSummary[]>();
  for (const p of implemented) {
    const arr = byKind.get(p.kind) ?? [];
    arr.push(p);
    byKind.set(p.kind, arr);
  }
  const blocks = [...byKind.entries()].map(([kind, ps]) =>
    `  ${kind}: ${ps.map((p) => `${p.value} (${p.label})`).join(", ")}`,
  );
  return `Implemented providers (only these may be used):\n${blocks.join("\n")}`;
}

/** Node types the engine actually runs. */
export function serializeNodeTypes(types: string[]): string {
  return `Supported node types: ${types.join(", ")}`;
}

/** The user's existing inventory (selectable; anything missing is a gap). */
export function serializeInventory(inv: InventorySummary): string {
  const list = <T>(items: T[], render: (i: T) => string): string =>
    items.length ? items.map((i) => `  - ${render(i)}`).join("\n") : "  (none)";
  return [
    "Your existing custom steps:",
    list(inv.customSteps, (c) => `${c.name}${c.description ? ` — ${c.description}` : ""} [id ${c.id}]`),
    "Your MCP instances:",
    list(inv.mcps, (m) => `${m.name} [id ${m.id}]`),
    "Your skill packages:",
    list(inv.skills, (s) => `${s.name} [id ${s.id}]`),
    "Your sandboxes:",
    list(inv.sandboxes, (s) => `${s.name} (${s.type}${s.tags?.length ? `, tags: ${s.tags.join("/")}` : ""}) [id ${s.id}]`),
    "Your webhooks:",
    list(inv.webhooks, (w) => `${w.name}${w.preset ? ` (${w.preset})` : ""} [id ${w.id}]`),
  ].join("\n");
}
