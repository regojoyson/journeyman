import type { SecretSlotDef } from "../types/secret-slot.types.ts";
import type { CodingModelConfig } from "../types/coding-models.types.ts";
import { codingModelKeySlot } from "./coding-model-key-slot.ts";

export { suggestedKeySlotName } from "./key-slot-name.ts";

/**
 * The required key slot a coding model needs, derived from its config. Single
 * source of truth for the editor, publish validation, and worker. Empty when the
 * model declares no key. The slot NAME is derived (codingModelKeySlot), never
 * typed by a user.
 */
export function openCodeModelSlots(
  config: CodingModelConfig | undefined,
  modelId: string | undefined,
): SecretSlotDef[] {
  if (!config?.requiresApiKey) return [];
  return [{
    name: codingModelKeySlot({ provider: "opencode", config, modelId }),
    description: "API key for this model.",
    optional: false,
  }];
}

/** Generic alias: any coding model that requires a key surfaces exactly that slot. */
export const codingModelSlots = openCodeModelSlots;
