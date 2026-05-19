import type { IPhaseHandler, IPhaseRegistry } from "@journeyman/core";

export class InMemoryPhaseRegistry implements IPhaseRegistry {
  private byType = new Map<string, IPhaseHandler>();

  register(handler: IPhaseHandler): void {
    if (this.byType.has(handler.phaseType)) {
      throw new Error(`Phase '${handler.phaseType}' already registered`);
    }
    this.byType.set(handler.phaseType, handler);
  }

  get(phaseType: string): IPhaseHandler | null {
    return this.byType.get(phaseType) ?? null;
  }

  list(): IPhaseHandler[] {
    return [...this.byType.values()];
  }
}
