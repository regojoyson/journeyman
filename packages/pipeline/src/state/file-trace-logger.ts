import { mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { ITraceLogger, TraceLine } from "@journeyman/core";

/**
 * Resolver looks up the productId for a given sessionId by scanning the state dir.
 * Caller provides this so the trace logger can find the correct product-scoped log dir.
 */
export type ProductIdResolver = (sessionId: string) => string | null;

export class FileTraceLogger implements ITraceLogger {
  constructor(
    private readonly rootDir: string,
    private readonly resolveProductId: ProductIdResolver,
  ) {
    mkdirSync(rootDir, { recursive: true });
  }

  async log(
    sessionId: string,
    stepId: string,
    message: string,
    level: TraceLine["level"] = "info",
    meta?: Record<string, unknown>,
  ): Promise<void> {
    const productId = this.resolveProductId(sessionId);
    if (!productId) throw new Error(`FileTraceLogger: no product for session ${sessionId}`);
    const dir = join(this.rootDir, productId, "logs", sessionId);
    mkdirSync(dir, { recursive: true });
    const line: TraceLine = { ts: new Date().toISOString(), level, stepId, message, meta };
    await appendFile(join(dir, `${stepId}.log`), JSON.stringify(line) + "\n", "utf8");
  }

  async *read(
    sessionId: string,
    opts: { stepId?: string; tail?: number } = {},
  ): AsyncIterable<TraceLine> {
    const productId = this.resolveProductId(sessionId);
    if (!productId) return;
    const dir = join(this.rootDir, productId, "logs", sessionId);
    if (!existsSync(dir)) return;
    const files = readdirSync(dir)
      .filter(f => f.endsWith(".log"))
      .filter(f => !opts.stepId || f === `${opts.stepId}.log`);
    const all: TraceLine[] = [];
    for (const f of files) {
      const raw = readFileSync(join(dir, f), "utf8");
      for (const l of raw.split("\n")) if (l.trim()) all.push(JSON.parse(l) as TraceLine);
    }
    all.sort((a, b) => a.ts.localeCompare(b.ts));
    const sliced = opts.tail ? all.slice(-opts.tail) : all;
    for (const line of sliced) yield line;
  }
}
