import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PresetId } from "@journeyman/core";
import { lintJsonSchema } from "../schema/lint.ts";
import type { LoadedPreset, PresetManifest } from "./types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PRESETS_ROOT = resolve(HERE, "..", "..", "presets");

let cache: Map<PresetId, LoadedPreset> | null = null;

export function loadAllPresets(rootOverride?: string): Map<PresetId, LoadedPreset> {
  if (cache && !rootOverride) return cache;
  const root = rootOverride ?? PRESETS_ROOT;
  const out = new Map<PresetId, LoadedPreset>();

  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    if (!statSync(dir).isDirectory()) continue;
    const manifestPath = join(dir, "preset.json");
    if (!existsSync(manifestPath)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PresetManifest;

    let payloadSchema: unknown = undefined;
    if (manifest.payloadSchemaRef) {
      const schemaPath = resolve(dir, manifest.payloadSchemaRef);
      payloadSchema = JSON.parse(readFileSync(schemaPath, "utf8"));
      const lint = lintJsonSchema(payloadSchema);
      if (!lint.ok) {
        throw new Error(`Preset ${manifest.id} schema invalid: ${lint.errors.join("; ")}`);
      }
    }

    let samples: Record<string, unknown> | undefined;
    if (manifest.sampleEvents) {
      samples = {};
      for (const [event, rel] of Object.entries(manifest.sampleEvents)) {
        samples[event] = JSON.parse(readFileSync(resolve(dir, rel), "utf8"));
      }
    }

    const loaded: LoadedPreset = {
      id: manifest.id,
      name: manifest.name,
      kind: manifest.kind,
      icon: manifest.icon,
      docsUrl: manifest.docsUrl,
      auth: manifest.auth,
      eventTypePath: manifest.eventTypePath,
      deliveryIdHeader: manifest.deliveryIdHeader,
      knownEventTypes: manifest.knownEventTypes,
      correlationSuggestions: manifest.correlationSuggestions,
      payloadSchema,
      samples,
    };
    out.set(manifest.id, loaded);
  }

  if (!rootOverride) cache = out;
  return out;
}

export function getPreset(id: PresetId): LoadedPreset | undefined {
  return loadAllPresets().get(id);
}

export function listPresets(): LoadedPreset[] {
  return Array.from(loadAllPresets().values());
}
