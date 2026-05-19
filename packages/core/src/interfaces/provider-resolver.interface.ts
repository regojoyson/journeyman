// packages/core/src/interfaces/provider-resolver.interface.ts

/**
 * Resolves a provider instance from a string key (the value chosen in the
 * flow editor's provider dropdown, threaded through PhaseInput.provider).
 *
 * Used to route a phase to the right concrete provider at run time without
 * the handler needing to know which providers exist.
 */
export interface ProviderResolver<T> {
  /**
   * Returns the provider registered under `key`. If `key` is undefined,
   * returns the resolver's default. Throws if `key` is unknown.
   */
  resolve(key: string | undefined): T;

  /** All keys this resolver knows about (for diagnostics / startup checks). */
  keys(): string[];
}

/**
 * Per-call factory: produces a provider instance from a routing key + the
 * resolved env (slot-keyed credential bag) for that run. Used by phase
 * handlers to construct providers fresh per invocation, so user/org-scope
 * secrets resolved per-run can flow through.
 */
export type ProviderFactory<T> = (
  key: string | undefined,
  env: Record<string, string>,
) => T;
