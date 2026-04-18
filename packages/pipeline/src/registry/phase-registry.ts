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
