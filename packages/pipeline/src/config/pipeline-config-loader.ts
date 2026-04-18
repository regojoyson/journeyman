import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import type { PipelineConfig } from "@journeyman/core";
import { PipelineConfigSchema } from "./pipeline-schema.ts";

export function loadPipelineConfig(path: string): PipelineConfig {
  const raw = yaml.load(readFileSync(path, "utf8"));
  const result = PipelineConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid pipeline config ${path}: ${result.error.message}`);
  }
  return result.data as PipelineConfig;
}
