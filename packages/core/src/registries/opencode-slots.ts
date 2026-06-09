import type { SecretSlotDef } from "../types/secret-slot.types.ts";
import type { CodingModelConfig } from "../types/coding-models.types.ts";

/**
 * The required key slot(s) an OpenCode model needs, derived from its declared
 * config. Single source of truth for the editor, publish validation, and worker.
 * Empty when the model declares no key (e.g. a keyless local endpoint).
 */
export function openCodeModelSlots(config: CodingModelConfig | undefined): SecretSlotDef[] {
  if (config?.apiKeySlot) {
    return [{ name: config.apiKeySlot, description: "API key for this model.", optional: false }];
  }
  return [];
}

/**
 * Smart default secret key name for the admin form, derived from an OpenCode
 * model id "providerID/modelID": `${PROVIDERID}_API_KEY`, with google→GEMINI.
 * Returns "" when there is no provider prefix.
 */
export function suggestedKeySlotName(modelId: string | undefined): string {
  const providerID = modelId && modelId.includes("/") ? modelId.slice(0, modelId.indexOf("/")) : "";
  if (!providerID) return "";
  const overrides: Record<string, string> = { google: "GEMINI_API_KEY" };
  return overrides[providerID] ?? `${providerID.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}
