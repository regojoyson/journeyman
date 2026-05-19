import type { IStepHandler, IStepRegistry } from "@journeyman/core";

export class InMemoryStepRegistry implements IStepRegistry {
  private byType = new Map<string, IStepHandler>();

  register(handler: IStepHandler): void {
    if (this.byType.has(handler.stepType)) {
      throw new Error(`Step '${handler.stepType}' already registered`);
    }
    this.byType.set(handler.stepType, handler);
  }

  get(stepType: string): IStepHandler | null {
    return this.byType.get(stepType) ?? null;
  }

  list(): IStepHandler[] {
    return [...this.byType.values()];
  }
}
