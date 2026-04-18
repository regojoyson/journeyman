import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { IFlowConfigSource, FlowDefinition } from "@journeyman/core";
import { FlowSchema } from "./flow-schema.ts";

export class YamlFlowConfigSource implements IFlowConfigSource {
  private constructor(private readonly byName: Map<string, FlowDefinition>) {}

  static async fromDir(dir: string): Promise<YamlFlowConfigSource> {
    const byName = new Map<string, FlowDefinition>();
    const files = readdirSync(dir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const f of files) {
      const full = join(dir, f);
      const parsed = yaml.load(readFileSync(full, "utf8"));
      const result = FlowSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(`Invalid flow file ${full}: ${result.error.message}`);
      }
      const data = result.data;
      // Default step.id = phase name if absent; reject duplicates
      const ids = new Set<string>();
      const steps = data.steps.map(s => {
        const id = s.id ?? s.phase;
        if (ids.has(id)) throw new Error(`Duplicate step id "${id}" in flow ${data.name}`);
        ids.add(id);
        return { ...s, id };
      });
      byName.set(data.name, { ...data, steps } as FlowDefinition);
    }
    return new YamlFlowConfigSource(byName);
  }

  async getFlow(name: string): Promise<FlowDefinition> {
    const f = this.byName.get(name);
    if (!f) throw new Error(`Unknown flow: ${name}`);
    return f;
  }

  async listFlows(): Promise<string[]> {
    return [...this.byName.keys()];
  }
}
