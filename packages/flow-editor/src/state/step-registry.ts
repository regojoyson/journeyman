// packages/flow-editor/src/state/step-registry.ts
import type { StepDefinition } from "../step-definition.ts";

export class StepRegistry {
  private byType: Map<string, StepDefinition<any>>;
  constructor(definitions: StepDefinition<any>[]) {
    this.byType = new Map(definitions.map(d => [d.stepType, d]));
  }
  get(stepType: string | undefined): StepDefinition<any> | undefined {
    if (!stepType) return undefined;
    return this.byType.get(stepType);
  }
  list(): StepDefinition<any>[] {
    return [...this.byType.values()];
  }
}
