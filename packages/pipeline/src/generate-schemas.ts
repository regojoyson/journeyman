import { zodToJsonSchema } from "zod-to-json-schema";
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { PipelineConfigSchema } from "./config/pipeline-schema.js";
import { FlowSchema } from "./config/flow-schema.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../..");
const outDir = resolve(repoRoot, "config/schemas");

mkdirSync(outDir, { recursive: true });

const comment =
  "Auto-generated from packages/pipeline/src/config/*-schema.ts — run npm run generate:schemas to update";

const pipelineSchema = {
  $comment: comment,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...(zodToJsonSchema(PipelineConfigSchema as any) as object),
};

const flowSchema = {
  $comment: comment,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...(zodToJsonSchema(FlowSchema as any) as object),
};

writeFileSync(
  resolve(outDir, "pipeline.schema.json"),
  JSON.stringify(pipelineSchema, null, 2) + "\n"
);
writeFileSync(
  resolve(outDir, "flow.schema.json"),
  JSON.stringify(flowSchema, null, 2) + "\n"
);

console.log("Generated config/schemas/pipeline.schema.json");
console.log("Generated config/schemas/flow.schema.json");
