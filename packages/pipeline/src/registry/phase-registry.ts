/**
 * @file phase-registry.ts
 * Registry that maps phase names to factory functions.
 *
 * Each phase is registered once at boot (`register`), then instantiated fresh for
 * every step execution (`resolve`). Using factories instead of singletons ensures
 * phase instances carry no cross-run state. The FlowValidator calls `has` and `list`
 * at boot to confirm all phases referenced by flows are available before accepting traffic.
 */

import type { IPhase } from "@journeyman/core";

export type PhaseFactory = () => IPhase;

export class PhaseRegistry {
  private factories = new Map<string, PhaseFactory>();

  register(name: string, factory: PhaseFactory): void {
    if (this.factories.has(name)) throw new Error(`Phase already registered: ${name}`);
    this.factories.set(name, factory);
  }
  has(name: string): boolean { return this.factories.has(name); }
  resolve(name: string): IPhase {
    const f = this.factories.get(name);
    if (!f) throw new Error(`Unknown phase: ${name}`);
    return f();
  }
  list(): string[] { return [...this.factories.keys()]; }
}
