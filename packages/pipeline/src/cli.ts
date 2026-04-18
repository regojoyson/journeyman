#!/usr/bin/env node
import { parseArgs } from "node:util";

function help() {
  console.log(`Usage:
  journeyman run --ticket <KEY> --product <ID> [--flow <name>] [--config <path>]
  journeyman validate-config [--config <path>]
  journeyman sweep [--config <path>]
`);
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      ticket: { type: "string" },
      product: { type: "string" },
      flow: { type: "string" },
      config: { type: "string", default: "config/pipeline.yaml" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    help();
    process.exit(values.help ? 0 : 1);
  }

  const cmd = positionals[0];
  if (cmd === "run") {
    if (!values.ticket || !values.product) {
      console.error("--ticket and --product required");
      process.exit(1);
    }
    const { runOnce } = await import("./cli-commands/run-once.ts");
    const code = await runOnce(values.config!, values.product, values.ticket, values.flow);
    process.exit(code);
  }
  if (cmd === "validate-config") {
    const { validateConfig } = await import("./cli-commands/validate-config.ts");
    process.exit(await validateConfig(values.config!));
  }
  if (cmd === "sweep") {
    const { sweep } = await import("./cli-commands/sweep.ts");
    process.exit(await sweep(values.config!));
  }
  help();
  process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
