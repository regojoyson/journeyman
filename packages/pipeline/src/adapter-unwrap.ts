export class AdapterError extends Error {
  constructor(
    public readonly operation: string,
    public readonly original: string,
  ) {
    super(`${operation}: ${original}`);
    this.name = "AdapterError";
  }
}

/** Throws AdapterError if result.error is set; otherwise returns the result. */
export function unwrap<T extends { error?: string }>(result: T, operation: string): T {
  if (result.error) throw new AdapterError(operation, result.error);
  return result;
}

/** Throws AdapterError if error set OR if the required field is null/undefined. Returns the field. */
export function unwrapField<T extends { error?: string }, K extends keyof T>(
  result: T,
  field: K,
  operation: string,
): NonNullable<T[K]> {
  if (result.error) throw new AdapterError(operation, result.error);
  const v = result[field];
  if (v === undefined || v === null) {
    throw new AdapterError(operation, `missing field "${String(field)}"`);
  }
  return v as NonNullable<T[K]>;
}
