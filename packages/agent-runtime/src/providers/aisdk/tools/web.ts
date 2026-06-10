import { tool, jsonSchema } from "ai";

export async function webFetchImpl(args: { url: string }): Promise<{ status: number; body: string }> {
  const res = await fetch(args.url);
  const body = (await res.text()).slice(0, 100_000);
  return { status: res.status, body };
}

export function webFetchTool() {
  return tool({
    description: "Fetch a URL and return its status and body text (truncated).",
    inputSchema: jsonSchema<{ url: string }>({ type: "object", properties: { url: { type: "string" } }, required: ["url"] }),
    execute: (a: { url: string }) => webFetchImpl(a),
  });
}
