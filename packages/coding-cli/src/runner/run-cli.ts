import type { CodingCliLogFn, ICodingCLI } from "@journeyman/core";
import { dispatchOperation } from "./dispatch.ts";
import type { RunnerRequest } from "./runner-types.ts";

/** Parse a RunnerRequest JSON string, dispatch it, and return a RunnerResponse JSON string. */
export async function runRunnerCli(
  input: string,
  makeProvider: (key: string | undefined) => ICodingCLI,
  onLog?: CodingCliLogFn,
): Promise<string> {
  let req: RunnerRequest;
  try {
    req = JSON.parse(input) as RunnerRequest;
  } catch (e) {
    return JSON.stringify({ ok: false, error: `invalid JSON request: ${(e as Error).message}` });
  }
  if (!req || typeof req.op !== "string") {
    return JSON.stringify({ ok: false, error: "request must include a string 'op'" });
  }
  const provider = makeProvider(req.provider);
  const res = await dispatchOperation(provider, req.op, req.opts ?? {}, {
    ...(onLog ? { onLog } : {}),
  });
  return JSON.stringify(res);
}
