/**
 * @file file-trace-logger.ts
 * ITraceLogger implementation that appends structured JSON log lines to per-step files.
 *
 * Layout: <rootDir>/<productId>/logs/<sessionId>/<stepId>.log
 *
 * Each line is a JSON-serialised TraceLine: `{ ts, level, stepId, message, meta }`.
 * One file per step means logs for long-running steps stay isolated and can be tailed
 * independently via the `stepId` filter in `read()`.
 *
 * `read()` is an async generator that loads all matching log files, merges and sorts
 * by timestamp, then optionally slices to the last `tail` entries. This is suitable for
 * the logs API endpoint which returns all lines for a session in one response.
 */

import { mkdirSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
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

  async delete(sessionId: string): Promise<void> {
    const productId = this.resolveProductId(sessionId);
    const candidates = productId
      ? [join(this.rootDir, productId, "logs", sessionId)]
      : this.listProductDirs().map(p => join(p, "logs", sessionId));
    for (const dir of candidates) {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  }

  private listProductDirs(): string[] {
    if (!existsSync(this.rootDir)) return [];
    return readdirSync(this.rootDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => join(this.rootDir, d.name));
  }
}
