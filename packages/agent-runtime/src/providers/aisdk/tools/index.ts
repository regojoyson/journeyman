import type { ToolCtx } from "./bash.ts";
import { bashTool } from "./bash.ts";
import { readTool, writeTool, editTool, searchTool } from "./fs.ts";
import { webFetchTool } from "./web.ts";

type ToolFactory = (ctx: ToolCtx) => unknown;

const BUILTINS: Record<string, ToolFactory> = {
  bash: bashTool,
  read: readTool,
  write: writeTool,
  edit: editTool,
  search: searchTool,
  web_fetch: () => webFetchTool(),
};

/** Build the AI SDK tools record for the requested native ids. Unknown ids are skipped. */
export function buildBuiltinTools(ids: readonly string[], ctx: ToolCtx): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of ids) {
    const make = BUILTINS[id];
    if (make) out[id] = make(ctx);
  }
  return out;
}

export type { ToolCtx };
