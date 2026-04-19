/**
 * @file pipeline-config-loader.ts
 * Loads and validates the main pipeline YAML configuration file.
 *
 * Reads `pipeline.yaml` (or the path given by `--config`), parses it with `js-yaml`,
 * and validates the result against `PipelineConfigSchema` (Zod). Throws with a
 * descriptive error if the file is missing, malformed YAML, or fails schema validation.
 */

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
