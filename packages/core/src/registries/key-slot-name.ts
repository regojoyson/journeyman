/**
 * Smart default secret key name derived from an OpenCode model id
 * "providerID/modelID": `${PROVIDERID}_API_KEY`, with google→GEMINI.
 * Returns "" when there is no provider prefix.
 */
export function suggestedKeySlotName(modelId: string | undefined): string {
  const providerID = modelId && modelId.includes("/") ? modelId.slice(0, modelId.indexOf("/")) : "";
  if (!providerID) return "";
  const overrides: Record<string, string> = { google: "GEMINI_API_KEY" };
  return overrides[providerID] ?? `${providerID.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}
