// packages/flow-editor/src/state/phase-registry.ts
import type { PhaseDefinition } from "../phase-definition.ts";

export class PhaseRegistry {
  private byType: Map<string, PhaseDefinition<any>>;
  constructor(definitions: PhaseDefinition<any>[]) {
    this.byType = new Map(definitions.map(d => [d.phaseType, d]));
  }
  get(phaseType: string | undefined): PhaseDefinition<any> | undefined {
    if (!phaseType) return undefined;
    return this.byType.get(phaseType);
  }
  list(): PhaseDefinition<any>[] {
    return [...this.byType.values()];
  }
}
