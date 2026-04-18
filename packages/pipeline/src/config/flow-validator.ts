import type { FlowDefinition, ProductConfig } from "@journeyman/core";
import type { PhaseRegistry } from "../registry/phase-registry.ts";
import type { ProviderRegistry } from "../registry/provider-registry.ts";
import type { BasePhaseStatic } from "../phases/base-phase.ts";

export type ValidationCtx = {
  phases: PhaseRegistry;
  providers: ProviderRegistry;
  flows: FlowDefinition[];
  products: Record<string, ProductConfig>;
  defaultFlow: string;
};

export class FlowValidator {
  static validate(ctx: ValidationCtx): void {
    for (const flow of ctx.flows) {
      this.validatePhasesExist(flow, ctx.phases);
      this.validateProvidersExist(flow, ctx.providers);
      this.validateReadsWrites(flow, ctx.phases);
    }
    this.validateDefaults(ctx);
    this.validateProductFlows(ctx);
    this.validateStatusNames(ctx);
  }

  private static validatePhasesExist(flow: FlowDefinition, phases: PhaseRegistry) {
    for (const s of flow.steps) {
      if (!phases.has(s.phase)) {
        throw new Error(
          `Flow "${flow.name}" step "${s.id}" uses unknown phase "${s.phase}".\n` +
          `Registered phases: ${phases.list().join(", ")}.`,
        );
      }
    }
  }

  private static validateProvidersExist(flow: FlowDefinition, providers: ProviderRegistry) {
    const cats: Array<[keyof FlowDefinition["providers"], "coding-cli" | "git" | "ticket" | "notification"]> = [
      ["ticket", "ticket"],
      ["git", "git"],
      ["coding", "coding-cli"],
      ["notification", "notification"],
    ];
    for (const [key, cat] of cats) {
      const id = flow.providers[key];
      const known = providers.listByCategory(cat).map(m => m.id);
      if (!known.includes(id)) {
        throw new Error(
          `Flow "${flow.name}" references unknown ${cat} provider "${id}".\n` +
          `Registered: ${known.join(", ")}.`,
        );
      }
    }
  }

  private static validateReadsWrites(flow: FlowDefinition, phases: PhaseRegistry) {
    const available = new Set<string>();
    for (const step of flow.steps) {
      const phase = phases.resolve(step.phase);
      const Cls = (phase as any).constructor as BasePhaseStatic;
      const reads = Cls.reads ?? [];
      const missing = reads.filter(k => !available.has(k));
      if (missing.length > 0) {
        throw new Error(
          `Flow "${flow.name}" step "${step.id}" (phase ${step.phase}) needs artifacts [${missing.join(", ")}] ` +
          `that no earlier step produces.\n` +
          `Available: [${[...available].join(", ") || "(none)"}].`,
        );
      }
      for (const w of Cls.writes ?? []) available.add(w);
    }
  }

  private static validateDefaults(ctx: ValidationCtx) {
    const names = ctx.flows.map(f => f.name);
    if (!names.includes(ctx.defaultFlow)) {
      throw new Error(
        `defaultFlow "${ctx.defaultFlow}" not found. Available: ${names.join(", ")}.`,
      );
    }
  }

  private static validateProductFlows(ctx: ValidationCtx) {
    const names = ctx.flows.map(f => f.name);
    for (const [pid, p] of Object.entries(ctx.products)) {
      if (!names.includes(p.flow)) {
        throw new Error(`Product "${pid}" uses flow "${p.flow}" which is not defined.`);
      }
      if (!p.repos || p.repos.length === 0) {
        throw new Error(`Product "${pid}" must declare at least one repo.`);
      }
    }
  }

  private static validateStatusNames(ctx: ValidationCtx) {
    for (const [pid, p] of Object.entries(ctx.products)) {
      const flow = ctx.flows.find(f => f.name === p.flow);
      if (!flow) continue;
      const statuses = p.ticketWorkflow?.statuses ?? {};
      for (const step of flow.steps) {
        if (step.phase !== "updateStatus") continue;
        const semantic = (step.config as any)?.status;
        if (!semantic) continue;
        if (!(semantic in statuses)) {
          throw new Error(
            `Flow "${flow.name}" step "${step.id}" uses semantic status "${semantic}" ` +
            `not defined in product "${pid}".\nDefined: [${Object.keys(statuses).join(", ")}].`,
          );
        }
      }
    }
  }
}
