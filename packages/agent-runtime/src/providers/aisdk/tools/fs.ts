import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import { tool, jsonSchema } from "ai";
import type { ToolCtx } from "./bash.ts";

const resolve = (ctx: ToolCtx, p: string) => (isAbsolute(p) ? p : join(ctx.cwd ?? process.cwd(), p));

export async function readFileImpl(args: { path: string }, ctx: ToolCtx): Promise<{ content: string }> {
  return { content: await readFile(resolve(ctx, args.path), "utf8") };
}

export async function writeFileImpl(args: { path: string; content: string }, ctx: ToolCtx): Promise<{ ok: true }> {
  const full = resolve(ctx, args.path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, args.content, "utf8");
  return { ok: true };
}

export async function editFileImpl(
  args: { path: string; oldString: string; newString: string },
  ctx: ToolCtx,
): Promise<{ ok: true }> {
  const full = resolve(ctx, args.path);
  const cur = await readFile(full, "utf8");
  const count = cur.split(args.oldString).length - 1;
  if (count === 0) throw new Error(`edit: oldString not found in ${args.path}`);
  if (count > 1) throw new Error(`edit: oldString not unique in ${args.path} (${count} matches)`);
  await writeFile(full, cur.replace(args.oldString, args.newString), "utf8");
  return { ok: true };
}

export function searchImpl(args: { pattern: string }, ctx: ToolCtx): Promise<{ matches: string }> {
  return new Promise((resolveP) => {
    const child = spawn("rg", ["--no-heading", "-n", args.pattern], { cwd: ctx.cwd });
    let out = "";
    child.stdout.on("data", (c) => { out += c.toString("utf8"); });
    child.on("error", () => resolveP({ matches: "" }));
    child.on("close", () => resolveP({ matches: out.slice(0, 100_000) }));
  });
}

export function readTool(ctx: ToolCtx) {
  return tool({
    description: "Read a file's contents.",
    inputSchema: jsonSchema<{ path: string }>({ type: "object", properties: { path: { type: "string" } }, required: ["path"] }),
    execute: (a: { path: string }) => readFileImpl(a, ctx),
  });
}
export function writeTool(ctx: ToolCtx) {
  return tool({
    description: "Write (create or overwrite) a file.",
    inputSchema: jsonSchema<{ path: string; content: string }>({ type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] }),
    execute: (a: { path: string; content: string }) => writeFileImpl(a, ctx),
  });
}
export function editTool(ctx: ToolCtx) {
  return tool({
    description: "Replace a unique string in a file.",
    inputSchema: jsonSchema<{ path: string; oldString: string; newString: string }>({ type: "object", properties: { path: { type: "string" }, oldString: { type: "string" }, newString: { type: "string" } }, required: ["path", "oldString", "newString"] }),
    execute: (a: { path: string; oldString: string; newString: string }) => editFileImpl(a, ctx),
  });
}
export function searchTool(ctx: ToolCtx) {
  return tool({
    description: "Search file contents with ripgrep.",
    inputSchema: jsonSchema<{ pattern: string }>({ type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] }),
    execute: (a: { pattern: string }) => searchImpl(a, ctx),
  });
}
