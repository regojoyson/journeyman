// packages/orchestrator/src/registry/map-provider-resolver.ts
import type { ProviderResolver } from "@journeyman/core";

export class ProviderNotImplementedError extends Error {
  constructor(kind: string, key: string, known: string[]) {
    super(
      `No ${kind} provider registered for key "${key}". ` +
      `Known keys: [${known.join(", ")}].`,
    );
    this.name = "ProviderNotImplementedError";
  }
}

export interface MapProviderResolverOptions<T> {
  /** Display name of the executor kind, used in error messages. */
  kind: string;
  /** Key used when the phase input does not specify a provider. */
  defaultKey: string;
  /** Map from provider key (dropdown `value`) to instance. */
  providers: Record<string, T>;
}

export class MapProviderResolver<T> implements ProviderResolver<T> {
  private readonly map: Map<string, T>;
  private readonly defaultKey: string;
  private readonly kind: string;

  constructor(opts: MapProviderResolverOptions<T>) {
    this.map = new Map(Object.entries(opts.providers));
    this.defaultKey = opts.defaultKey;
    this.kind = opts.kind;
    if (!this.map.has(this.defaultKey)) {
      throw new Error(
        `MapProviderResolver(${opts.kind}): defaultKey "${opts.defaultKey}" is not registered.`,
      );
    }
  }

  resolve(key: string | undefined): T {
    const k = key ?? this.defaultKey;
    const found = this.map.get(k);
    if (!found) throw new ProviderNotImplementedError(this.kind, k, this.keys());
    return found;
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}
