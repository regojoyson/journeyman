export interface OpenCodeModel {
  providerID: string;
  modelID: string;
}

/** Parse a "providerID/modelID" string (split on the first slash). */
export function parseOpenCodeModel(model: string | undefined): OpenCodeModel | undefined {
  if (!model) return undefined;
  const i = model.indexOf("/");
  if (i <= 0 || i === model.length - 1) return undefined;
  return { providerID: model.slice(0, i), modelID: model.slice(i + 1) };
}

/** Per-call model string wins; otherwise the provider-config model object. */
export function resolveOpenCodeModel(
  perCall: string | undefined,
  fallback: OpenCodeModel | undefined,
): OpenCodeModel | undefined {
  return parseOpenCodeModel(perCall) ?? fallback;
}
